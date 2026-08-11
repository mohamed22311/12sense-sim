/**
 * One worker: where they are, what they are doing, and how they get to the
 * next thing.
 *
 * The agent owns movement and the job lifecycle and nothing else. It never
 * touches vitals, alerts or the network, which is what lets it be ticked
 * thousands of times in a test without a fleet, a socket or a server.
 *
 * Four phases, and no others:
 *
 *   routing    → no job: choose one, find a route to it
 *   walking    → following the points of a walk leg
 *   traversing → inside a portal, counting down its travel time
 *   dwelling   → arrived, doing the work, counting down the job's dwell
 */
import type { SiteDef, Vec2 } from '@/sites/types';
import type { Grid } from '@/sim/navmesh';
import { nearestWalkable } from '@/sim/navmesh';
import { routeAcrossFloors, type Leg } from '@/sim/pathing';
import { pickJob, type Activity, type Job } from '@/sim/jobs';
import type { Role } from '@/sim/roles';

export type AgentState = {
  index: number;
  role: Role;
  floorId: string;
  position: Vec2;
  /** radians; 0 looks down +z, matching the scene's convention */
  facing: number;
  activity: Activity;
  job: Job | null;
  /** metres walked since the last tick — physiology reads this, not the label */
  movedThisTick: number;
};

export type Agent = {
  state: AgentState;
  tick(dtMs: number): void;
  /** Pre-empt whatever they are doing and send them to do this instead. */
  sendTo(job: Job): void;
};

export type AgentOptions = {
  index: number;
  role: Role;
  site: SiteDef;
  grids: Map<string, Grid>;
  start: { floorId: string; position: Vec2 };
  rand: () => number;
  /** metres per second; a comfortable indoor working pace */
  walkSpeed?: number;
};

const DEFAULT_WALK_SPEED = 1.3;

/**
 * How many consecutive unroutable jobs before the agent gives up for a moment.
 * A badly authored floor should produce a worker standing still, not a busy
 * loop burning a frame budget on A* that can never succeed.
 */
const MAX_ROUTE_FAILURES = 5;
const ROUTE_COOLDOWN_MS = 2_000;

/** Close enough to a waypoint to call it reached. */
const ARRIVE_EPSILON = 0.05;

type Phase = 'routing' | 'walking' | 'traversing' | 'dwelling';

export function createAgent(opts: AgentOptions): Agent {
  const { site, grids, rand } = opts;
  const walkSpeed = opts.walkSpeed ?? DEFAULT_WALK_SPEED;

  const startGrid = grids.get(opts.start.floorId);
  const startPosition =
    (startGrid && nearestWalkable(startGrid, opts.start.position)) ?? opts.start.position;

  const state: AgentState = {
    index: opts.index,
    role: opts.role,
    floorId: opts.start.floorId,
    position: { ...startPosition },
    facing: 0,
    activity: 'walking',
    job: null,
    movedThisTick: 0,
  };

  let phase: Phase = 'routing';
  let legs: Leg[] = [];
  let legIndex = 0;
  let pointIndex = 0;
  let dwellRemainingMs = 0;
  let portalRemainingMs = 0;
  let routeFailures = 0;

  /** Enter the leg at `legIndex`, or start dwelling if the route is finished. */
  const enterLeg = () => {
    if (legIndex >= legs.length) {
      phase = 'dwelling';
      dwellRemainingMs = state.job?.dwellMs ?? 1_000;
      state.activity = state.job?.activity ?? 'resting';
      return;
    }
    const leg = legs[legIndex];
    if (leg.kind === 'walk') {
      phase = 'walking';
      pointIndex = 0;
      state.activity = 'walking';
    } else {
      phase = 'traversing';
      portalRemainingMs = leg.portal.travelSeconds * 1_000;
      state.activity = 'climbing';
    }
  };

  /**
   * A job forced on the agent instead of one it chose.
   *
   * Null except in the frame after `sendTo` is called. It exists so that
   * acknowledging an alert means something in the world: the worker who takes
   * responsibility for a machine walks to that machine and works on it, which
   * is the difference between an alert that was answered and an alert that was
   * dismissed. Consumed by `beginRouting` rather than applied directly,
   * because routing is where an unreachable target is handled and there is no
   * reason for this to reimplement that.
   */
  let assigned: Job | null = null;

  const beginRouting = () => {
    const job = assigned ?? pickJob(site, state.role, state.floorId, rand, opts.index);
    assigned = null;
    const route = routeAcrossFloors(
      site,
      grids,
      { floorId: state.floorId, position: state.position },
      job.target,
    );

    if (route === null) {
      routeFailures += 1;
      if (routeFailures >= MAX_ROUTE_FAILURES) {
        // Stand still briefly rather than hammering A* with jobs that cannot
        // be reached. The next attempt may pick a different, reachable target.
        routeFailures = 0;
        state.job = null;
        state.activity = 'resting';
        phase = 'dwelling';
        dwellRemainingMs = ROUTE_COOLDOWN_MS;
      }
      return;
    }

    routeFailures = 0;
    state.job = job;
    legs = route;
    legIndex = 0;
    enterLeg();
  };

  const advanceAlongWalk = (dtMs: number) => {
    const leg = legs[legIndex];
    if (leg.kind !== 'walk') return;

    let remaining = (walkSpeed * dtMs) / 1_000;
    while (remaining > 0 && pointIndex < leg.points.length) {
      const target = leg.points[pointIndex];
      const dx = target.x - state.position.x;
      const dz = target.z - state.position.z;
      const distance = Math.hypot(dx, dz);

      if (distance <= ARRIVE_EPSILON) {
        pointIndex += 1;
        continue;
      }

      // Only turn when there is somewhere to turn toward; a zero-length step
      // would otherwise snap facing to atan2(0,0).
      state.facing = Math.atan2(dx, dz);

      const step = Math.min(remaining, distance);
      state.position.x += (dx / distance) * step;
      state.position.z += (dz / distance) * step;
      state.movedThisTick += step;
      remaining -= step;

      if (step >= distance - ARRIVE_EPSILON) pointIndex += 1;
    }

    if (pointIndex >= leg.points.length) {
      legIndex += 1;
      enterLeg();
    }
  };

  const advanceThroughPortal = (dtMs: number) => {
    const leg = legs[legIndex];
    if (leg.kind !== 'portal') return;

    portalRemainingMs -= dtMs;
    if (portalRemainingMs > 0) return;

    const { portal } = leg;
    const arrivingOn =
      portal.fromFloor === state.floorId ? portal.toFloor : portal.fromFloor;
    const arrivingAt =
      portal.fromFloor === arrivingOn ? portal.fromPosition : portal.toPosition;

    // Snap to a walkable cell on arrival. A portal's landing point is authored
    // data, and authored data can land inside a machine's footprint — pathing
    // recovers on the next route, but for one frame the worker would be
    // standing inside the geometry.
    const arrivalGrid = grids.get(arrivingOn);
    const landing =
      (arrivalGrid && nearestWalkable(arrivalGrid, arrivingAt)) ?? arrivingAt;

    state.floorId = arrivingOn;
    state.position = { ...landing };
    legIndex += 1;
    enterLeg();
  };

  return {
    /**
     * Send this worker to a specific place to do a specific thing.
     *
     * Pre-empts whatever they were doing: an acknowledged alert is more
     * important than the sweep they were halfway through, and a worker who
     * finished their round first before responding would be telling the wrong
     * story about what acknowledging means.
     */
    sendTo(job: Job) {
      assigned = job;
      state.job = job;
      legs = [];
      legIndex = 0;
      pointIndex = 0;
      dwellRemainingMs = 0;
      phase = 'routing';
      beginRouting();
    },

    state,
    tick(dtMs: number) {
      // Reset first, every tick, unconditionally: physiology reads this and a
      // stale value would make a resting worker look like they were still
      // walking — which is exactly the input error that makes a hard-working
      // worker also read as pathologically stressed.
      state.movedThisTick = 0;

      switch (phase) {
        case 'routing':
          beginRouting();
          break;
        case 'walking':
          advanceAlongWalk(dtMs);
          break;
        case 'traversing':
          advanceThroughPortal(dtMs);
          break;
        case 'dwelling':
          dwellRemainingMs -= dtMs;
          if (dwellRemainingMs <= 0) {
            state.job = null;
            phase = 'routing';
          }
          break;
      }
    },
  };
}
