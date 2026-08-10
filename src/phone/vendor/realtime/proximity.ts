/* VENDORED — DO NOT EDIT.
 * Source: TwelveSense-TT-MobileApp/Thalamus/src/realtime/proximity.ts @ 15b11d4
 * Sync check: `npm run check:vendor`. Fix drift by re-copying, never by editing.
 */
/**
 * Group-alert proximity gate — pure decision module (S2-MB4).
 *
 * The server broadcasts every event to every phone; THIS module is where the
 * phone decides (Constitution I). Pop iff the floor axis passes AND the
 * GPS/radius axis passes (design doc §5):
 *
 *   floor axis  — worker floor vs event floor, trimmed case-insensitive.
 *                 event floor null ⇒ single-level site, gate skipped (passes).
 *                 worker floor unknown ⇒ safe-fallback match (passes, recorded).
 *   gps axis    — haversine(phone, event) ≤ alert_radius_m (inclusive).
 *                 no usable fix, or fix older than gpsStaleAfterMs ⇒
 *                 safe-fallback in-range (passes, recorded).
 *
 * The safety bias runs per axis (Constitution V — never miss a real alert):
 * an unknown axis passes, but a *measured* failure on the other axis still
 * suppresses. Both axes unknown ⇒ pop. Every fallback is recorded so the
 * response context_snapshot shows when one fired.
 *
 * `zone_id` is deliberately not an input — it is carried on the event for
 * future zone-level gating, not gated in the MVP.
 *
 * No I/O, no React — callers gather {event, workerFloor, gps, nowMs} and read
 * the verdict (Constitution III). The I/O shell is groupAlertGate.ts.
 */

import type { ContextSnapshot, FloorGate, GpsGate, ProximityFallback } from '@/api/types';

export const PROXIMITY_CONFIG = Object.freeze({
  /**
   * A fix older than this cannot support an out-of-range verdict — a walking
   * worker covers ~100–160 m in 2 min, the same order as a typical
   * alert_radius_m — so it falls back to in-range (show the alert).
   */
  gpsStaleAfterMs: 120_000,
  /**
   * How long the I/O shell waits for a fresh fix before deciding with what it
   * has. Deliberately generous (demo priority: a measured verdict beats pop
   * latency), but bounded so a GPS-dead phone still alerts via the fallback.
   */
  gpsAcquireTimeoutMs: 20_000,
});

export type ProximityConfig = typeof PROXIMITY_CONFIG;

/** a phone position as gathered by the I/O shell (timestamp = epoch ms of the fix) */
export type GpsFix = { latitude: number; longitude: number; timestamp: number };

export type ProximityInput = {
  event: {
    floor: string | null;
    latitude: number;
    longitude: number;
    alertRadiusM: number;
  };
  /** from FloorProvider; null = unknown / not set */
  workerFloor: string | null;
  /** null = permission denied / no fix within the acquire timeout */
  gps: GpsFix | null;
  nowMs: number;
};

export type ProximityVerdict = {
  shouldPop: boolean;
  /** haversine meters when a fresh fix existed; null on any GPS fallback */
  distanceM: number | null;
  /** age of the fix in whole seconds (recorded even when stale); null when no fix */
  gpsAgeS: number | null;
  floorGate: FloorGate;
  gpsGate: GpsGate;
  fallbacksFired: ProximityFallback[];
};

const EARTH_RADIUS_M = 6_371_008.8; // mean earth radius

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** great-circle distance between two lat/lon points, in meters (haversine) */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/** trimmed, lowercased floor id; whitespace-only collapses to null (= unknown) */
const normalizeFloor = (floor: string | null): string | null => {
  if (floor == null) return null;
  const f = floor.trim().toLowerCase();
  return f === '' ? null : f;
};

/**
 * Whether the event's routing geo is usable for a distance decision. Guards the
 * gate against malformed upstream / dev-injected events (null, NaN, out-of-range
 * coords, or a non-positive radius) that would otherwise yield a NaN or falsely
 * out-of-range comparison and silently suppress a real alert (S2 bug-finder).
 * Invalid geo means "can't measure" — the caller safe-fallbacks to delivery.
 */
const isValidEventGeo = (event: ProximityInput['event']): boolean =>
  Number.isFinite(event.latitude) &&
  event.latitude >= -90 &&
  event.latitude <= 90 &&
  Number.isFinite(event.longitude) &&
  event.longitude >= -180 &&
  event.longitude <= 180 &&
  Number.isFinite(event.alertRadiusM) &&
  event.alertRadiusM > 0;

export function decideProximity(
  input: ProximityInput,
  config: ProximityConfig = PROXIMITY_CONFIG,
): ProximityVerdict {
  const fallbacksFired: ProximityFallback[] = [];

  // --- floor axis ---
  // Null event floor wins over an unknown worker floor: the gate never ran,
  // so no fallback fired.
  const eventFloor = normalizeFloor(input.event.floor);
  const workerFloor = normalizeFloor(input.workerFloor);
  let floorGate: FloorGate;
  if (eventFloor === null) {
    floorGate = 'skipped_null_event_floor';
  } else if (workerFloor === null) {
    floorGate = 'fallback_unknown_worker_floor';
    fallbacksFired.push('unknown_worker_floor');
  } else {
    floorGate = workerFloor === eventFloor ? 'match' : 'mismatch';
  }

  // --- gps axis ---
  let gpsGate: GpsGate;
  let distanceM: number | null = null;
  let gpsAgeS: number | null = null;
  if (input.gps === null) {
    gpsGate = 'fallback_no_fix';
    fallbacksFired.push('gps_unavailable');
  } else {
    const ageMs = input.nowMs - input.gps.timestamp;
    // Never record a negative age: a fix timestamped in the future (device clock
    // skew) would otherwise corrupt telemetry and read as perfectly fresh.
    gpsAgeS = Math.max(0, Math.round(ageMs / 1000));
    if (!isValidEventGeo(input.event)) {
      // Malformed event geo — no trustworthy distance exists. Report the
      // fallback, not a bogus number, and deliver (never miss a real alert).
      gpsGate = 'fallback_invalid_event_geo';
      fallbacksFired.push('event_geo_invalid');
    } else if (Math.abs(ageMs) > config.gpsStaleAfterMs) {
      // Too old, OR clock-skewed too far into the future — freshness is unusable.
      // A stale distance is not a measurement — report the fallback, not a number.
      gpsGate = 'fallback_stale_fix';
      fallbacksFired.push('gps_stale');
    } else {
      distanceM = haversineMeters(
        input.gps.latitude,
        input.gps.longitude,
        input.event.latitude,
        input.event.longitude,
      );
      gpsGate = distanceM <= input.event.alertRadiusM ? 'in_range' : 'out_of_range';
    }
  }

  const shouldPop = floorGate !== 'mismatch' && gpsGate !== 'out_of_range';
  return { shouldPop, distanceM, gpsAgeS, floorGate, gpsGate, fallbacksFired };
}

/**
 * The context_snapshot for the popped / ignored_out_of_range response — built
 * entirely from the input + verdict so the caller cannot re-derive (and get
 * wrong) any part of the decision record. Key list is documented in the design
 * doc §5; distance_m travels as a top-level request field, not here.
 */
export function proximityContextSnapshot(
  input: ProximityInput,
  verdict: ProximityVerdict,
): ContextSnapshot {
  return {
    worker_floor: input.workerFloor,
    event_floor: input.event.floor,
    floor_gate: verdict.floorGate,
    gps_gate: verdict.gpsGate,
    gps_age_s: verdict.gpsAgeS,
    fallbacks: verdict.fallbacksFired,
  };
}
