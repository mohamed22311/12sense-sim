import { describe, expect, it } from 'vitest';
import { frameToLatLon, latLonToScene, type SceneFrame } from '@/runtime/geo';

/**
 * The property that makes a movable anchor safe.
 *
 * Moving the origin relocates the whole site on the earth. It must not change
 * a single distance *within* the site — because those distances are what every
 * phone's proximity gate is deciding on, and a demo whose verdicts shifted
 * when the operator dragged a pin would be worse than useless.
 */

const ANCHOR = { latitude: 30.04412, longitude: 31.23571 };

const frameAt = (x: number, z: number): SceneFrame => ({
  anchor: ANCHOR,
  origin: { x, z },
});

/** Great-circle-ish distance in metres, good enough at this scale. */
function metresBetween(a: ReturnType<typeof frameToLatLon>, b: typeof a): number {
  const scene = latLonToScene(a, b);
  return Math.hypot(scene.x, scene.z);
}

describe('the scene frame', () => {
  it('puts the origin exactly at the anchor coordinate', () => {
    const frame = frameAt(7, -3);
    const at = frameToLatLon(frame, 7, -3);
    expect(at.latitude).toBeCloseTo(ANCHOR.latitude, 9);
    expect(at.longitude).toBeCloseTo(ANCHOR.longitude, 9);
  });

  it('preserves every distance when the origin moves', () => {
    const a = { x: -4.5, z: -10 };
    const b = { x: 6, z: 2 };
    const expected = Math.hypot(a.x - b.x, a.z - b.z);

    for (const origin of [
      { x: 0, z: 0 },
      { x: 3, z: -7 },
      { x: -8, z: 14 },
    ]) {
      const frame = frameAt(origin.x, origin.z);
      const measured = metresBetween(
        frameToLatLon(frame, a.x, a.z),
        frameToLatLon(frame, b.x, b.z),
      );
      // Within a centimetre over ~16 m: the flat-earth approximation's own
      // error at this scale, not a frame error.
      expect(measured).toBeCloseTo(expected, 2);
    }
  });

  it('moves the whole site when the origin moves', () => {
    // The complement of the property above: relative geometry is preserved,
    // absolute position is not — that is the entire point of moving the pin.
    const stationary = { x: 0, z: 0 };
    const before = frameToLatLon(frameAt(0, 0), stationary.x, stationary.z);
    const after = frameToLatLon(frameAt(20, 0), stationary.x, stationary.z);
    expect(metresBetween(before, after)).toBeCloseTo(20, 1);
  });

  it('round-trips a position back to where it started', () => {
    const frame = frameAt(2, -5);
    const at = frameToLatLon(frame, 11, -13);
    const back = latLonToScene(frame.anchor, at);
    expect(back.x + frame.origin.x).toBeCloseTo(11, 2);
    expect(back.z + frame.origin.z).toBeCloseTo(-13, 2);
  });
});
