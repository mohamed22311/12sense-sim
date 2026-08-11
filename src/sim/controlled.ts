import type { Agent, AgentState } from '@/sim/agent';
import type { Grid } from '@/sim/navmesh';
import { cellOf, isWalkable, nearestWalkable } from '@/sim/navmesh';
import { findPath } from '@/sim/pathing';
import type { SiteDef, Vec2 } from '@/sites/types';

/**
 * A worker somebody is driving.
 *
 * The other fifty-nine choose jobs and walk to them; this one goes where it is
 * pushed. Everything downstream stays identical — it exposes the same
 * `AgentState`, so the renderer draws it like any other worker, physiology
 * reads its `movedThisTick` like any other worker, and its phone runs the same
 * vendored gate against the same context. The only difference is where the
 * heading comes from.
 *
 * That sameness is the point. If a driven worker took a different path through
 * the code than a simulated one, then nothing you learn by driving him would
 * tell you anything about the other sixty.
 */

/** Metres per second. A brisk walk, not a sprint — this is a factory floor. */
export const CONTROL_SPEED = 2.1;

/** How fast the body turns to face the direction of travel, radians/second. */
const TURN_RATE = 9;

/** Close enough to a waypoint to move on to the next one, metres. */
const ARRIVAL_M = 0.3;

/**
 * The longest distance a single collision test may cover, metres. Half the
 * navmesh's 0.5 m cell, so a step can never skip over an occupied one.
 */
const MAX_SUBSTEP_M = 0.2;

export type ControlInput = {
  /** −1…1 along x; positive is east */
  x: number;
  /** −1…1 along z; positive is south, matching the scene's convention */
  z: number;
};

export type ControlledAgent = Agent & {
  setInput(input: ControlInput): void;
  /** Put him on another floor, at the same spot on it. */
  moveToFloor(floorId: string): void;
  /**
   * Walk to a point on the current floor, routing around what is in the way.
   *
   * Keyboard input takes over the moment it arrives — a character that keeps
   * walking to where you clicked while you are pressing a key is fighting you.
   */
  walkTo(target: Vec2): boolean;
  /** Where he is heading, for the scene to draw a marker on. */
  destination(): Vec2 | null;
};

export type ControlledOptions = {
  index: number;
  site: SiteDef;
  grids: Map<string, Grid>;
  start: { floorId: string; position: Vec2 };
};

/** Shortest signed turn from `from` to `to`, in radians. */
function angleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function createControlledAgent(opts: ControlledOptions): ControlledAgent {
  const { index, site, grids } = opts;
  const input: ControlInput = { x: 0, z: 0 };
  /** Remaining waypoints of a click-to-move route, nearest first. */
  let route: Vec2[] = [];

  const state: AgentState = {
    index,
    role: 'operator',
    floorId: opts.start.floorId,
    position: { ...opts.start.position },
    facing: 0,
    activity: 'resting',
    job: null,
    movedThisTick: 0,
  };

  /** Can he stand here? Asked per axis, so sliding along a wall works. */
  function walkable(floorId: string, at: Vec2): boolean {
    const grid = grids.get(floorId);
    if (!grid) return false;
    const cell = cellOf(grid, at);
    return isWalkable(grid, cell.col, cell.row);
  }

  return {
    state,

    walkTo(target) {
      const grid = grids.get(state.floorId);
      if (!grid) return false;
      // Clicking a machine or a wall should walk him as close as he can get,
      // not refuse — the click clearly meant "go over there".
      const goal = nearestWalkable(grid, target);
      if (!goal) return false;
      const path = findPath(grid, state.position, goal);
      if (!path || path.length === 0) return false;
      route = path;
      return true;
    },

    destination() {
      return route.length > 0 ? { ...route[route.length - 1] } : null;
    },

    setInput(next) {
      // Any steering cancels the route. Two things driving one body is how a
      // character ends up walking backwards into a wall.
      if (Math.abs(next.x) > 0.01 || Math.abs(next.z) > 0.01) route = [];
      // Clamped rather than trusted: the input arrives from a keyboard handler
      // and a diagonal of two full-magnitude axes would otherwise walk 41%
      // faster than a straight line.
      const magnitude = Math.hypot(next.x, next.z);
      if (magnitude > 1) {
        input.x = next.x / magnitude;
        input.z = next.z / magnitude;
      } else {
        input.x = next.x;
        input.z = next.z;
      }
    },

    /**
     * Ignored for a driven worker.
     *
     * `sendTo` pre-empts an agent's chosen job, and a driven worker has none —
     * the operator is the one deciding where they go. Silently doing nothing
     * is right here: acknowledging an alert on the worker you are steering
     * should not wrench control away from you mid-step.
     */
    sendTo() {},

    moveToFloor(floorId) {
      if (!site.floors.some((f) => f.id === floorId)) return;
      state.floorId = floorId;
      // The same spot on another floor may be inside a machine there, so he
      // arrives wherever is walkable rather than inside one.
      if (!walkable(floorId, state.position)) {
        const grid = grids.get(floorId);
        if (grid) {
          const centre = { x: 0, z: -6 };
          state.position = walkable(floorId, centre) ? centre : { ...state.position };
        }
      }
    },

    tick(dtMs) {
      const seconds = dtMs / 1000;

      // A route supplies the heading when the keyboard is not.
      if (route.length > 0 && Math.hypot(input.x, input.z) < 0.01) {
        /*
          Consume every waypoint already reached, then head for the first that
          is not. Shifting one and falling through spent a whole tick standing
          still — visible as a movement trace of 0, step, 0, step, which halves
          his speed and reads as a limp.
        */
        while (route.length > 0) {
          const next = route[0];
          const remaining = Math.hypot(
            next.x - state.position.x,
            next.z - state.position.z,
          );
          if (remaining >= ARRIVAL_M) {
            input.x = (next.x - state.position.x) / remaining;
            input.z = (next.z - state.position.z) / remaining;
            break;
          }
          route.shift();
        }
        if (route.length === 0) {
          state.movedThisTick = 0;
          state.activity = 'resting';
          return;
        }
      }

      const magnitude = Math.hypot(input.x, input.z);

      if (magnitude < 0.01) {
        state.movedThisTick = 0;
        state.activity = 'resting';
        return;
      }

      const step = CONTROL_SPEED * seconds;
      const before = { ...state.position };

      /*
        Sub-stepped, because collision is tested at the destination cell only.
        A frame long enough to carry him further than one cell — a backgrounded
        tab resuming, or any slow machine, where the tick cap allows a 0.525 m
        step against a 0.5 m grid — would let him pass clean through a machine
        without ever landing in it. Splitting the step so none exceeds half a
        cell means every cell he crosses is actually tested.
      */
      const substeps = Math.max(1, Math.ceil(step / MAX_SUBSTEP_M));
      const substep = step / substeps;

      for (let i = 0; i < substeps; i++) {
        // Axis at a time, so hitting a machine at an angle slides along it
        // rather than stopping dead — a driven character that sticks on
        // corners is the most obvious sign of a body bolted onto a pathfinder.
        const tryX = { x: state.position.x + input.x * substep, z: state.position.z };
        if (walkable(state.floorId, tryX)) state.position.x = tryX.x;

        const tryZ = { x: state.position.x, z: state.position.z + input.z * substep };
        if (walkable(state.floorId, tryZ)) state.position.z = tryZ.z;
      }

      state.movedThisTick = Math.hypot(
        state.position.x - before.x,
        state.position.z - before.z,
      );
      state.activity = state.movedThisTick > 0 ? 'walking' : 'resting';

      // Face where the input points, not where he actually got to: pushing
      // into a wall should turn him to face it, not leave him facing away.
      const target = Math.atan2(input.x, input.z);
      state.facing += angleDelta(state.facing, target) * Math.min(1, TURN_RATE * seconds);

      // A routed step's heading was computed for this tick only; leaving it in
      // `input` would keep him walking after the route ended.
      if (route.length > 0) {
        input.x = 0;
        input.z = 0;
      }
    },
  };
}
