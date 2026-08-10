import { describe, expect, it } from 'vitest';
import { VitalsBuffer } from '@/phone/vitalsBuffer';
import { RISK_CONFIG, isInactive } from '@/phone/vendor/health/risk';
import { advancePhysiology, initialPhysiology } from '@/phone/physiology';

const NOW = Date.parse('2026-08-10T09:00:00Z');
const RESTING = 60;
const STEP_MS = 500;

/** Run `activity` for `ms`, moving `metresPerSecond`, into `buffer`. */
const drive = (
  buffer: VitalsBuffer,
  activity: Parameters<typeof advancePhysiology>[1],
  ms: number,
  metresPerSecond: number,
  from = initialPhysiology(RESTING),
  startAt = NOW,
) => {
  let state = from;
  let at = startAt;
  for (let elapsed = 0; elapsed < ms; elapsed += STEP_MS) {
    at += STEP_MS;
    state = advancePhysiology(
      state, activity, metresPerSecond * (STEP_MS / 1000),
      RESTING, STEP_MS, at, buffer,
    );
  }
  return { state, at };
};

describe('physiology', () => {
  it("starts at the worker's resting heart rate", () => {
    expect(initialPhysiology(RESTING).hr).toBeCloseTo(RESTING, 0);
  });

  it('raises heart rate while walking', () => {
    const { state } = drive(new VitalsBuffer(), 'walking', 120_000, 1.3);
    expect(state.hr).toBeGreaterThan(RESTING + 20);
  });

  it('recovers toward resting once the worker stops', () => {
    const buffer = new VitalsBuffer();
    const walked = drive(buffer, 'walking', 120_000, 1.3);
    const peak = walked.state.hr;
    const rested = drive(buffer, 'resting', 300_000, 0, walked.state, walked.at);
    expect(rested.state.hr).toBeLessThan(peak);
    expect(rested.state.hr).toBeCloseTo(RESTING, 0);
  });

  it('climbing is harder than walking', () => {
    const climbed = drive(new VitalsBuffer(), 'climbing', 120_000, 0.8);
    const walked = drive(new VitalsBuffer(), 'walking', 120_000, 1.3);
    expect(climbed.state.hr).toBeGreaterThan(walked.state.hr);
  });

  // ── The two that matter ────────────────────────────────────────────────
  // The vendored stress rule only fires when a worker reads as INACTIVE. If
  // movement raises heart rate without writing step buckets, every exerting
  // worker also trips `stress` as though sitting still. The engine is right;
  // the input would be wrong.

  it('writes step buckets while walking, so the vendored gate reads MOVING', () => {
    const buffer = new VitalsBuffer();
    const { at } = drive(buffer, 'walking', 120_000, 1.3);
    expect(buffer.steps().length).toBeGreaterThan(0);
    expect(isInactive(buffer.steps(), new Date(at).toISOString(), true)).toBe(false);
  });

  it('writes no steps while resting, so the vendored gate reads INACTIVE', () => {
    const buffer = new VitalsBuffer();
    const { at } = drive(buffer, 'resting', 120_000, 0);
    expect(isInactive(buffer.steps(), new Date(at).toISOString(), true)).toBe(true);
  });

  // ── Robustness against the activity label lying ────────────────────────

  it('a stationary worker labelled "walking" does not gain a walking heart rate', () => {
    // `patrol` dwells with activity 'walking' while standing still. Heart rate
    // must follow actual exertion, not the label, or a standing worker drifts
    // up toward a walking rate and the stress rule sees an elevated resting HR.
    const { state } = drive(new VitalsBuffer(), 'walking', 120_000, 0);
    expect(state.hr).toBeCloseTo(RESTING, 0);
  });

  it('a moving worker labelled "resting" still writes steps', () => {
    const buffer = new VitalsBuffer();
    const { at } = drive(buffer, 'resting', 120_000, 1.3);
    expect(isInactive(buffer.steps(), new Date(at).toISOString(), true)).toBe(false);
  });

  it('appends heart-rate samples the engine can read', () => {
    const buffer = new VitalsBuffer();
    drive(buffer, 'walking', 120_000, 1.3);
    expect(buffer.hrSeries().length).toBeGreaterThan(3);
  });

  it('never writes an empty step bucket', () => {
    const buffer = new VitalsBuffer();
    drive(buffer, 'resting', 300_000, 0);
    for (const bucket of buffer.steps()) expect(bucket.count).toBeGreaterThan(0);
  });

  // ── Regressions found by the Phase 2A whole-branch review ─────────────

  it('refreshes SpO2, so the engine does not report it stale mid-demo', () => {
    // Seeded once and never rewritten, SpO2 ages past RISK_CONFIG.staleAfterMs
    // (15 min) and every worker in the building turns amber with "SpO2 reading
    // is stale" a quarter of an hour in — the engine correctly reporting a
    // defect in the simulator's input.
    const buffer = new VitalsBuffer();
    buffer.setSpo2(98, NOW);
    const { at } = drive(buffer, 'operating', 25 * 60_000, 0);
    const reading = buffer.spo2()!;
    const ageMs = at - Date.parse(reading.observedAt);
    expect(ageMs).toBeLessThan(RISK_CONFIG.staleAfterMs);
  });

  it('keeps SpO2 in a plausible healthy band', () => {
    const buffer = new VitalsBuffer();
    drive(buffer, 'walking', 20 * 60_000, 1.3);
    const value = buffer.spo2()!.value;
    expect(value).toBeGreaterThanOrEqual(90);
    expect(value).toBeLessThanOrEqual(100);
  });

  it('treats climbing as exertion even though the portal holds position', () => {
    // A worker traversing a stairwell does not move, so keying purely on
    // metres would target RESTING while they climb three flights — measured
    // falling from 97 to 75 bpm mid-ascent before this was fixed.
    const buffer = new VitalsBuffer();
    const { state } = drive(buffer, 'climbing', 60_000, 0);
    expect(state.hr).toBeGreaterThan(RESTING + 15);
  });

  it('never emits a negative or absurd heart rate', () => {
    const buffer = new VitalsBuffer();
    let state = initialPhysiology(RESTING);
    let at = NOW;
    for (let elapsed = 0; elapsed < 600_000; elapsed += STEP_MS) {
      at += STEP_MS;
      state = advancePhysiology(
        state, elapsed % 2 === 0 ? 'climbing' : 'resting', 0.4,
        RESTING, STEP_MS, at, buffer,
      );
      expect(state.hr).toBeGreaterThan(30);
      expect(state.hr).toBeLessThan(210);
    }
  });
});
