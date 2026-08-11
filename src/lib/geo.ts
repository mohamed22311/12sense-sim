import { haversineMeters } from '@/phone/vendor/realtime/proximity';

/**
 * Coordinate maths for the map picker — pure, no React, no Leaflet, no DOM.
 *
 * Kept separate so it can be unit tested without a browser, and so the same
 * parsing runs wherever a coordinate arrives. The map is a convenience for
 * choosing numbers; these functions are what decides whether the numbers are
 * usable.
 *
 * `distanceM` deliberately delegates to the vendored `haversineMeters` rather
 * than reimplementing it. That function is the one the phones' proximity gate
 * uses; a second implementation here could agree today and drift tomorrow, and
 * a picker that measures a radius differently from the gate that enforces it
 * would be showing the operator a circle that is not the circle.
 */

export const LAT_RANGE = { min: -90, max: 90 } as const;
export const LON_RANGE = { min: -180, max: 180 } as const;

export const MIN_RADIUS_M = 1;

/**
 * Past this the "zone" is a region and the gate stops meaning anything — every
 * phone in a company is inside 50 km of every other one.
 */
export const MAX_RADIUS_M = 50_000;

/** Where the site sits until somebody says otherwise. */
export const DEFAULT_CENTER = { lat: 30.04412, lon: 31.23571 } as const;

export type Zone = { lat: number; lon: number; radiusM: number };

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Latitude clamps: there is nothing past a pole. */
export function normalizeLat(lat: number): number {
  return Number.isFinite(lat) ? clamp(lat, LAT_RANGE.min, LAT_RANGE.max) : DEFAULT_CENTER.lat;
}

/**
 * Longitude **wraps**, it does not clamp.
 *
 * Dragging a map east past the antimeridian yields longitudes beyond 180 — the
 * same physical place, but a number the server rejects. Wrapping is what stops
 * a harmless pan from breaking a submission.
 */
export function normalizeLon(lon: number): number {
  if (!Number.isFinite(lon)) return DEFAULT_CENTER.lon;
  /*
    Anything already in range is returned untouched, and that short-circuit is
    not an optimisation. The modulo below is lossy in binary floating point —
    it turns 31.23571 into 31.23571000000004 — and a coordinate that drifted on
    every normalise would never survive a round trip through the form unchanged.
  */
  if (lon >= LON_RANGE.min && lon <= LON_RANGE.max) return lon;
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  // -180 and 180 name the same meridian; prefer the positive form so a value
  // arriving as exactly 180 does not flip sign on every round trip.
  return wrapped === -180 ? 180 : wrapped;
}

export function normalizeRadius(radiusM: number, fallback: number): number {
  if (!Number.isFinite(radiusM)) return fallback;
  return clamp(Math.round(radiusM), MIN_RADIUS_M, MAX_RADIUS_M);
}

export function normalizeZone(zone: Zone, fallbackRadiusM: number): Zone {
  return {
    lat: normalizeLat(zone.lat),
    lon: normalizeLon(zone.lon),
    radiusM: normalizeRadius(zone.radiusM, fallbackRadiusM),
  };
}

/**
 * Reads a zone off three strings, or refuses.
 *
 * Returns null rather than substituting a default when any part is missing,
 * empty, non-finite, out of range, or a non-positive radius. Placing a site at
 * the wrong coordinates because a field failed to parse is far worse than
 * asking the operator to fix it — every distance in the demo, and every real
 * phone's verdict, hangs off this number.
 *
 * An out-of-range *longitude* is still wrapped rather than rejected: panning is
 * not an error.
 */
export function parseZone(input: {
  lat: string;
  lon: string;
  radiusM: string;
}): Zone | null {
  const lat = Number(input.lat.trim());
  const lon = Number(input.lon.trim());
  const radiusM = Number(input.radiusM.trim());

  if (input.lat.trim() === '' || input.lon.trim() === '' || input.radiusM.trim() === '') {
    return null;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(radiusM)) return null;
  if (lat < LAT_RANGE.min || lat > LAT_RANGE.max) return null;
  if (radiusM <= 0) return null;

  return { lat, lon: normalizeLon(lon), radiusM: Math.round(radiusM) };
}

/** Six decimals is about 11 cm — finer than any GPS this will ever meet. */
export function formatCoord(value: number): string {
  return value.toFixed(6);
}

export function formatRadius(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`;
  const km = metres / 1000;
  return `${Number.isInteger(km) ? km : Number(km.toFixed(2))} km`;
}

export function formatLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(6)}° ${ns}, ${Math.abs(lon).toFixed(6)}° ${ew}`;
}

/** Great-circle metres between two coordinates — the gate's own function. */
export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return haversineMeters(a.lat, a.lon, b.lat, b.lon);
}

/**
 * A zoom level whose viewport holds about four radii across.
 *
 * Web Mercator: one tile spans 360°/2^z of longitude, so ground resolution at
 * the equator is 156543.03392 / 2^z metres per pixel, shrinking by cos(lat).
 * Solving for the zoom that frames the zone is what stops a 1 km circle
 * opening at street level, entirely off screen.
 */
export function zoomForRadius(radiusM: number, lat: number, viewportPx = 560): number {
  const metresAcross = Math.max(1, normalizeRadius(radiusM, 75) * 4);
  const metresPerPixel = metresAcross / viewportPx;
  const equatorial = metresPerPixel / Math.cos((normalizeLat(lat) * Math.PI) / 180);
  return clamp(Math.round(Math.log2(156_543.03392 / equatorial) * 10) / 10, 1, 19);
}

/**
 * A point on the circle's eastern edge, where the radius handle lives.
 *
 * Near the poles a metre is an enormous number of degrees of longitude, so the
 * handle would fly off the map; it falls back to due north there instead.
 */
export function edgeOf(zone: Zone): { lat: number; lon: number } {
  const metresPerDegreeLon = 111_320 * Math.cos((zone.lat * Math.PI) / 180);
  if (Math.abs(metresPerDegreeLon) < 1) {
    return { lat: normalizeLat(zone.lat + zone.radiusM / 110_540), lon: zone.lon };
  }
  return { lat: zone.lat, lon: normalizeLon(zone.lon + zone.radiusM / metresPerDegreeLon) };
}
