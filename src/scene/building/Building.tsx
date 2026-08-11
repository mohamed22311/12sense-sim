import { useFrame } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as THREE from 'three';
import type { SiteDef } from '@/sites/types';
import type { Agents } from '@/sim/agents';
import type { Activity } from '@/sim/jobs';
import { FloorSlab } from '@/scene/building/FloorSlab';
import { AlertZone } from '@/scene/building/AlertZone';
import { WristWatch } from '@/scene/building/WristWatch';
import type { WatchAlert } from '@/ui/hud/WatchFace';
import { Portals } from '@/scene/building/Portals';
import { SimWorker } from '@/scene/building/SimWorker';
import { AnchorPin } from '@/scene/building/AnchorPin';
import { useBuildingStore } from '@/state/buildingStore';
import { createQualitySampler } from '@/quality/detect';

/**
 * The dollhouse: six floors stacked, one lit, the rest dimmed.
 *
 * This component owns the simulation clock. `agents.tick` advances every worker
 * and writes their vitals, and it runs here — inside the render loop — so
 * movement is frame-rate coherent and a backgrounded tab does not accumulate a
 * burst of simulated walking to replay on return.
 *
 * **Position and facing are written straight to the three.js objects**, not
 * through React. Routing sixty moving workers through state re-rendered the
 * whole crowd sixteen times a second and showed up as a p90 frame time of
 * 44 ms against a 19 ms median — the reconciler, not the GPU. React now owns
 * only what changes rarely: which workers exist, what each is doing, and which
 * floor they are on.
 */

export type BuildingProps = {
  site: SiteDef;
  /** the driven worker's index and display name, or null if nobody is driving */
  controlled: { index: number; name: string } | null;
  /**
   * Null until provisioning finishes. The building still draws — an empty site
   * is a far better thing to look at while sixty accounts register than a
   * blank canvas, and it makes the transition to a populated floor seamless.
   */
  agents: Agents | null;
  /**
   * What the watch on the close-up worker's wrist should show, and what its
   * buttons do. Null when nobody is in close-up, or when that worker's alert
   * has been answered and there is nothing left to render.
   */
  watch: WatchBinding | null;
};

export type WatchBinding = {
  alert: WatchAlert;
  busy: boolean;
  onAcknowledge(): void;
  onSnooze(minutes: number): void;
  onReject(): void;
  onClose(): void;
};

/** Simulation seconds per real second. 1 = real time. */
const TIME_SCALE = 1;

/** Cap a single tick, so a backgrounded tab does not replay minutes at once. */
const MAX_TICK_MS = 250;

/** Keys that steer the driven worker. Both WASD and the arrow cluster. */
const DRIVE_KEYS = new Set([
  'w', 'a', 's', 'd',
  'arrowup', 'arrowleft', 'arrowdown', 'arrowright',
]);

/** What React needs to know about a worker — everything that changes rarely. */
type WorkerSlot = { index: number; activity: Activity; floorId: string };

const floorElevation = (site: SiteDef, floorId: string) =>
  site.floors.find((f) => f.id === floorId)?.elevation ?? 0;

const slotsEqual = (a: WorkerSlot[], b: WorkerSlot[]) =>
  a.length === b.length &&
  a.every((slot, i) => {
    const other = b[i];
    return (
      slot.index === other.index &&
      slot.activity === other.activity &&
      slot.floorId === other.floorId
    );
  });

export function Building({ site, agents, controlled, watch }: BuildingProps) {
  const activeFloorId = useBuildingStore((s) => s.activeFloorId);
  const setActiveFloor = useBuildingStore((s) => s.setActiveFloor);
  const qualityTier = useBuildingStore((s) => s.qualityTier);
  const setQualityTier = useBuildingStore((s) => s.setQualityTier);
  const selectWorker = useBuildingStore((s) => s.selectWorker);
  const selectedWorkerIndex = useBuildingStore((s) => s.selectedWorkerIndex);
  const anchorPoint = useBuildingStore((s) => s.anchorPoint);
  const radiusPreview = useBuildingStore((s) => s.radiusPreview);
  const closeUpIndex = useBuildingStore((s) => s.closeUpIndex);
  const placingAnchor = useBuildingStore((s) => s.placingAnchor);
  const setAnchorPoint = useBuildingStore((s) => s.setAnchorPoint);

  const [slots, setSlots] = useState<WorkerSlot[]>([]);
  const slotsRef = useRef<WorkerSlot[]>([]);
  const groups = useRef(new Map<number, THREE.Group>());
  const sampler = useRef(createQualitySampler());
  /** live metres-per-second per worker, refreshed each frame */
  const speeds = useRef(new Map<number, number>());
  /**
   * One stable getter per worker. Created once and reused, because SimWorker is
   * memoised on identity — handing it a fresh closure each render would defeat
   * the memo and re-render the whole crowd every frame.
   */
  const speedGetters = useRef(new Map<number, () => number>());

  const elevations = useMemo(
    () => new Map(site.floors.map((f) => [f.id, f.elevation])),
    [site],
  );

  const registerGroup = useCallback((index: number, group: THREE.Group | null) => {
    if (group) groups.current.set(index, group);
    else groups.current.delete(index);
  }, []);

  /**
   * Click-to-move, but only on the floor he is actually on. Clicking floor 4
   * while driving someone on floor 1 means "look at floor 4" — which the slab
   * click already does — not "walk through the ceiling".
   */
  const walkTo = useCallback(
    (floorId: string, at: { x: number; z: number }) => {
      // Placing the anchor takes the click outright. It is a deliberate mode
      // the operator entered, and it ends on the first click — so it can never
      // be the thing that quietly ate a click they meant for something else.
      if (placingAnchor) {
        setAnchorPoint({ floorId, x: at.x, z: at.z });
        return;
      }
      if (!agents || !controlled) return;
      if (agents.controlledState()?.floorId !== floorId) return;
      agents.walkControlledTo(at);
    },
    [agents, controlled, placingAnchor, setAnchorPoint],
  );

  const speedGetterFor = useCallback((index: number) => {
    const existing = speedGetters.current.get(index);
    if (existing) return existing;
    const getter = () => speeds.current.get(index) ?? 0;
    speedGetters.current.set(index, getter);
    return getter;
  }, []);

  /*
    Driving, on the keyboard.

    The listener is on the window rather than the canvas because the canvas
    only has focus after a click, and a demonstrator who has just used the HUD
    would otherwise press W and watch nothing happen. Held keys are tracked in
    a ref and read on the frame — reading key *events* would tie walking speed
    to the operating system's key-repeat rate.
  */
  useEffect(() => {
    if (!agents || !controlled) return;
    const held = new Set<string>();

    const axis = () => ({
      x: (held.has('d') || held.has('arrowright') ? 1 : 0) -
        (held.has('a') || held.has('arrowleft') ? 1 : 0),
      // Pushing "up" walks away from the camera, which sits on +z.
      z: (held.has('s') || held.has('arrowdown') ? 1 : 0) -
        (held.has('w') || held.has('arrowup') ? 1 : 0),
    });

    const isTyping = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable);

    const onDown = (e: KeyboardEvent) => {
      // Someone typing a message into the alert dialog is not steering.
      if (isTyping(e.target)) return;
      const key = e.key.toLowerCase();
      if (!DRIVE_KEYS.has(key)) return;
      e.preventDefault();
      held.add(key);
      agents.setControlInput(axis());
    };
    const onUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (!held.delete(key)) return;
      agents.setControlInput(axis());
    };
    // A window that loses focus keeps no keys held, or he walks off on his own.
    const onBlur = () => {
      held.clear();
      agents.setControlInput({ x: 0, z: 0 });
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      agents.setControlInput({ x: 0, z: 0 });
    };
  }, [agents, controlled]);

  useFrame((_, delta) => {
    // Judged on the real frame delta, not the capped simulation step: the
    // question is how fast this machine is drawing, which a cap would hide.
    const measured = sampler.current.sample(delta * 1000);
    if (measured) setQualityTier(measured);

    if (!agents) return;
    const dtMs = Math.min(MAX_TICK_MS, delta * 1000 * TIME_SCALE);
    agents.tick(dtMs, Date.now());

    const states = agents.all();
    const dtSeconds = Math.max(0.001, dtMs / 1000);

    // Transforms: straight onto the objects, every frame, no reconciliation.
    for (const state of states) {
      speeds.current.set(state.index, state.movedThisTick / dtSeconds);
      const group = groups.current.get(state.index);
      if (!group) continue;
      group.position.set(
        state.position.x,
        elevations.get(state.floorId) ?? 0,
        state.position.z,
      );
      group.rotation.y = state.facing;
    }

    // Everything React owns changes rarely, so only commit when it actually did.
    const next = states.map((s) => ({
      index: s.index,
      activity: s.activity,
      floorId: s.floorId,
    }));
    if (!slotsEqual(next, slotsRef.current)) {
      slotsRef.current = next;
      setSlots(next);
    }
  });

  // On `high` every worker keeps arms and bands wherever they are; below that,
  // only the floor being looked at does.
  const detailedOnDimFloors = qualityTier === 'high';

  return (
    <group>
      {site.floors.map((floor) => (
        <FloorSlab
          key={floor.id}
          floor={floor}
          active={floor.id === activeFloorId}
          style={site.style}
          onSelect={setActiveFloor}
          onWalkTo={walkTo}
        />
      ))}

      <Portals site={site} />

      {/* The reach of the alert being composed, on the floor it will be raised
          on. Nothing is drawn unless the radius control is open. */}
      {radiusPreview && (
        <group position={[0, floorElevation(site, radiusPreview.floorId), 0]}>
          <AlertZone
            x={radiusPreview.x}
            z={radiusPreview.z}
            radiusM={radiusPreview.radiusM}
            active={radiusPreview.floorId === activeFloorId}
          />
        </group>
      )}

      <group position={[0, floorElevation(site, anchorPoint.floorId), 0]}>
        <AnchorPin
          x={anchorPoint.x}
          z={anchorPoint.z}
          active={anchorPoint.floorId === activeFloorId}
        />
      </group>

      {slots.map((slot) => (
        <group
          key={slot.index}
          ref={(g) => registerGroup(slot.index, g)}
          onClick={(e) => {
            e.stopPropagation();
            selectWorker(slot.index);
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            document.body.style.cursor = 'pointer';
          }}
          onPointerOut={() => {
            document.body.style.cursor = '';
          }}
        >
          <SimWorker
            index={slot.index}
            activity={slot.activity}
            detailed={slot.floorId === activeFloorId || detailedOnDimFloors}
            getSpeed={speedGetterFor(slot.index)}
            selected={slot.index === selectedWorkerIndex}
            controlledName={controlled?.index === slot.index ? controlled.name : null}
            checkingWatch={slot.index === closeUpIndex}
            /* One watch, on one wrist, only while the camera is there to read
               it. Sixty transformed DOM subtrees would cost more than the rest
               of the scene put together. */
            watch={
              slot.index === closeUpIndex && watch ? (
                <WristWatch
                  alert={watch.alert}
                  busy={watch.busy}
                  onAcknowledge={watch.onAcknowledge}
                  onSnooze={watch.onSnooze}
                  onReject={watch.onReject}
                  onClose={watch.onClose}
                />
              ) : null
            }
          />
        </group>
      ))}
    </group>
  );
}
