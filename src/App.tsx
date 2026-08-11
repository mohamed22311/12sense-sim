import { useState, useEffect, useCallback, useMemo } from 'react';
import { Scene } from './scene/Scene';
import { Fleet, seedRestingHrFor } from '@/runtime/fleet';
import { createAgents, type Agents } from '@/sim/agents';
import { VitalsBuffer, INITIAL_SPO2 } from '@/phone/vitalsBuffer';
import { SetupScreen, type SetupResult } from '@/ui/SetupScreen';
import { useBuildingStore } from '@/state/buildingStore';
import { FACTORY } from '@/sites/factory';
import { CONSTRUCTION } from '@/sites/construction';
import { Hud, type WorkerAccess } from '@/ui/hud/Hud';
import { workerIdentity } from '@/net/provisioning';
import type { ProvisionedSession, ProvisionedWorker } from '@/net/provisioning';
import { createHealthWatch, type HealthWatch } from '@/phone/healthWatch';
import { offboardWorker } from '@/net/alerts';
import './styles/global.css';

/** How many workers `?preview` populates the building with. */
const PREVIEW_WORKERS = 60;

/**
 * The simulator.
 *
 * Provisioning is gated behind the setup screen because it writes real,
 * undeletable accounts to a shared production server. `?preview` runs the whole
 * simulation — agents, pathing, jobs, physiology — with no network at all,
 * which is how the scene is iterated on without spending tenants.
 */
export default function App() {
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [agents, setAgents] = useState<Agents | null>(null);
  // Kept so the HUD can raise alerts as the tenant's admin. Nothing else in
  // the app needs it — the phones each hold their own worker token.
  const [session, setSession] = useState<ProvisionedSession | null>(null);
  // The site lives in the building store, because the scene, the camera and
  // the floor rail all need it and threading it through four layers of props
  // would put the same value in four places.
  const site = useBuildingStore((s) => s.site);
  const [roster, setRoster] = useState<ProvisionedWorker[]>([]);
  // `?preview` has no fleet, so it owns its buffers directly. Held here rather
  // than inside the effect so the worker panel can still drive vitals without
  // sixty real accounts behind them.
  const [previewBuffers, setPreviewBuffers] = useState<Map<number, VitalsBuffer> | null>(null);
  const [healthWatch, setHealthWatch] = useState<HealthWatch | null>(null);
  /**
   * `?preview` runs the simulation with no network at all. Its value picks the
   * site — `?preview=construction` — so both can be iterated on without
   * spending a tenant on either.
   */
  const preview = useMemo(() => {
    const value = new URLSearchParams(window.location.search).get('preview');
    if (value === null) return null;
    return value === 'construction' ? CONSTRUCTION : FACTORY;
  }, []);

  /**
   * Provisioning is done; stand up the simulation.
   *
   * Order matters and is not arbitrary: the fleet creates each worker's vitals
   * buffer, the agents write physiology into those buffers, and the fleet then
   * reads the agents back for sensing. So the fleet starts first, hands over
   * its buffers, and only then learns where anybody is.
   */
  const onReady = useCallback((result: SetupResult) => {
    const nextFleet = new Fleet({
      /*
        Read per fix, not captured. The operator can move the anchor pin while
        the demo is running, and every phone has to answer against where the
        site is *now* — a captured frame would leave sixty phones reporting
        positions in a frame the building had left.
      */
      frame: () => {
        const s = useBuildingStore.getState();
        return { anchor: s.anchorLatLon, origin: s.anchorPoint };
      },
      // Only reached before a context source is attached, and for any worker
      // the simulation does not own.
      getContext: () => ({
        position: { x: 0, z: 0 }, floor: '1', moving: false, noiseDbFs: -40,
        noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true,
      }),
    });
    nextFleet.start(result.session, result.workers);

    const nextAgents = createAgents({
      site: useBuildingStore.getState().site,
      indices: result.workers.map((w) => w.index),
      buffers: nextFleet.buffersByIndex(),
      restingHrFor: seedRestingHrFor,
      rand: Math.random,
    });
    nextFleet.attachContextSource(nextAgents);

    setSession(result.session);
    setRoster(result.workers);
    setFleet(nextFleet);
    setAgents(nextAgents);
  }, []);

  // Sixty live WebSockets must not survive the component that opened them —
  // a hot reload or an unmount would otherwise leave them connected, still in
  // the server's fan-out, collecting a pending response row per event.
  useEffect(() => () => fleet?.stop(), [fleet]);

  // The preview engine holds an interval; it must not outlive the component.
  useEffect(() => () => healthWatch?.stop(), [healthWatch]);

  useEffect(() => {
    if (!preview || agents) return;
    useBuildingStore.getState().setSite(preview);
    const indices = Array.from({ length: PREVIEW_WORKERS }, (_, i) => i + 1);
    const buffers = new Map(indices.map((i) => [i, new VitalsBuffer()]));
    const seedAt = Date.now();
    for (const [i, buffer] of buffers) {
      buffer.seed(seedRestingHrFor(i), seedAt);
      buffer.setSpo2(INITIAL_SPO2, seedAt);
    }
    setPreviewBuffers(buffers);
    /*
      The risk engine, with no accounts behind it. Without this the vitals
      dials had nothing to drive in preview — you could take a worker to
      180 bpm and the watch would sit there saying NORMAL, which reads as a
      broken feature rather than an absent one.
    */
    setHealthWatch(
      createHealthWatch({
        buffers,
        restingHrFor: seedRestingHrFor,
        dateOfBirthFor: (i) => workerIdentity('preview', i).dateOfBirth,
      }),
    );
    setAgents(
      createAgents({
        site: useBuildingStore.getState().site,
        indices,
        buffers,
        restingHrFor: seedRestingHrFor,
        rand: Math.random,
      }),
    );
  }, [preview, agents]);

  /**
   * Tear everything down and go back to the setup screen.
   *
   * The fleet is stopped explicitly rather than left to the unmount effect:
   * sixty sockets must be closed before the next session opens sixty more,
   * and `setFleet(null)` alone would only schedule that for whenever React
   * got around to it.
   */
  const endSession = useCallback(() => {
    fleet?.stop();
    setControlledIndex(null);
    setFleet(null);
    setAgents(null);
    setSession(null);
    setRoster([]);
    useBuildingStore.getState().reset();
  }, [fleet]);

  /**
   * Who is being driven. Held in React rather than read from `agents` because
   * the scene has to re-render when it changes, and `agents` is a mutable
   * object the render loop reads — changing a field on it would move the
   * marker only on the next frame that happened to re-render for another
   * reason.
   */
  const [controlledIndex, setControlledIndex] = useState<number | null>(null);

  /*
    Keep the site's origin under the driven worker while following is on.

    Sampled rather than written every frame: this is a geographic origin, and
    updating it four times a second puts it within a few centimetres of him at
    walking pace while costing four store writes instead of two hundred and
    forty. The phones read the frame per fix, so they always see the latest
    value regardless of how often it changes.
  */
  const followsControlled = useBuildingStore((s) => s.anchorFollowsControlled);
  useEffect(() => {
    if (!agents || !followsControlled || controlledIndex === null) return;
    const timer = setInterval(() => {
      const state = agents.controlledState();
      if (!state) return;
      useBuildingStore.setState({
        anchorPoint: { floorId: state.floorId, x: state.position.x, z: state.position.z },
      });
    }, 250);
    return () => clearInterval(timer);
  }, [agents, followsControlled, controlledIndex]);

  const takeControl = useCallback(
    (index: number | null) => {
      agents?.takeControl(index);
      setControlledIndex(index);
    },
    [agents],
  );

  const workerAccess: WorkerAccess = useMemo(
    () => ({
      phone: (index) => fleet?.phoneFor(index) ?? null,
      buffer: (index) => fleet?.buffer(index) ?? previewBuffers?.get(index) ?? null,
      name: (index) => {
        const worker = roster.find((w) => w.index === index);
        return worker ? `${worker.firstName} ${worker.lastName}` : `Worker ${index}`;
      },
      health: (index) => {
        const phone = fleet?.phoneFor(index);
        const raised = phone ? phone.lastHealthAlert : (healthWatch?.stateFor(index).raised ?? null);
        const band = phone ? phone.riskBand : (healthWatch?.stateFor(index).band ?? 'normal');
        return {
          band,
          raised: raised ? { band: raised.band, reason: raised.reason, at: raised.at } : null,
          // The watch surface, identical whichever engine produced it — that
          // sameness is the point: the panel must not be able to tell.
          alert: raised
            ? {
                band: raised.band,
                title: raised.title,
                reason: raised.reason,
                delivery: raised.delivery,
                acknowledged: raised.acknowledged,
              }
            : null,
        };
      },
      offboard: (index) => {
        const worker = roster.find((w) => w.index === index);
        const token = session?.adminAccessToken;
        if (!worker || !token) return null;
        return async () => {
          const result = await offboardWorker(worker.userId, token);
          // Their phone is finished: the server closed the socket and will
          // refuse every future call, so keeping it in the fleet would leave a
          // client retrying against an account that is gone.
          fleet?.retire(index);
          return result;
        };
      },
      acknowledgeHealth: async (index) => {
        const phone = fleet?.phoneFor(index);
        if (phone) await phone.acknowledgeHealth(Date.now());
        else healthWatch?.acknowledge(index);
      },
    }),
    [fleet, previewBuffers, roster, healthWatch, session],
  );

  /*
    Dev convenience, mirroring `window.__building`. Genuinely useful in a demo
    too — driving the controlled worker to a known spot from the console beats
    steering him there by hand — and it is how click-to-move was isolated from
    the routing underneath it when the two were first wired together.
  */
  useEffect(() => {
    (window as unknown as { __sim: unknown }).__sim = {
      controlled: () => agents?.controlledState() ?? null,
      walkTo: (x: number, z: number) => agents?.walkControlledTo({ x, z }),
      destination: () => agents?.controlledDestination() ?? null,
      takeControl: (index: number | null) => takeControl(index),
    };
  }, [agents, takeControl]);

  const controlled =
    controlledIndex === null
      ? null
      : { index: controlledIndex, name: workerAccess.name(controlledIndex) };

  if (!fleet && !preview) return <SetupScreen onReady={onReady} />;

  return (
    <>
      <Scene agents={agents} controlled={controlled} />
      <Hud
        site={site}
        agents={agents}
        adminToken={session?.adminAccessToken ?? null}
        companyName={session?.companyName ?? null}
        joinCode={session?.joinCode ?? null}
        workers={workerAccess}
        onEndSession={endSession}
        controlledIndex={controlledIndex}
        onTakeControl={takeControl}
        onMoveControlledToFloor={(floorId) => agents?.moveControlledToFloor(floorId)}
      />
    </>
  );
}
