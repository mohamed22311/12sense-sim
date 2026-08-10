/**
 * Activity → vitals.
 *
 * This module exists because of one property of the vendored risk engine: the
 * `stress` rule only fires when a worker reads as **inactive**, which it
 * determines from step buckets. Movement that raises heart rate without writing
 * steps therefore makes every hard-working worker also light up as
 * pathologically stressed while apparently standing still. The engine is
 * correct; the input would have been wrong.
 *
 * So heart rate and steps are written together, and both are driven by
 * **metres actually moved** rather than by the activity label. A `patrol` job
 * dwells with the activity `walking` while standing perfectly still, and a
 * worker labelled `resting` may still be shuffling toward a bench — trusting
 * the label in either direction produces vitals that contradict the movement
 * on screen.
 */
import type { Activity } from '@/sim/jobs';
import type { VitalsBuffer } from '@/phone/vitalsBuffer';

export const PHYSIOLOGY = {
  /** target heart rates, bpm */
  walkingBpm: 105,
  climbingBpm: 135,
  carryingBpm: 118,
  /** stationary but occupied — operating, inspecting, sweeping */
  workingBpm: 96,
  /** bpm per second the heart moves toward its target */
  approachRate: 1.6,
  /** an average adult stride */
  stepsPerMetre: 1.35,
  /** how often a step bucket is closed and an HR sample written, ms */
  sampleIntervalMs: 15_000,
  /**
   * How often a fresh SpO2 spot reading is taken, ms.
   *
   * Longer than the HR cadence because that is how the hardware behaves: a
   * watch samples heart rate continuously and blood oxygen only periodically.
   * It must nonetheless be well inside `RISK_CONFIG.staleAfterMs` (15 min) —
   * without it, the seeded reading ages out and every worker in the building
   * turns amber with "SpO2 reading is stale" a quarter of an hour into a demo.
   * That is the engine correctly reporting a defect in the simulator's input.
   */
  spo2IntervalMs: 3 * 60_000,
  /** healthy resting range for a working adult, % */
  spo2Range: [96, 99] as const,
  /** SpO2 dips slightly under sustained exertion */
  spo2ExertionDrop: 1.5,
} as const;

export type PhysiologyState = {
  hr: number;
  /** fractional steps not yet written into a bucket */
  pendingSteps: number;
  /** ms since the last bucket was closed */
  sinceSampleMs: number;
  /** ms since the last SpO2 spot reading */
  sinceSpo2Ms: number;
  /** epoch ms the current bucket started accumulating */
  bucketStartedAtMs: number | null;
};

export function initialPhysiology(restingHr: number): PhysiologyState {
  return {
    hr: restingHr,
    pendingSteps: 0,
    sinceSampleMs: 0,
    // Due immediately, so a worker has a fresh reading from their first tick
    // rather than carrying the seeded one for three minutes.
    sinceSpo2Ms: PHYSIOLOGY.spo2IntervalMs,
    bucketStartedAtMs: null,
  };
}

/**
 * Activities that cost something while standing still.
 *
 * `climbing` is here deliberately, and it is the one entry that is not
 * obvious: a worker traversing a portal holds position for the stairwell's
 * travel time, so `metresMoved` is zero for the whole climb. Without this,
 * heart rate would target *resting* while someone walks up three flights —
 * measured falling from 97 to 75 bpm mid-ascent — and `climbingBpm` would be
 * unreachable in practice.
 */
const OCCUPIED: ReadonlySet<Activity> = new Set([
  'operating', 'inspecting', 'sweeping', 'carrying', 'climbing',
]);

/**
 * The heart rate this worker is heading toward.
 *
 * Movement decides first: if they are covering ground, the label only chooses
 * *how hard* (climbing costs more than walking). If they are not moving, the
 * label decides whether they are working or at rest.
 */
function targetHr(activity: Activity, metresMoved: number, restingHr: number): number {
  // Climbing is exertion whether or not the avatar covers ground: the portal
  // holds position while the worker is on the stairs.
  if (activity === 'climbing') return PHYSIOLOGY.climbingBpm;
  if (metresMoved > 0) {
    if (activity === 'carrying') return PHYSIOLOGY.carryingBpm;
    return PHYSIOLOGY.walkingBpm;
  }
  return OCCUPIED.has(activity) ? PHYSIOLOGY.workingBpm : restingHr;
}

/**
 * A plausible spot reading. Healthy band, nudged down a little when the heart
 * is working hard, and deterministic per worker-instant so a demo does not
 * flicker between readings.
 */
function spo2For(hr: number, restingHr: number, nowMs: number): number {
  const [low, high] = PHYSIOLOGY.spo2Range;
  const exertion = Math.min(1, Math.max(0, (hr - restingHr) / 60));
  const wobble = (Math.sin(nowMs / 97_000) + 1) / 2;
  const value = high - wobble * (high - low) - exertion * PHYSIOLOGY.spo2ExertionDrop;
  return Math.round(Math.min(100, Math.max(90, value)) * 10) / 10;
}

export function advancePhysiology(
  state: PhysiologyState,
  activity: Activity,
  metresMoved: number,
  restingHr: number,
  dtMs: number,
  nowMs: number,
  buffer: VitalsBuffer,
): PhysiologyState {
  const target = targetHr(activity, metresMoved, restingHr);

  // Linear approach, clamped so it settles exactly on the target rather than
  // oscillating around it.
  const maxDelta = (PHYSIOLOGY.approachRate * dtMs) / 1_000;
  const gap = target - state.hr;
  const hr = Math.abs(gap) <= maxDelta ? target : state.hr + Math.sign(gap) * maxDelta;

  const pendingSteps = state.pendingSteps + metresMoved * PHYSIOLOGY.stepsPerMetre;
  const sinceSampleMs = state.sinceSampleMs + dtMs;
  const bucketStartedAtMs = state.bucketStartedAtMs ?? nowMs - dtMs;

  // A periodic spot reading on its own, slower cadence.
  let sinceSpo2Ms = state.sinceSpo2Ms + dtMs;
  if (sinceSpo2Ms >= PHYSIOLOGY.spo2IntervalMs) {
    buffer.setSpo2(spo2For(hr, restingHr, nowMs), nowMs);
    sinceSpo2Ms = 0;
  }

  if (sinceSampleMs < PHYSIOLOGY.sampleIntervalMs) {
    return { hr, pendingSteps, sinceSampleMs, sinceSpo2Ms, bucketStartedAtMs };
  }

  buffer.append(hr, nowMs);

  const whole = Math.floor(pendingSteps);
  if (whole >= 1) {
    // Never write a zero-count bucket. Samsung writes a bucket only while
    // stepping, so an empty-but-present bucket is a different signal from no
    // bucket at all — and `isInactive` reads exactly that distinction.
    buffer.appendSteps(whole, bucketStartedAtMs, nowMs);
  }

  return {
    hr,
    pendingSteps: pendingSteps - whole,
    sinceSampleMs: 0,
    sinceSpo2Ms,
    bucketStartedAtMs: nowMs,
  };
}
