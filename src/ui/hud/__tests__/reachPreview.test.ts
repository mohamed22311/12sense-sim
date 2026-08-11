import { describe, expect, it } from 'vitest';
import { previewReach } from '@/ui/hud/reachPreview';
import type { AgentState } from '@/sim/agent';

/**
 * The preview's one job is to not lie.
 *
 * It is shown before an irreversible write to a live server, and an operator
 * will believe it. If it ever disagrees with what the phones actually decide,
 * it is worse than showing nothing — so it runs the vendored gate rather than
 * its own arithmetic, and these pin the agreement.
 */

const FRAME = {
  anchor: { latitude: 30.04412, longitude: 31.23571 },
  origin: { x: 0, z: 0 },
};

const at = (floorId: string, x: number, z: number): AgentState =>
  ({ floorId, position: { x, z } }) as AgentState;

const EVENT = { floorId: '3', x: 0, z: 0, radiusM: 10 };

describe('previewReach', () => {
  it('counts who is inside the circle on the event floor', () => {
    const r = previewReach(
      EVENT,
      [at('3', 0, 0), at('3', 5, 0), at('3', 0, 9.5)],
      FRAME,
    );
    expect(r.inRange).toBe(3);
    expect(r.outOfRange).toBe(0);
  });

  it('separates "too far" from "wrong floor"', () => {
    // Two different stories that a single silent count would flatten. The
    // second is the surprising one and the reason the demo exists.
    const r = previewReach(
      EVENT,
      [at('3', 0, 0), at('3', 30, 0), at('4', 0, 0), at('5', 0, 0)],
      FRAME,
    );
    expect(r.inRange).toBe(1);
    expect(r.outOfRange).toBe(1);
    expect(r.otherFloor).toBe(2);
  });

  it('reports the nearest worker who would stay silent', () => {
    // A worker one floor up, standing three metres away in plan. The whole
    // argument in one number.
    const r = previewReach(EVENT, [at('3', 0, 0), at('4', 3, 0)], FRAME);
    expect(r.nearestSilentM).toBeCloseTo(3, 1);
  });

  it('is null for nearest-silent when everyone would be alerted', () => {
    const r = previewReach(EVENT, [at('3', 0, 0), at('3', 1, 1)], FRAME);
    expect(r.nearestSilentM).toBeNull();
  });

  it('moves the boundary with the radius', () => {
    // What the slider is for: the same people, a different answer.
    const people = [at('3', 0, 0), at('3', 8, 0), at('3', 20, 0)];
    expect(previewReach({ ...EVENT, radiusM: 5 }, people, FRAME).inRange).toBe(1);
    expect(previewReach({ ...EVENT, radiusM: 10 }, people, FRAME).inRange).toBe(2);
    expect(previewReach({ ...EVENT, radiusM: 25 }, people, FRAME).inRange).toBe(3);
  });

  it('is exact at the boundary, because the gate is inclusive', () => {
    // A worker standing exactly on the line is in range. Off by one metre here
    // is off by one person on screen, and the circle is drawn at this radius.
    const r = previewReach({ ...EVENT, radiusM: 10 }, [at('3', 10, 0)], FRAME);
    expect(r.inRange).toBe(1);
    expect(previewReach({ ...EVENT, radiusM: 10 }, [at('3', 10.5, 0)], FRAME).inRange).toBe(0);
  });

  it('counts an empty site as reaching nobody rather than throwing', () => {
    const r = previewReach(EVENT, [], FRAME);
    expect(r).toMatchObject({ inRange: 0, outOfRange: 0, otherFloor: 0, nearestSilentM: null });
  });

  it('carries the count of phones it cannot see', () => {
    // A real handset enrolled in the company is not in the simulation, so the
    // preview must say it does not know rather than silently under-count.
    expect(previewReach(EVENT, [at('3', 0, 0)], FRAME, 1).unknownPhones).toBe(1);
  });
});
