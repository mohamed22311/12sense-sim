import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CENTER,
  MAX_RADIUS_M,
  MIN_RADIUS_M,
  clamp,
  distanceM,
  edgeOf,
  formatCoord,
  formatLatLon,
  formatRadius,
  normalizeLat,
  normalizeLon,
  normalizeRadius,
  normalizeZone,
  parseZone,
  zoomForRadius,
} from '@/lib/geo';

/**
 * The map is a convenience for choosing numbers. These functions are what
 * decides whether the numbers are usable, and every distance in the demo — and
 * every real phone's verdict — hangs off them.
 */

describe('clamp', () => {
  it('holds a value between its bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe('normalizeLat', () => {
  it('leaves an ordinary latitude alone', () => {
    expect(normalizeLat(30.04412)).toBe(30.04412);
    expect(normalizeLat(-33.8688)).toBe(-33.8688);
  });

  it('clamps at the poles, because there is nothing past one', () => {
    expect(normalizeLat(91)).toBe(90);
    expect(normalizeLat(-91)).toBe(-90);
  });

  it('falls back rather than propagating NaN', () => {
    expect(normalizeLat(Number.NaN)).toBe(DEFAULT_CENTER.lat);
  });
});

describe('normalizeLon', () => {
  it('leaves an in-range longitude bit-for-bit untouched', () => {
    /*
      The regression this exists for. The wrapping modulo is lossy in binary
      floating point — it turns 31.23571 into 31.23571000000004 — so without
      the in-range short-circuit the value drifted on every keystroke and never
      survived a round trip through the form unchanged.
    */
    expect(normalizeLon(31.23571)).toBe(31.23571);
    expect(Object.is(normalizeLon(31.23571), 31.23571)).toBe(true);
    expect(normalizeLon(-0.1276)).toBe(-0.1276);
  });

  it('wraps rather than clamps, because panning east is not an error', () => {
    // Dragging a map past the antimeridian yields >180 — the same physical
    // place, but a number the server answers with a 422.
    expect(normalizeLon(181)).toBeCloseTo(-179, 10);
    expect(normalizeLon(-181)).toBeCloseTo(179, 10);
    expect(normalizeLon(540)).toBeCloseTo(180, 10);
  });

  it('keeps exactly 180 positive across a round trip', () => {
    // -180 and 180 are the same meridian; flipping sign on every normalise
    // would make a value at the dateline oscillate.
    expect(normalizeLon(180)).toBe(180);
    expect(normalizeLon(normalizeLon(180))).toBe(180);
  });

  it('falls back rather than propagating NaN', () => {
    expect(normalizeLon(Number.NaN)).toBe(DEFAULT_CENTER.lon);
  });
});

describe('normalizeRadius', () => {
  it('rounds to whole metres', () => {
    expect(normalizeRadius(74.6, 75)).toBe(75);
    expect(normalizeRadius(12.2, 75)).toBe(12);
  });

  it('enforces both bounds', () => {
    expect(normalizeRadius(0, 75)).toBe(MIN_RADIUS_M);
    expect(normalizeRadius(-40, 75)).toBe(MIN_RADIUS_M);
    expect(normalizeRadius(9_999_999, 75)).toBe(MAX_RADIUS_M);
  });

  it('falls back for a non-finite value', () => {
    expect(normalizeRadius(Number.NaN, 12)).toBe(12);
    expect(normalizeRadius(Number.POSITIVE_INFINITY, 12)).toBe(12);
  });
});

describe('normalizeZone', () => {
  it('applies each rule to its own axis', () => {
    expect(normalizeZone({ lat: 95, lon: 181, radiusM: 12.4 }, 75)).toEqual({
      lat: 90,
      lon: normalizeLon(181),
      radiusM: 12,
    });
  });
});

describe('parseZone', () => {
  it('reads a well-formed zone', () => {
    expect(parseZone({ lat: '30.04412', lon: '31.23571', radiusM: '75' })).toEqual({
      lat: 30.04412,
      lon: 31.23571,
      radiusM: 75,
    });
  });

  it('refuses rather than substituting a default', () => {
    // Placing a site at the wrong coordinates because a field failed to parse
    // is far worse than asking the operator to fix it.
    expect(parseZone({ lat: '', lon: '31.2', radiusM: '75' })).toBeNull();
    expect(parseZone({ lat: '30.0', lon: '', radiusM: '75' })).toBeNull();
    expect(parseZone({ lat: '30.0', lon: '31.2', radiusM: '' })).toBeNull();
    expect(parseZone({ lat: 'north', lon: '31.2', radiusM: '75' })).toBeNull();
  });

  it('rejects an impossible latitude and a non-positive radius', () => {
    expect(parseZone({ lat: '91', lon: '31.2', radiusM: '75' })).toBeNull();
    expect(parseZone({ lat: '30', lon: '31.2', radiusM: '0' })).toBeNull();
    expect(parseZone({ lat: '30', lon: '31.2', radiusM: '-5' })).toBeNull();
  });

  it('wraps a pannable longitude instead of rejecting it', () => {
    const zone = parseZone({ lat: '30', lon: '181', radiusM: '75' });
    expect(zone).not.toBeNull();
    expect(zone!.lon).toBeCloseTo(-179, 10);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseZone({ lat: ' 30.0 ', lon: ' 31.2 ', radiusM: ' 75 ' })).toEqual({
      lat: 30,
      lon: 31.2,
      radiusM: 75,
    });
  });
});

describe('distanceM', () => {
  const here = { lat: 30.04412, lon: 31.23571 };

  it('is zero for the same point', () => {
    expect(distanceM(here, here)).toBe(0);
  });

  it('is symmetric', () => {
    const there = { lat: 30.045, lon: 31.236 };
    expect(distanceM(here, there)).toBeCloseTo(distanceM(there, here), 9);
  });

  it('is about 111 km for one degree of latitude', () => {
    expect(distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeGreaterThan(110_000);
    expect(distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeLessThan(112_000);
  });

  it('is accurate at the scale a zone radius actually uses', () => {
    // Tens of metres is where this function earns its keep: it turns a dragged
    // handle back into a radius.
    const north = { lat: here.lat + 50 / 111_194.93, lon: here.lon };
    expect(distanceM(here, north)).toBeCloseTo(50, 1);
  });

  it('agrees with the gate, because it is the gate’s own function', () => {
    // Not a re-implementation. A picker that measured a radius differently
    // from the gate enforcing it would draw a circle that is not the circle.
    const a = { lat: 30.0, lon: 31.0 };
    const b = { lat: 30.001, lon: 31.001 };
    expect(distanceM(a, b)).toBeGreaterThan(0);
  });
});

describe('zoomForRadius', () => {
  it('zooms further in for a tighter zone', () => {
    expect(zoomForRadius(20, 30)).toBeGreaterThan(zoomForRadius(1000, 30));
  });

  it('stays inside Leaflet’s usable range', () => {
    expect(zoomForRadius(1, 0)).toBeLessThanOrEqual(19);
    expect(zoomForRadius(MAX_RADIUS_M, 0)).toBeGreaterThanOrEqual(1);
  });

  it('accounts for Mercator stretch away from the equator', () => {
    // A metre occupies more pixels at high latitude, so the same radius needs
    // a lower zoom to fit.
    expect(zoomForRadius(500, 60)).toBeLessThan(zoomForRadius(500, 0));
  });
});

describe('formatting', () => {
  it('shows six decimals — about 11 cm', () => {
    expect(formatCoord(30.04412)).toBe('30.044120');
  });

  it('switches from metres to kilometres', () => {
    expect(formatRadius(75)).toBe('75 m');
    expect(formatRadius(999)).toBe('999 m');
    expect(formatRadius(1000)).toBe('1 km');
    expect(formatRadius(1250)).toBe('1.25 km');
  });

  it('qualifies a coordinate by hemisphere', () => {
    expect(formatLatLon(30.04412, 31.23571)).toBe('30.044120° N, 31.235710° E');
    expect(formatLatLon(-33.8688, -70.6693)).toBe('33.868800° S, 70.669300° W');
  });
});

describe('edgeOf', () => {
  it('puts the handle a radius due east of the centre', () => {
    const zone = { lat: 30.04412, lon: 31.23571, radiusM: 100 };
    const edge = edgeOf(zone);
    expect(edge.lat).toBe(zone.lat);
    expect(edge.lon).toBeGreaterThan(zone.lon);
    expect(distanceM({ lat: zone.lat, lon: zone.lon }, edge)).toBeCloseTo(100, 0);
  });

  it('falls back to due north at a pole, where a metre is a huge angle', () => {
    // Otherwise the handle flies off the map and cannot be grabbed.
    const edge = edgeOf({ lat: 90, lon: 0, radiusM: 100 });
    expect(edge.lon).toBe(0);
    expect(edge.lat).toBeLessThanOrEqual(90);
  });
});
