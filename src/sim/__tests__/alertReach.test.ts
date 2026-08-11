import { describe, expect, it } from 'vitest';
import { FACTORY } from '@/sites/factory';
import { DEFAULT_ALERT_RADIUS_M } from '@/net/alerts';
import { frameToLatLon } from '@/runtime/geo';
import { decideProximity } from '@/phone/vendor/realtime/proximity';

/**
 * Who an alert reaches, run over the real site at real scale.
 *
 * This exists because of a reported demo failure: an alert raised from a
 * machine on floor 3 appeared to alarm only some of floor 3, and some people
 * on other floors. Two causes, both real, neither in the vendored gate:
 *
 *  1. **Workers changed floors.** `floorId` only updates on portal *arrival*,
 *     so someone on a staircase reported the floor they left while being drawn
 *     between two. Add that the roster is inspected seconds after the alert,
 *     by which time people have walked, and the floor column simply did not
 *     describe the moment the gate ran. Fixed by pinning workers to a floor.
 *
 *  2. **The radius could not discriminate.** A floor is 16 m x 16 m, so the
 *     farthest two points on one are ~22.6 m apart — and the dialog opened on
 *     a 75 m radius. Every worker on every floor was inside it, always, so the
 *     distance axis never suppressed anyone and the only thing separating
 *     floors was the floor string. A demo about proximity in which proximity
 *     is never the reason is not demonstrating anything.
 *
 * These tests pin both: the geometry the radius is chosen against, and the
 * verdicts that geometry produces.
 */

const FRAME = {
  anchor: { latitude: 30.04412, longitude: 31.23571 },
  origin: { x: 0, z: 0 },
};

/** The gate as a phone standing at a scene point on a floor would run it. */
function verdictAt(
  worker: { x: number; z: number; floor: string },
  event: { x: number; z: number; floor: string; radiusM: number },
) {
  const workerFix = frameToLatLon(FRAME, worker.x, worker.z);
  const eventFix = frameToLatLon(FRAME, event.x, event.z);
  const nowMs = 1_700_000_000_000;

  return decideProximity({
    event: {
      floor: event.floor,
      latitude: eventFix.latitude,
      longitude: eventFix.longitude,
      alertRadiusM: event.radiusM,
    },
    workerFloor: worker.floor,
    gps: { ...workerFix, timestamp: nowMs - 3_000 },
    nowMs,
  });
}

const BOUNDS = FACTORY.floors[0].bounds;

/** The two most distant points on one floor — the widest gap a radius must span. */
const FLOOR_DIAGONAL_M = Math.hypot(
  BOUNDS.maxX - BOUNDS.minX,
  BOUNDS.maxZ - BOUNDS.minZ,
);

describe('the scale a radius has to work at', () => {
  it('spans a floor in about 23 m, not hundreds', () => {
    // The number every radius decision is measured against. If a site is ever
    // re-authored much larger, this failing is the reminder to re-pick the
    // default rather than discovering it mid-demo.
    expect(FLOOR_DIAGONAL_M).toBeGreaterThan(20);
    expect(FLOOR_DIAGONAL_M).toBeLessThan(25);
  });

  it('opens on a radius that leaves someone out', () => {
    // The actual regression. A default wider than the floor makes the distance
    // axis unreachable: everyone passes, always, and the radius control is
    // decoration.
    expect(DEFAULT_ALERT_RADIUS_M).toBeLessThan(FLOOR_DIAGONAL_M);
  });

  it('opens on a radius that still reaches the people around the machine', () => {
    // The opposite failure: a radius so tight that raising an alert notifies
    // nobody reads as a broken demo rather than a strict one.
    expect(DEFAULT_ALERT_RADIUS_M).toBeGreaterThan(6);
  });
});

describe('the gate over real site geometry', () => {
  const machine = FACTORY.floors[2].machines[0];
  const event = {
    x: machine.position.x,
    z: machine.position.z,
    floor: '3',
    radiusM: DEFAULT_ALERT_RADIUS_M,
  };

  it('alarms a worker standing at the machine', () => {
    const v = verdictAt({ ...machine.position, floor: '3' }, event);
    expect(v.shouldPop).toBe(true);
    expect(v.distanceM).toBeLessThan(1);
  });

  it('does not alarm the same worker one floor up, however close', () => {
    // The demo's whole argument, and the thing GPS alone cannot do: identical
    // coordinates, different floor. Distance is ~0 and it still must not pop.
    const v = verdictAt({ ...machine.position, floor: '4' }, event);
    expect(v.shouldPop).toBe(false);
    expect(v.floorGate).toBe('mismatch');
    expect(v.distanceM).toBeLessThan(1);
  });

  it('does not alarm anyone on any other floor, anywhere on it', () => {
    for (const floor of FACTORY.floors) {
      if (floor.id === '3') continue;
      for (const spot of [
        { x: BOUNDS.minX, z: BOUNDS.minZ },
        { x: BOUNDS.maxX, z: BOUNDS.maxZ },
        { x: machine.position.x, z: machine.position.z },
      ]) {
        expect(verdictAt({ ...spot, floor: floor.id }, event).shouldPop).toBe(false);
      }
    }
  });

  it('alarms everyone on floor 3 who is inside the radius, and nobody outside it', () => {
    // Swept over the whole floor at 1 m: the verdict must agree with the plain
    // distance comparison at every point, with no gaps and no strays. This is
    // what "some of floor 3 got it and some did not" should look like once it
    // is correct — a circle, not a scatter.
    let inside = 0;
    let outside = 0;

    for (let x = BOUNDS.minX; x <= BOUNDS.maxX; x += 1) {
      for (let z = BOUNDS.minZ; z <= BOUNDS.maxZ; z += 1) {
        const planar = Math.hypot(x - event.x, z - event.z);
        const v = verdictAt({ x, z, floor: '3' }, event);
        expect(v.shouldPop).toBe(planar <= event.radiusM);
        // The haversine over the tangent-plane mapping must agree with plain
        // scene metres — if these ever drift, every verdict drifts with them.
        expect(v.distanceM).toBeCloseTo(planar, 1);
        if (v.shouldPop) inside++;
        else outside++;
      }
    }

    // Both sides non-empty is the point: at this radius the floor genuinely
    // splits, which is what makes the demo worth watching.
    expect(inside).toBeGreaterThan(0);
    expect(outside).toBeGreaterThan(0);
  });
});
