import { useEffect, useMemo, useState } from 'react';
import type { Agents } from '@/sim/agents';
import type { MachineDef, SiteDef } from '@/sites/types';
import { fetchEventStatus, isEventOpen, type RaiseAlertResult } from '@/net/alerts';
import type { Modality, RiskBand } from '@/api/types';
import { useBuildingStore } from '@/state/buildingStore';
import { MachineDialog } from '@/ui/hud/MachineDialog';
import { SitePositionDialog } from '@/ui/hud/SitePositionDialog';
import { RealPhoneDialog } from '@/ui/hud/RealPhoneDialog';
import { focusCameraOn, resetCamera } from '@/scene/cameraFocus';
import { WorkerPanel, type WorkerSample } from '@/ui/hud/WorkerPanel';
import { EndSession } from '@/ui/hud/EndSession';
import { ReachPanel, type ReachBreakdown } from '@/ui/hud/ReachPanel';
import type { VirtualPhone } from '@/phone/VirtualPhone';
import type { VitalsBuffer } from '@/phone/vitalsBuffer';

/**
 * The operator's console.
 *
 * A dollhouse of a tall, narrow building leaves most of a widescreen frame
 * empty, and the answer to that is not to zoom until the workers are specks —
 * it is to put something worth reading beside it. What an operator running
 * this demo needs to see is where the people are, what they are doing, and
 * what is currently in alarm, none of which is legible from sixty three-inch
 * figures at thirty metres.
 *
 * Everything here samples the simulation on a timer rather than riding the
 * render loop. The scene redraws sixty times a second; a headcount that
 * changes when someone climbs a staircase does not need to.
 */

/** How often the panels re-read the simulation. */
const SAMPLE_MS = 700;

/**
 * How the HUD reaches one worker's phone and vitals.
 *
 * A narrow seam rather than the whole fleet: the panel needs exactly three
 * things about one index, and handing it the fleet would let it reach anyone.
 * It also lets `?preview` supply buffers with no accounts behind them, which
 * is how the vitals dials are iterated on without provisioning sixty tenants.
 */
export type WorkerAccess = {
  phone(index: number): VirtualPhone | null;
  buffer(index: number): VitalsBuffer | null;
  name(index: number): string;
  /**
   * What the risk engine currently says about this worker.
   *
   * Read through the seam rather than off the phone, because in `?preview`
   * there is no phone and the engine runs standalone — same vendored modules,
   * same thresholds, no account. The panel must not have to know which.
   */
  health(index: number): {
    band: RiskBand;
    raised: WorkerSample['health'];
    alert: {
      band: 'caution' | 'danger';
      title: string;
      reason: string;
      delivery: { sound: boolean; vibrate: boolean; headsUp: boolean; fullScreen: boolean };
      acknowledged: boolean;
    } | null;
  };
  /** The worker answered a health alert. */
  acknowledgeHealth(index: number): Promise<void>;
  /**
   * Remove this worker from the company. Null in `?preview` and for any worker
   * whose server id is unknown — there is nothing to offboard.
   */
  offboard(index: number): (() => Promise<{ devices_removed: number; sockets_closed: number }>) | null;
};

export type HudProps = {
  site: SiteDef;
  agents: Agents | null;
  /** null in `?preview` — no tenant exists, so nothing can be raised */
  adminToken: string | null;
  companyName: string | null;
  /** the company's enrolment code, for putting a real handset in the demo */
  joinCode: string | null;
  workers: WorkerAccess;
  /** tears the session down and returns to setup; absent in `?preview` */
  onEndSession?: () => void;
  /** who is being driven, and how to take or release control */
  controlledIndex: number | null;
  onTakeControl(index: number | null): void;
  onMoveControlledToFloor(floorId: string): void;
};

type FloorSample = { id: string; label: string; headcount: number; moving: number };

/**
 * The channels the app's modality decision turned on, as words.
 *
 * `decideModality` returns a record of booleans; the watch shows the ones that
 * are true. Read here rather than in the panel so the panel stays a renderer
 * of a snapshot and never touches a vendored type.
 */
function modalityChannels(modality: Modality): string[] {
  return (['visual', 'haptic', 'sound'] as const).filter((channel) => modality[channel]);
}

/**
 * A health alert's delivery, as the same three chips a group alert shows.
 *
 * Read off the app's own `DeliveryPlan` rather than re-deriving: `vibrate` is
 * the haptic floor and is always true, `headsUp` or `fullScreen` is what makes
 * it visible, and `sound` is the one a loud plant masks.
 */
function deliveryChannels(plan: {
  sound: boolean;
  vibrate: boolean;
  headsUp: boolean;
  fullScreen: boolean;
}): string[] {
  const channels: string[] = [];
  if (plan.headsUp || plan.fullScreen) channels.push('visual');
  if (plan.vibrate) channels.push('haptic');
  if (plan.sound) channels.push('sound');
  return channels;
}

export function Hud({
  site,
  agents,
  adminToken,
  companyName,
  joinCode,
  workers,
  onEndSession,
  controlledIndex,
  onTakeControl,
  onMoveControlledToFloor,
}: HudProps) {
  const activeFloorId = useBuildingStore((s) => s.activeFloorId);
  const setActiveFloor = useBuildingStore((s) => s.setActiveFloor);
  const selectedMachineId = useBuildingStore((s) => s.selectedMachineId);
  const selectedWorkerIndex = useBuildingStore((s) => s.selectedWorkerIndex);
  const selectWorker = useBuildingStore((s) => s.selectWorker);
  const selectMachine = useBuildingStore((s) => s.selectMachine);
  const openAlerts = useBuildingStore((s) => s.openAlerts);
  const setOpenAlerts = useBuildingStore((s) => s.setOpenAlerts);
  const anchorPoint = useBuildingStore((s) => s.anchorPoint);
  const placingAnchor = useBuildingStore((s) => s.placingAnchor);
  const setPlacingAnchor = useBuildingStore((s) => s.setPlacingAnchor);
  const anchorFollows = useBuildingStore((s) => s.anchorFollowsControlled);
  const setAnchorFollows = useBuildingStore((s) => s.setAnchorFollowsControlled);
  const anchorLatLon = useBuildingStore((s) => s.anchorLatLon);
  const anchorSource = useBuildingStore((s) => s.anchorSource);
  const setAnchorLatLon = useBuildingStore((s) => s.setAnchorLatLon);
  const [locating, setLocating] = useState(false);
  const [positionOpen, setPositionOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const alertRadiusM = useBuildingStore((s) => s.alertRadiusM);
  const setAlertRadiusM = useBuildingStore((s) => s.setAlertRadiusM);
  const [locateError, setLocateError] = useState<string | null>(null);

  /**
   * Ask the browser where we are, and hang the site off that.
   *
   * Only needed when a physical handset is in the demo: every distance inside
   * the simulation is relative, so until a real phone has to agree with it,
   * one coordinate is as good as another. When one does, this is how the
   * number arrives without anybody typing it.
   */
  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setLocateError('This browser has no geolocation.');
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setAnchorLatLon(
          { latitude: position.coords.latitude, longitude: position.coords.longitude },
          'device',
        );
        setLocating(false);
      },
      (error) => {
        setLocateError(error.message);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  const [floors, setFloors] = useState<FloorSample[]>([]);
  const [headcount, setHeadcount] = useState(0);
  const [worker, setWorker] = useState<WorkerSample | null>(null);
  const [reach, setReach] = useState<ReachBreakdown | null>(null);

  /*
    Drop alerts the server has resolved.

    An alert resolves on the *first* acknowledgement, and that can be a phone
    in someone's hand rather than a click in this window — so the console
    cannot know from its own actions when something stops being open. Without
    this the alarm list was a record of what this browser had raised, which
    drifts from the truth the moment anybody answers, and left the operator
    reading a panel that disagreed with the dispatcher beside it.
  */
  useEffect(() => {
    if (!adminToken || openAlerts.length === 0) return;
    let cancelled = false;
    const controller = new AbortController();

    const poll = async () => {
      const checks = await Promise.all(
        openAlerts.map(async (alert) => {
          try {
            const status = await fetchEventStatus(alert.eventId, adminToken, controller.signal);
            return { alert, open: isEventOpen(status) };
          } catch {
            // A failed check must never clear an alert: not knowing is not the
            // same as resolved, and silently dropping a live alarm because a
            // request timed out is the worst possible failure here.
            return { alert, open: true };
          }
        }),
      );
      if (cancelled) return;
      const stillOpen = checks.filter((c) => c.open).map((c) => c.alert);
      if (stillOpen.length !== openAlerts.length) setOpenAlerts(stillOpen);
    };

    const timer = setInterval(poll, 4_000);
    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [adminToken, openAlerts, setOpenAlerts]);

  const machinesById = useMemo(() => {
    const map = new Map<string, MachineDef>();
    for (const floor of site.floors) for (const m of floor.machines) map.set(m.id, m);
    return map;
  }, [site]);

  useEffect(() => {
    const blank = site.floors.map((f) => ({
      id: f.id,
      label: f.label,
      headcount: 0,
      moving: 0,
    }));
    if (!agents) {
      setFloors(blank);
      setHeadcount(0);
      return;
    }

    const sample = () => {
      const byFloor = new Map(blank.map((f) => [f.id, { ...f }]));
      const states = agents.all();
      for (const state of states) {
        const row = byFloor.get(state.floorId);
        if (!row) continue;
        row.headcount += 1;
        if (state.movedThisTick > 0) row.moving += 1;
      }
      setFloors([...byFloor.values()]);
      setHeadcount(states.length);

      const index = selectedWorkerIndex;
      if (index === null) {
        setWorker(null);
        return;
      }
      const state = states.find((s) => s.index === index);
      if (!state) {
        setWorker(null);
        return;
      }
      const phone = workers.phone(index);
      const buffer = workers.buffer(index);
      const health = workers.health(index);
      const series = buffer?.hrSeries() ?? [];
      const alert = phone?.activeAlert ?? null;
      setWorker({
        index,
        name: workers.name(index),
        activity: state.activity,
        floorId: state.floorId,
        hr: series.length > 0 ? series[series.length - 1].value : null,
        spo2: buffer?.spo2()?.value ?? null,
        riskBand: health.band,
        health: health.raised,
        healthAlert: health.alert
          ? {
              band: health.alert.band,
              title: health.alert.title,
              reason: health.alert.reason,
              channels: deliveryChannels(health.alert.delivery),
              acknowledged: health.alert.acknowledged,
            }
          : null,
        alert: alert
          ? {
              message: alert.event.message,
              assetLabel: alert.event.asset_label ?? null,
              modality: modalityChannels(alert.modality),
              distanceM: alert.distanceM,
              severity: alert.event.severity ?? 'high',
              // The floor the worker was on when their phone decided, off the
              // snapshot the gate recorded — not where they are standing now.
              workerFloor: alert.snapshot.worker_floor ?? null,
              eventFloor: alert.event.floor ?? null,
              channels: alert.modality,
            }
          : null,
        online: phone !== null,
      });
    };

    sample();
    const timer = setInterval(sample, SAMPLE_MS);
    return () => clearInterval(timer);
  }, [agents, site, workers, selectedWorkerIndex]);

  /*
    Aggregate what each phone decided about the most recent alert.

    Sampled on the same timer as everything else rather than pushed: the
    verdicts land over a second or two as sixty sockets deliver, and a panel
    that re-rendered on each arrival would count up in front of the audience
    instead of settling on an answer.
  */
  useEffect(() => {
    if (openAlerts.length === 0) {
      setReach(null);
      return;
    }
    const newest = openAlerts[openAlerts.length - 1].eventId;

    const sample = () => {
      let received = 0;
      let alarmed = 0;
      let wrongFloor = 0;
      let tooFar = 0;
      let nearestSilent: number | null = null;

      for (const state of agents?.all() ?? []) {
        const verdict = workers.phone(state.index)?.lastVerdict;
        if (!verdict || verdict.eventId !== newest) continue;
        received += 1;
        if (verdict.popped) {
          alarmed += 1;
          continue;
        }
        // The floor gate is checked first because it is the more specific
        // reason: a phone on another floor is excluded regardless of range,
        // and reporting it as "too far" would tell the wrong story.
        if (verdict.floorGate === 'mismatch') wrongFloor += 1;
        else tooFar += 1;
        if (verdict.distanceM !== null) {
          nearestSilent =
            nearestSilent === null ? verdict.distanceM : Math.min(nearestSilent, verdict.distanceM);
        }
      }

      setReach(received === 0 ? null : { received, alarmed, wrongFloor, tooFar, nearestSilent });
    };

    sample();
    const timer = setInterval(sample, SAMPLE_MS);
    return () => clearInterval(timer);
  }, [openAlerts, agents, workers]);

  const busiest = floors.reduce((max, f) => Math.max(max, f.headcount), 0);
  const selectedMachine = selectedMachineId ? machinesById.get(selectedMachineId) : undefined;
  const alertingMachines = openAlerts
    .map((a) => machinesById.get(a.assetId))
    .filter((m): m is MachineDef => m !== undefined);

  const onRaised = (machineId: string, result: RaiseAlertResult) => {
    if (openAlerts.some((a) => a.assetId === machineId)) return;
    setOpenAlerts([...openAlerts, { assetId: machineId, eventId: result.event_id }]);
  };

  const clearAlert = (machineId: string) => {
    setOpenAlerts(openAlerts.filter((a) => a.assetId !== machineId));
  };

  return (
    <>
      <header className="hud-brand">
        <span className="hud-brand-mark">Twelve Senses</span>
        <span className="hud-brand-site">{companyName ?? site.label}</span>
      </header>

      <aside className="hud-panel hud-left" aria-label="Site status">
        {/*
          First in the column, not last. It lives here rather than opposite
          because on the right it sat exactly on top of the floor rail — and
          the rail is how you reach the floor the worker is on. Leading the
          column is what keeps it above the fold: appended after three ambient
          cards, the panel you just opened by clicking was off-screen.
        */}
        {worker && (
          <WorkerPanel
            onFlyTo={() => {
              const state = agents?.stateFor(worker.index);
              if (!state) return;
              const elevation =
                site.floors.find((f) => f.id === state.floorId)?.elevation ?? 0;
              // Head height and close: the point of going to a worker is to
              // see the person, not the top of their helmet.
              focusCameraOn(state.position.x, elevation + 1.2, state.position.z, 2.8);
            }}
            sample={worker}
            phone={workers.phone(worker.index)}
            buffer={workers.buffer(worker.index)}
            onAcknowledgeHealth={() => workers.acknowledgeHealth(worker.index)}
            controlled={controlledIndex === worker.index}
            onToggleControl={() =>
              onTakeControl(controlledIndex === worker.index ? null : worker.index)
            }
            onMoveToFloor={onMoveControlledToFloor}
            floors={site.floors.map((f) => ({ id: f.id, label: f.label }))}
            onOffboard={workers.offboard(worker.index) ?? undefined}
            onClose={() => selectWorker(null)}
          />
        )}

        <section className="hud-card">
          <h2 className="hud-card-title">On site</h2>
          <p className="hud-figure">
            {headcount}
            <span className="hud-figure-unit">workers</span>
          </p>
          <p className="hud-card-note">
            {adminToken
              ? 'Each runs the app’s own decision code.'
              : 'Preview — no accounts exist.'}
          </p>
        </section>

        <section className="hud-card">
          <h2 className="hud-card-title">Distribution</h2>
          <ul className="hud-bars">
            {[...floors].reverse().map((floor) => {
              // Against the busiest floor, not against the total. As a share
              // of sixty, an ordinary floor fills a sixth of its track and all
              // six read as empty — which hides the only thing the chart is
              // for, which is how they differ from each other.
              const share = busiest > 0 ? floor.headcount / busiest : 0;
              return (
                <li
                  key={floor.id}
                  className={`hud-bar${floor.id === activeFloorId ? ' is-active' : ''}`}
                >
                  <button onClick={() => setActiveFloor(floor.id)}>
                    <span className="hud-bar-id">{floor.id}</span>
                    <span className="hud-bar-track">
                      <span
                        className="hud-bar-fill"
                        style={{ transform: `scaleX(${share})` }}
                      />
                    </span>
                    <span className="hud-bar-count">{floor.headcount}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {reach && <ReachPanel reach={reach} />}

        <section className="hud-card">
          <h2 className="hud-card-title">
            In alarm
            {alertingMachines.length > 0 && (
              <span className="hud-badge">{alertingMachines.length}</span>
            )}
          </h2>
          {alertingMachines.length === 0 ? (
            <p className="hud-card-note">
              Nothing raised. Click a machine in the building to raise one.
            </p>
          ) : (
            <ul className="hud-alerts">
              {alertingMachines.map((machine) => (
                <li key={machine.id}>
                  <button
                    className="hud-alert"
                    onClick={() => setActiveFloor(machine.floor)}
                  >
                    <span className="hud-alert-dot" aria-hidden />
                    <span className="hud-alert-name">{machine.label}</span>
                    <span className="hud-alert-floor">Floor {machine.floor}</span>
                  </button>
                  <button
                    className="hud-alert-clear"
                    onClick={() => clearAlert(machine.id)}
                    aria-label={`Clear ${machine.label}`}
                  >
                    Clear
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/*
          Where the site stands on the earth.

          A coordinate, chosen by pointing rather than by typing. Whatever the
          pin sits on becomes the point a real handset is standing at, and the
          whole site relocates around it — nobody in the building moves, and
          every distance between every phone and every alert is preserved,
          because a translation preserves all of them.
        */}
        <section className="hud-card">
          <h2 className="hud-card-title">Site anchor</h2>
          <p className="hud-card-note">
            Floor {anchorPoint.floorId} · {anchorPoint.x.toFixed(1)},{' '}
            {anchorPoint.z.toFixed(1)} m
          </p>
          <button
            className={`btn${placingAnchor ? ' btn-primary' : ''}`}
            onClick={() => setPlacingAnchor(!placingAnchor)}
            aria-pressed={placingAnchor}
          >
            {placingAnchor ? 'Click a floor to place it' : 'Move the anchor'}
          </button>
          {placingAnchor && (
            <p className="hud-card-note">Next click on a floor puts it there.</p>
          )}

          {/*
            The mode that makes a physical handset respond to the simulation.

            A real phone runs the gate on its own device against its own GPS,
            so nothing here can move it. Pinning the origin to the driven
            worker means he stands exactly where the phone is — so walking him
            toward a machine walks that machine toward the phone, and the
            distance the handset computes genuinely changes.
          */}
          <button
            className={`btn${anchorFollows ? ' btn-primary' : ''}`}
            onClick={() => setAnchorFollows(!anchorFollows)}
            disabled={controlledIndex === null}
            aria-pressed={anchorFollows}
          >
            {anchorFollows ? 'Following the driven worker' : 'Pin anchor to driven worker'}
          </button>
          {controlledIndex === null && (
            <p className="hud-card-note">
              Take control of a worker first — this is how a real phone feels
              him move.
            </p>
          )}

          <p className="hud-anchor-geo">
            {anchorLatLon.latitude.toFixed(5)}, {anchorLatLon.longitude.toFixed(5)}
            <span className="hud-anchor-source">
              {anchorSource === 'device'
                ? 'from this device'
                : anchorSource === 'manual'
                  ? 'set by hand'
                  : 'default'}
            </span>
          </p>
          {/*
            Setting it by hand comes first. "Use my location" only ever answers
            where *this laptop* is, which is the wrong answer whenever the demo
            is of a plant somewhere else — and it is the only answer the
            operator had.
          */}
          <button className="btn btn-primary" onClick={() => setPositionOpen(true)}>
            Set position on a map
          </button>
          <button className="btn" onClick={useMyLocation} disabled={locating}>
            {locating ? 'Locating…' : 'Use my location'}
          </button>
          {locateError && <p className="dialog-error" role="alert">{locateError}</p>}
        </section>

        {/* Last in the column: it is the end of the demo, and it is
            destructive. Nothing above it should have to scroll past it. */}
        {/* Not gated on the join code. A resumed session can legitimately have
            none — and hiding the only way to clear the tenant because the
            pairing code is missing would be the wrong thing to lose. */}
        {adminToken && companyName && onEndSession && (
          <EndSession
            adminToken={adminToken}
            companyName={companyName}
            joinCode={joinCode ?? ''}
            onFinished={onEndSession}
            onExplainPhone={() => setPhoneOpen(true)}
          />
        )}
      </aside>

      {phoneOpen && (
        <RealPhoneDialog
          joinCode={joinCode}
          onOpenMap={() => {
            setPhoneOpen(false);
            setPositionOpen(true);
          }}
          onClose={() => setPhoneOpen(false)}
        />
      )}

      {positionOpen && (
        <SitePositionDialog
          zone={{
            lat: anchorLatLon.latitude,
            lon: anchorLatLon.longitude,
            radiusM: alertRadiusM,
          }}
          onApply={(zone) => {
            setAnchorLatLon({ latitude: zone.lat, longitude: zone.lon }, 'manual');
            setAlertRadiusM(zone.radiusM);
            setPositionOpen(false);
          }}
          onClose={() => setPositionOpen(false)}
        />
      )}

      <nav className="hud-panel hud-right floor-rail" aria-label="Floors">
        {[...site.floors].reverse().map((floor) => {
          const sample = floors.find((f) => f.id === floor.id);
          const alarms = alertingMachines.filter((m) => m.floor === floor.id).length;
          return (
            <button
              key={floor.id}
              className={`floor-chip${floor.id === activeFloorId ? ' is-active' : ''}`}
              aria-current={floor.id === activeFloorId ? 'true' : undefined}
              onClick={() => setActiveFloor(floor.id)}
            >
              <span className="floor-chip-id">{floor.id}</span>
              <span className="floor-chip-label">{floor.label}</span>
              <span className="floor-chip-meta">
                {alarms > 0 && <span className="floor-chip-alarm" aria-label={`${alarms} in alarm`} />}
                {sample ? sample.headcount : 0}
              </span>
            </button>
          );
        })}
      </nav>

      <p className="hud-hint">
        Drag to orbit · right-drag or shift-drag to pan · scroll to fly in ·
        double-click a worker, or use “Go to it” on a machine ·{' '}
        <button className="hud-hint-btn" onClick={resetCamera}>
          Esc
        </button>{' '}
        for the whole building
      </p>

      {selectedMachine && (
        <MachineDialog
          machine={selectedMachine}
          agents={agents}
          adminToken={adminToken}
          onClose={() => selectMachine(null)}
          onRaised={onRaised}
        />
      )}
    </>
  );
}
