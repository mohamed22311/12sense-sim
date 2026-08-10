import { describe, expect, it } from 'vitest';
import { haversineMeters } from '@/phone/vendor/realtime/proximity';
import { latLonToScene, sceneToLatLon } from '@/runtime/geo';

const ANCHOR = { latitude: 30.04412, longitude: 31.23571 };

describe('geo', () => {
  it('returns the anchor itself at the scene origin', () => {
    const at = sceneToLatLon(ANCHOR, 0, 0);
    expect(at.latitude).toBeCloseTo(ANCHOR.latitude, 10);
    expect(at.longitude).toBeCloseTo(ANCHOR.longitude, 10);
  });

  it('round-trips scene metres through lat/lon', () => {
    const { x, z } = latLonToScene(ANCHOR, sceneToLatLon(ANCHOR, 42.5, -137.25));
    expect(x).toBeCloseTo(42.5, 6);
    expect(z).toBeCloseTo(-137.25, 6);
  });

  it('agrees with the vendored haversine on a known offset', () => {
    // 100 m north of the anchor, measured by the same function the gate uses
    const north = sceneToLatLon(ANCHOR, 0, 100);
    const measured = haversineMeters(
      ANCHOR.latitude, ANCHOR.longitude, north.latitude, north.longitude,
    );
    expect(measured).toBeCloseTo(100, 2);
  });

  it('agrees with the vendored haversine on an east offset', () => {
    const east = sceneToLatLon(ANCHOR, 75, 0);
    const measured = haversineMeters(
      ANCHOR.latitude, ANCHOR.longitude, east.latitude, east.longitude,
    );
    expect(measured).toBeCloseTo(75, 2);
  });

  it('constrains axis orientation: +z must increase latitude only', () => {
    const offset = sceneToLatLon(ANCHOR, 0, 50);
    expect(offset.latitude).toBeGreaterThan(ANCHOR.latitude);
    expect(offset.longitude).toBeCloseTo(ANCHOR.longitude, 10);
  });

  it('constrains axis orientation: +x must increase longitude only', () => {
    const offset = sceneToLatLon(ANCHOR, 50, 0);
    expect(offset.longitude).toBeGreaterThan(ANCHOR.longitude);
    expect(offset.latitude).toBeCloseTo(ANCHOR.latitude, 10);
  });
});
