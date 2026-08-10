/* VENDORED — DO NOT EDIT.
 * Source: TwelveSense-TT-MobileApp/Thalamus/src/context/ambientContext.ts @ 15b11d4
 * Sync check: `npm run check:vendor`. Fix drift by re-copying, never by editing.
 */
/**
 * Ambient-context classifier — pure module (S3-MB1).
 *
 * Turns the raw signals gathered by the I/O shells (the Health Connect step
 * reading + the rolling ambient-noise monitor) into the coarse {motion, noise}
 * classes the modality selector (modality.ts) consumes. Kept separate from
 * decideModality so the two concerns test independently: this file owns "how
 * loud is loud" and "is the worker moving", modality.ts owns "which channels
 * land". No I/O, no React (Constitution III).
 *
 * Motion (design doc §5 decision — reuse the step signal, no new sensor):
 *   Samsung Health writes step buckets into Health Connect only *while*
 *   stepping, so — WHEN the Steps grant is readable — an empty window means
 *   "still" and a non-empty window means "moving". When Steps is NOT readable
 *   (grant denied / vitals pipeline down) motion is unknown → null. (Accepted
 *   limitation: the Samsung→HC sync lags minutes, so a worker who just started
 *   walking can still read "still".)
 *
 * Noise (design doc §5 decision — dBFS, no absolute SPL claim):
 *   Phone mics only give a level relative to full scale (dBFS, always ≤ 0), and
 *   converting to absolute dB SPL needs per-device calibration we deliberately
 *   don't fake. We threshold directly on dBFS: at/above `loudThresholdDbFs`
 *   the environment masks an alert tone ("loud"). A sample older than
 *   `staleAfterMs` (or no sample at all) is unknown → null, NOT "quiet" — a
 *   stale silence must not suppress the sound channel (Constitution V bias to
 *   deliver).
 */

import { Motion, Noise } from './modality';

export const NOISE_CONFIG = Object.freeze({
  /**
   * dBFS at/above which ambient noise is treated as masking (→ sound
   * suppressed). Device-relative and negative by nature; calibrated on the demo
   * S24 Ultra from the `[noise] dbFs=` logcat clusters (quiet vs. loud) rather
   * than an acoustic constant — retune here if the target hardware changes.
   */
  loudThresholdDbFs: -25,
  /** length of one native mic capture window */
  windowMs: 1000,
  /** cadence of the rolling monitor's samples while the vitals FGS is up */
  sampleEveryMs: 20_000,
  /** samples older than this are evicted from the rolling buffer */
  bufferKeepMs: 120_000,
  /**
   * a noise reading older than this is unknown, not quiet — a worker can walk
   * from a quiet office into a running plant in under this window, so a stale
   * "quiet" must never keep the sound channel on a masked alert.
   */
  staleAfterMs: 90_000,
});

export type AmbientConfig = typeof NOISE_CONFIG;

/** raw motion signal as read from the latest vitals poll (contextStore.ts) */
export type MotionSignal = {
  /** the Health Connect Steps grant returned data this poll */
  stepsReadable: boolean;
  /** at least one step bucket in the poll's lookback window */
  hasSteps: boolean;
  /**
   * epoch ms of the poll that produced this reading. Carried since S3-MB2 so
   * the "Why this alert?" panel can age the motion axis and the snapshot's
   * `freshness_s` can report the OLDEST contributing signal — the 60 s vitals
   * poll and the ~20 s mic monitor go stale at different rates.
   */
  at: number;
};

/** raw noise signal as read from the rolling monitor (getAmbientNoise) */
export type NoiseSample = {
  /** median dBFS across the in-window samples (≤ 0) */
  dbFs: number;
  /** age of the newest contributing sample, ms */
  ageMs: number;
};

/**
 * Still vs. moving from the step signal. Unknown (null) only when Steps was not
 * readable — an empty-but-readable window is a definite "still" (Samsung writes
 * buckets only while stepping).
 */
export function classifyMotion(signal: MotionSignal | null): Motion | null {
  if (signal === null || !signal.stepsReadable) return null;
  return signal.hasSteps ? 'moving' : 'still';
}

/**
 * Quiet vs. loud from the newest noise reading. Null (unknown) when there is no
 * sample or the sample is stale or the level is not a finite number. "Loud" is
 * inclusive of the threshold.
 */
export function classifyNoise(
  sample: NoiseSample | null,
  config: AmbientConfig = NOISE_CONFIG,
): Noise | null {
  if (sample === null) return null;
  if (!Number.isFinite(sample.dbFs)) return null;
  // A negative age (clock skew) is treated as fresh; only genuinely old
  // readings are stale.
  if (sample.ageMs > config.staleAfterMs) return null;
  return sample.dbFs >= config.loudThresholdDbFs ? 'loud' : 'quiet';
}

/** Compose both axes into the context the modality selector reads. */
export function classifyContext(
  raw: { motion: MotionSignal | null; noise: NoiseSample | null },
  config: AmbientConfig = NOISE_CONFIG,
): { motion: Motion | null; noise: Noise | null } {
  return {
    motion: classifyMotion(raw.motion),
    noise: classifyNoise(raw.noise, config),
  };
}
