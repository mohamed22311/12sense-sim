/**
 * The trailing vitals series one virtual phone's risk engine reads.
 *
 * The engine needs history: `exertion` wants 3 sustained minutes, `load`
 * accumulates over a trailing hour. A real phone gets that by polling a watch
 * every 60 s for an hour. A demo cannot wait, and lowering the thresholds would
 * mean demoing different rules from the product — so the buffer is authored
 * instead: `seed` lays down a plausible hour of resting history at start-up,
 * and `backfillHr` rewrites its trailing minutes when you change a vital.
 *
 * `risk.ts` is then handed a series indistinguishable from a real one and
 * decides with its own unmodified thresholds. The engine is not faked; only the
 * history it reads is authored, which is what a simulator is for.
 */
import type { StepBucket, VitalReading } from '@/phone/vendor/health/vitals';

/** Matches RISK_CONFIG.cumulativeLoad.windowMs, the longest window any rule reads. */
export const BUFFER_WINDOW_MS = 60 * 60_000;

/**
 * Spacing between stored samples. Well inside RISK_CONFIG.series.maxSampleGapMs
 * (5 min), so a sustained run never breaks on a gap, and coarse enough that
 * sixty buffers stay small — 60 min at 15 s is 240 samples each.
 */
export const SAMPLE_INTERVAL_MS = 15_000;

/**
 * How much history a backfill rewrites. Comfortably over
 * RISK_CONFIG.exertion.sustainedMs (3 min) and RISK_CONFIG.restingHr.sustainedMs
 * (10 min), so every sustained rule sees a complete run rather than a partial
 * one that silently fails to fire.
 */
export const BACKFILL_MS = 20 * 60_000;

const iso = (ms: number) => new Date(ms).toISOString();

/** Deterministic ±jitter so a seeded series looks measured, not drawn. */
const jitter = (seed: number, spread: number) =>
  (Math.sin(seed * 12.9898) * 43758.5453 % 1) * spread;

/**
 * `seed()`'s pre-change default SpO2, kept here so the one call site that
 * used to get it implicitly (`fleet.ts`, at buffer creation) can set it
 * explicitly instead, without behaviour on a first seed changing.
 */
export const INITIAL_SPO2 = 98;

export class VitalsBuffer {
  private hr: VitalReading[] = [];
  private spo2Reading: VitalReading | null = null;
  private stepBuckets: StepBucket[] = [];

  /**
   * Lay down a full window of resting HEART-RATE history, so the engine's HR
   * series is never cold. Deliberately does NOT touch the SpO2 reading or
   * step buckets: a Reset flow that re-seeds (e.g. to change a worker's
   * baseline HR) must not silently discard already-accumulated steps or an
   * already-set SpO2 reading. Callers seed those independently, once, via
   * `setSpo2`/`appendSteps` — see `fleet.ts` for the SpO2 call site.
   */
  seed(restingHr: number, nowMs: number): void {
    this.hr = [];
    for (let t = nowMs - BUFFER_WINDOW_MS; t <= nowMs; t += SAMPLE_INTERVAL_MS) {
      this.hr.push({ value: Math.round(restingHr + jitter(t, 6) - 3), observedAt: iso(t) });
    }
  }

  append(value: number, atMs: number): void {
    this.hr.push({ value: Math.round(value), observedAt: iso(atMs) });
    this.evict(atMs);
  }

  setSpo2(pct: number, atMs: number): void {
    this.spo2Reading = { value: pct, observedAt: iso(atMs) };
  }

  appendSteps(count: number, fromMs: number, toMs: number): void {
    if (count <= 0) return;
    this.stepBuckets.push({ startTime: iso(fromMs), endTime: iso(toMs), count });
    const cutoff = toMs - BUFFER_WINDOW_MS;
    this.stepBuckets = this.stepBuckets.filter((b) => Date.parse(b.endTime) >= cutoff);
  }

  /**
   * Rewrite the trailing `overMs` of heart-rate history to `target`, so a
   * sustained rule sees a complete run ending now. Samples older than the
   * window are left alone — the hour before the change really did happen.
   */
  backfillHr(target: number, overMs: number, nowMs: number): void {
    const from = nowMs - overMs;
    this.hr = this.hr.filter((r) => Date.parse(r.observedAt) < from);
    for (let t = from; t <= nowMs; t += SAMPLE_INTERVAL_MS) {
      this.hr.push({ value: Math.round(target + jitter(t, 4) - 2), observedAt: iso(t) });
    }
    this.evict(nowMs);
  }

  hrSeries(): VitalReading[] {
    return this.hr;
  }

  spo2(): VitalReading | null {
    return this.spo2Reading;
  }

  steps(): StepBucket[] {
    return this.stepBuckets;
  }

  private evict(nowMs: number): void {
    const cutoff = nowMs - BUFFER_WINDOW_MS;
    this.hr = this.hr
      .filter((r) => Date.parse(r.observedAt) >= cutoff)
      .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  }
}
