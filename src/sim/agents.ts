/**
 * Every worker's agent, ticked together, and the bridge from where a worker
 * *is* to what their phone *senses*.
 *
 * This is the only place that knows both halves. The agent knows the scene and
 * nothing about phones; `VirtualPhone` knows the vendored decision modules and
 * nothing about the scene. `contextFor` is the translation between them, and it
 * is deliberately the narrowest possible surface: plain values, exactly as a
 * real handset receives them from its own sensors.
 */
import type { SiteDef, Vec2 } from '@/sites/types';
import { buildGrid, nearestWalkable, type Grid } from '@/sim/navmesh';
import { createAgent, type Agent, type AgentState } from '@/sim/agent';
import { createControlledAgent, type ControlInput, type ControlledAgent } from '@/sim/controlled';
import { roleForIndex } from '@/sim/roles';
import type { PhoneContext } from '@/phone/VirtualPhone';
import type { VitalsBuffer } from '@/phone/vitalsBuffer';
import { advancePhysiology, initialPhysiology, type PhysiologyState } from '@/phone/physiology';

/**
 * Ambient noise near a running machine, dBFS. The vendored threshold is −25,
 * so anything at or above that reads as loud and suppresses the sound channel.
 * Values are per machine kind because a reactor hall and a packing line do not
 * sound the same, and the modality demo is more interesting when the floor is
 * not uniformly quiet.
 */
const MACHINE_NOISE_DBFS: Record<string, number> = {
  reactor: -18,
  press: -20,
  furnace: -22,
  packer: -28,
  chiller: -30,
  panel: -38,
};

/** Beyond this many metres a machine no longer dominates the ambient level. */
const NOISE_RADIUS_M = 6;

/** A quiet corridor with nothing running nearby. */
const AMBIENT_QUIET_DBFS = -48;

/**
 * The mic monitor samples every ~20 s in the app, so a reading is typically a
 * few seconds old. Reported honestly rather than as 0 so the vendored
 * staleness branch is reachable at all.
 */
const NOISE_SAMPLE_AGE_MS = 4_000;

/** A phone's location fix is likewise not instantaneous. */
const GPS_FIX_AGE_MS = 3_000;

/**
 * Returned for an index with no agent — a phone must never crash the tick loop.
 *
 * Built fresh each call rather than shared: `Object.freeze` is shallow, so a
 * single frozen instance would still hand every caller the same mutable
 * `position` object, and one caller normalising it in place would silently
 * move every unknown worker.
 */
function safeContext(): PhoneContext {
  return {
    position: { x: 0, z: 0 },
    floor: null,
    moving: false,
    noiseDbFs: AMBIENT_QUIET_DBFS,
    noiseAgeMs: NOISE_SAMPLE_AGE_MS,
    gpsAgeMs: GPS_FIX_AGE_MS,
    stepsReadable: true,
  };
}

export type Agents = {
  tick(dtMs: number, nowMs: number): void;
  /**
   * Take control of one worker, or release control with `null`.
   *
   * The controlled worker is driven rather than dispatched, but is otherwise
   * an ordinary member of the set: same state shape, same physiology, same
   * context handed to the same phone. Nothing downstream knows the difference,
   * which is what makes driving him tell you anything about the other sixty.
   */
  takeControl(index: number | null): void;
  controlledIndex(): number | null;
  setControlInput(input: ControlInput): void;
  /** Send the controlled worker to another floor. */
  moveControlledToFloor(floorId: string): void;
  /** Walk the controlled worker to a point on the floor he is on. */
  walkControlledTo(target: Vec2): void;
  /** Where the controlled worker is, for the camera to follow. */
  controlledState(): AgentState | null;
  /** Where he is heading under click-to-move, if anywhere. */
  controlledDestination(): Vec2 | null;
  contextFor(index: number): PhoneContext;
  stateFor(index: number): AgentState | undefined;
  all(): AgentState[];
  grids(): Map<string, Grid>;
};

export type AgentsOptions = {
  site: SiteDef;
  indices: number[];
  buffers: Map<number, VitalsBuffer>;
  restingHrFor: (index: number) => number;
  rand: () => number;
  /** indices that must NOT be simulated — a real handset owns them (Phase 2B) */
  excluded?: ReadonlySet<number>;
};

/** Spread the roster over the floors rather than stacking everyone on one. */
function startFloorFor(site: SiteDef, index: number): string {
  return site.floors[(index - 1) % site.floors.length].id;
}

function startPositionOn(site: SiteDef, grids: Map<string, Grid>, floorId: string, index: number): Vec2 {
  const floor = site.floors.find((f) => f.id === floorId)!;
  const anchors = floor.anchors;
  const anchor = anchors[index % anchors.length] ?? anchors[0];
  const grid = grids.get(floorId)!;
  return nearestWalkable(grid, anchor.position) ?? anchor.position;
}

export function createAgents(opts: AgentsOptions): Agents {
  const { site, indices, buffers, restingHrFor, rand } = opts;
  const excluded = opts.excluded ?? new Set<number>();

  const grids = new Map(site.floors.map((f) => [f.id, buildGrid(f)]));
  const agents = new Map<number, Agent>();
  /** indices already reported as failed, so the console logs each once */
  const reported = new Set<number>();
  const physiology = new Map<number, PhysiologyState>();

  for (const index of indices) {
    if (excluded.has(index)) continue;
    const floorId = startFloorFor(site, index);
    agents.set(
      index,
      createAgent({
        index,
        role: roleForIndex(index),
        site,
        grids,
        start: { floorId, position: startPositionOn(site, grids, floorId, index) },
        // Each worker gets its own offset into the shared sequence, or sixty
        // workers would choose the same job in lockstep.
        rand: makeOffsetRand(rand, index),
      }),
    );
    physiology.set(index, initialPhysiology(restingHrFor(index)));
  }

  /** Loudest machine within NOISE_RADIUS_M, else a quiet corridor. */
  function noiseAt(floorId: string, position: Vec2): number {
    const floor = site.floors.find((f) => f.id === floorId);
    if (!floor) return AMBIENT_QUIET_DBFS;
    let loudest = AMBIENT_QUIET_DBFS;
    for (const machine of floor.machines) {
      const distance = Math.hypot(
        machine.position.x - position.x,
        machine.position.z - position.z,
      );
      if (distance > NOISE_RADIUS_M) continue;
      // Linear falloff to the quiet floor at the radius edge. dBFS is negative
      // and closer to zero is louder, so this interpolates upward toward the
      // machine's own level.
      const source = MACHINE_NOISE_DBFS[machine.kind] ?? AMBIENT_QUIET_DBFS;
      const level = AMBIENT_QUIET_DBFS + (source - AMBIENT_QUIET_DBFS) * (1 - distance / NOISE_RADIUS_M);
      if (level > loudest) loudest = level;
    }
    return loudest;
  }

  /** The driven worker, if anyone is driving. */
  let controlled: { index: number; agent: ControlledAgent } | null = null;

  return {
    takeControl(index) {
      if (index === null) {
        // Hand him back to the job system, wherever he happens to be standing.
        if (controlled) {
          const { index: was, agent } = controlled;
          agents.set(
            was,
            createAgent({
              index: was,
              role: roleForIndex(was),
              site,
              grids,
              start: { floorId: agent.state.floorId, position: { ...agent.state.position } },
              rand: makeOffsetRand(rand, was),
            }),
          );
        }
        controlled = null;
        return;
      }

      const existing = agents.get(index);
      if (!existing) return;
      // He carries on from exactly where the job system left him, rather than
      // teleporting to a start position — the demo is watched, and a worker
      // that jumps when you select him reads as a bug.
      const agent = createControlledAgent({
        index,
        site,
        grids,
        start: { floorId: existing.state.floorId, position: { ...existing.state.position } },
      });
      agent.state.facing = existing.state.facing;
      agents.set(index, agent);
      controlled = { index, agent };
    },

    controlledIndex() {
      return controlled?.index ?? null;
    },

    setControlInput(input) {
      controlled?.agent.setInput(input);
    },

    moveControlledToFloor(floorId) {
      controlled?.agent.moveToFloor(floorId);
    },

    walkControlledTo(target) {
      controlled?.agent.walkTo(target);
    },

    controlledState() {
      return controlled?.agent.state ?? null;
    },

    controlledDestination() {
      return controlled?.agent.destination() ?? null;
    },

    tick(dtMs, nowMs) {
      for (const [index, agent] of agents) {
        // One agent must never take down the other fifty-nine. This runs
        // inside the render loop, so an exception here stops the whole scene,
        // not just this worker — and the same reasoning already governs
        // `contextFor`'s SAFE_CONTEXT on the other side of this module.
        try {
          agent.tick(dtMs);
          const buffer = buffers.get(index);
          const state = physiology.get(index);
          if (!buffer || !state) continue;
          physiology.set(
            index,
            advancePhysiology(
              state,
              agent.state.activity,
              agent.state.movedThisTick,
              restingHrFor(index),
              dtMs,
              nowMs,
              buffer,
            ),
          );
        } catch (e) {
          if (!reported.has(index)) {
            reported.add(index);
            console.error(`[agents] worker ${index} failed and is now idle:`, e);
          }
          agents.delete(index);
        }
      }
    },

    contextFor(index) {
      const agent = agents.get(index);
      if (!agent) return safeContext();
      const { floorId, position, activity } = agent.state;
      return {
        position: { ...position },
        floor: floorId,
        // Climbing a stairwell is movement as far as a phone's step counter is
        // concerned, and the modality table's "not looking at the screen"
        // reasoning applies at least as strongly on stairs.
        moving: activity === 'walking' || activity === 'climbing',
        noiseDbFs: noiseAt(floorId, position),
        noiseAgeMs: NOISE_SAMPLE_AGE_MS,
        gpsAgeMs: GPS_FIX_AGE_MS,
        stepsReadable: true,
      };
    },

    stateFor(index) {
      return agents.get(index)?.state;
    },

    all() {
      return [...agents.values()].map((a) => a.state);
    },

    grids() {
      return grids;
    },
  };
}

/**
 * Decorrelate a shared random source per worker.
 *
 * Every agent draws from the same `rand`, and in a test that is often a short
 * repeating sequence. Without an offset, sixty workers advance through it in
 * lockstep and all choose the same job on the same tick — which looks like a
 * flock rather than a workforce.
 */
function makeOffsetRand(rand: () => number, index: number): () => number {
  let burned = false;
  return () => {
    if (!burned) {
      burned = true;
      for (let i = 0; i < index % 7; i++) rand();
    }
    return rand();
  };
}
