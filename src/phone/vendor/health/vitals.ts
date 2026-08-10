/* VENDORED — DO NOT EDIT.
 * Source: TwelveSense-TT-MobileApp/Thalamus/src/health/vitals.ts @ 15b11d4
 * Sync check: `npm run check:vendor`. Fix drift by re-copying, never by editing.
 */
/**
 * Pure vitals logic for the Health Connect integration (Constitution III):
 * latest-reading selection, series extraction, freshness labels, and the
 * access truth table that drives graceful degradation. No I/O — the adapter
 * in healthConnect.ts feeds this module plain data.
 *
 * Scope: HR + steps + SpO2 — the signals Samsung Health actually writes to
 * Health Connect. HRV-RMSSD and respiratory rate are NOT synced on this path,
 * so they are never requested; see docs/research/health-signals.md §1.
 */

export type VitalKind = 'hr' | 'spo2';

export type VitalReading = {
  value: number;
  /** ISO timestamp of the sample itself (not of the poll that fetched it). */
  observedAt: string;
};

/** One sanitized step-count bucket (Health Connect StepsRecord). */
export type StepBucket = { startTime: string; endTime: string; count: number };

/** Latest reading per vital plus the trailing series the risk engine consumes. */
export type VitalsSnapshot = {
  hr: VitalReading | null;
  spo2: VitalReading | null;
  /** trailing HR samples (risk-engine window), ascending by observedAt */
  hrSeries: VitalReading[];
  /**
   * trailing SpO2 samples, ascending (S3-MB3). The risk engine judges only the
   * newest spot reading; this series exists for the SpO2 detail sheet's trend.
   * Samsung writes SpO2 on demand / during sleep, so it is routinely too sparse
   * to trend — which `seriesTrend` reports as `unknown`, the honest answer.
   */
  spo2Series: VitalReading[];
  /** trailing step buckets (risk-engine window), ascending by startTime */
  steps: StepBucket[];
  /**
   * the Steps grant was readable this poll. Samsung writes step buckets only
   * while stepping, so `steps` being empty means "not moving" when this is
   * true — and "no idea" when it is false.
   */
  stepsReadable: boolean;
  polledAt: string;
};

export const EMPTY_SNAPSHOT: VitalsSnapshot = {
  hr: null,
  spo2: null,
  hrSeries: [],
  spo2Series: [],
  steps: [],
  stepsReadable: false,
  polledAt: '',
};

// Structural seams for Health Connect records (the pure-module equivalent of
// WsLike in realtime/socket.ts — no dependency on react-native-health-connect).
export type HrRecordLike = { samples: { time: string; beatsPerMinute: number }[] };
export type Spo2RecordLike = { time: string; percentage: number };
export type StepsRecordLike = { startTime: string; endTime: string; count: number };

const validTime = (iso: string) => !Number.isNaN(new Date(iso).getTime());

/** Newest heart-rate sample across all records in the lookback window. */
export function latestHr(records: HrRecordLike[]): VitalReading | null {
  let best: VitalReading | null = null;
  for (const record of records) {
    for (const s of record.samples ?? []) {
      if (!Number.isFinite(s.beatsPerMinute) || s.beatsPerMinute <= 0 || !validTime(s.time)) continue;
      if (!best || new Date(s.time).getTime() > new Date(best.observedAt).getTime()) {
        best = { value: s.beatsPerMinute, observedAt: s.time };
      }
    }
  }
  return best;
}

/** Newest SpO2 percentage in the lookback window. */
export function latestSpo2(records: Spo2RecordLike[]): VitalReading | null {
  let best: VitalReading | null = null;
  for (const r of records) {
    if (!Number.isFinite(r.percentage) || r.percentage <= 0 || r.percentage > 100 || !validTime(r.time)) continue;
    if (!best || new Date(r.time).getTime() > new Date(best.observedAt).getTime()) {
      best = { value: r.percentage, observedAt: r.time };
    }
  }
  return best;
}

/**
 * All valid HR samples inside the trailing window, ascending by time — the
 * series the risk engine's sustained/accumulator math runs over. Reuses the
 * same sample validation as latestHr.
 */
export function hrSeries(records: HrRecordLike[], windowMs: number, nowIso: string): VitalReading[] {
  const now = new Date(nowIso).getTime();
  if (Number.isNaN(now)) return [];
  const out: VitalReading[] = [];
  for (const record of records) {
    for (const s of record.samples ?? []) {
      if (!Number.isFinite(s.beatsPerMinute) || s.beatsPerMinute <= 0 || !validTime(s.time)) continue;
      if (new Date(s.time).getTime() < now - windowMs) continue;
      out.push({ value: s.beatsPerMinute, observedAt: s.time });
    }
  }
  return out.sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime());
}

/**
 * All valid SpO2 samples inside the trailing window, ascending — the SpO2
 * counterpart of `hrSeries`, feeding the detail sheet's trend (S3-MB3). Reuses
 * latestSpo2's validation, so the series and the spot reading agree on what a
 * usable percentage is.
 */
export function spo2Series(
  records: Spo2RecordLike[],
  windowMs: number,
  nowIso: string,
): VitalReading[] {
  const now = new Date(nowIso).getTime();
  if (Number.isNaN(now)) return [];
  const out: VitalReading[] = [];
  for (const r of records) {
    if (!Number.isFinite(r.percentage) || r.percentage <= 0 || r.percentage > 100) continue;
    if (!validTime(r.time)) continue;
    if (new Date(r.time).getTime() < now - windowMs) continue;
    out.push({ value: r.percentage, observedAt: r.time });
  }
  return out.sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime());
}

/** Sanitized step buckets, ascending by start time; malformed records are skipped. */
export function stepBuckets(records: StepsRecordLike[]): StepBucket[] {
  const out: StepBucket[] = [];
  for (const r of records) {
    if (!Number.isFinite(r.count) || r.count < 0) continue;
    if (!validTime(r.startTime) || !validTime(r.endTime)) continue;
    if (new Date(r.endTime).getTime() < new Date(r.startTime).getTime()) continue;
    out.push({ startTime: r.startTime, endTime: r.endTime, count: r.count });
  }
  return out.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}

/** Milliseconds between a reading and `now`; null for bad timestamps, floored at 0. */
export function readingAgeMs(reading: VitalReading, nowIso: string): number | null {
  const at = new Date(reading.observedAt).getTime();
  const now = new Date(nowIso).getTime();
  if (Number.isNaN(at) || Number.isNaN(now)) return null;
  return Math.max(0, now - at);
}

/** Compact freshness label for the Home cards ("just now" / "4 min ago" / "3 hr ago"). */
export function formatAge(ageMs: number | null): string {
  if (ageMs === null) return '';
  const mins = Math.floor(ageMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)} hr ago`;
}

// ---------------------------------------------------------------------------
// Access truth table — what the app may read, given the Health Connect SDK
// status and the currently granted permissions.
// ---------------------------------------------------------------------------

/** Simplified Health Connect SDK status (mapped from SdkAvailabilityStatus by the adapter). */
export type HcAvailability = 'available' | 'needs-update' | 'unavailable';

export type PermissionLike = { accessType: string; recordType: string };

export type VitalAccess = 'ok' | 'denied' | 'unavailable';

export type AccessSummary = {
  availability: HcAvailability;
  hr: VitalAccess;
  spo2: VitalAccess;
  steps: VitalAccess;
  /** screen-off reads need the BackgroundAccessPermission grant */
  background: boolean;
  /** at least one signal is readable — drives whether polling is worth starting */
  anyReadable: boolean;
};

/**
 * | availability   | grant             | hr / spo2 / steps |
 * |----------------|-------------------|-------------------|
 * | unavailable    | (any)             | unavailable       |
 * | needs-update   | (any)             | unavailable       |
 * | available      | read granted      | ok                |
 * | available      | not granted       | denied            |
 * Missing/denied access never throws — it only narrows what we poll.
 */
export function accessSummary(
  availability: HcAvailability,
  granted: PermissionLike[],
): AccessSummary {
  const has = (recordType: string) =>
    granted.some((p) => p.accessType === 'read' && p.recordType === recordType);

  if (availability !== 'available') {
    return {
      availability,
      hr: 'unavailable',
      spo2: 'unavailable',
      steps: 'unavailable',
      background: false,
      anyReadable: false,
    };
  }
  const hr: VitalAccess = has('HeartRate') ? 'ok' : 'denied';
  const spo2: VitalAccess = has('OxygenSaturation') ? 'ok' : 'denied';
  const steps: VitalAccess = has('Steps') ? 'ok' : 'denied';
  return {
    availability,
    hr,
    spo2,
    steps,
    background: has('BackgroundAccessPermission'),
    anyReadable: hr === 'ok' || spo2 === 'ok' || steps === 'ok',
  };
}
