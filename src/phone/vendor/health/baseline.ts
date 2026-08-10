/* VENDORED — DO NOT EDIT.
 * Source: TwelveSense-TT-MobileApp/Thalamus/src/health/baseline.ts @ 15b11d4
 * Sync check: `npm run check:vendor`. Fix drift by re-copying, never by editing.
 */
/**
 * Resting-HR baseline estimation (docs/research/health-signals.md §4).
 * Samsung Health never writes RestingHeartRateRecord, so the personal
 * baseline is estimated: a low percentile of the HR samples taken while the
 * worker was inactive over the trailing days. Pure — restingBaseline.ts owns
 * the 7-day read and persistence.
 *
 * Inactivity matches the alerting gate in risk.ts: watches write step
 * buckets only while stepping, so a sample with no bucket around it counts
 * as inactive — sleep is exactly the data we want here. (Unlike the gate,
 * no readable-grant flag is needed: with Steps denied the step list is
 * simply empty and the low percentile still lands on quiet HR.)
 */

import { RISK_CONFIG, stepsInWindow } from './risk';
import { StepBucket, VitalReading } from './vitals';

/** Linear-interpolated percentile (p in 0..1) — null for an empty list. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Estimated resting HR: the configured low percentile of valid HR samples
 * observed during inactivity. Returns null (— not a guess) below
 * `baseline.minSamples` qualifying samples, so a brand-new install simply has
 * no baseline until enough quiet data accumulates.
 */
export function estimateRestingHr(
  hrSamples: VitalReading[],
  steps: StepBucket[],
): number | null {
  const { minSamples, percentile: p } = RISK_CONFIG.baseline;
  const { windowMs, maxSteps } = RISK_CONFIG.inactivity;

  const quiet: number[] = [];
  for (const s of hrSamples) {
    if (!Number.isFinite(s.value) || s.value <= 0) continue;
    if (Number.isNaN(new Date(s.observedAt).getTime())) continue;
    // steps around the sample; no bucket at all = no steps = inactive
    if (stepsInWindow(steps, windowMs, s.observedAt) > maxSteps) continue;
    quiet.push(s.value);
  }
  if (quiet.length < minSamples) return null;
  const estimate = percentile(quiet, p);
  return estimate === null ? null : Math.round(estimate);
}
