import { RISK_CONFIG } from '../health/risk';
import { VitalReading } from '../health/vitals';
import { estimateRestingHr, percentile } from '../health/baseline';

/**
 * Resting-HR estimation (health-signals.md §4): a rolling low percentile of
 * HR sampled during inactivity. Samples taken while stepping must not drag
 * the baseline up, and too little quiet data yields null — never a guess.
 */

const base = new Date('2026-07-16T12:00:00Z').getTime();
const atMinsAgo = (mins: number) => new Date(base - mins * 60_000).toISOString();

const sample = (value: number, minsAgo: number): VitalReading => ({
  value,
  observedAt: atMinsAgo(minsAgo),
});

const bucket = (count: number, fromMinsAgo: number, toMinsAgo: number) => ({
  startTime: atMinsAgo(fromMinsAgo),
  endTime: atMinsAgo(toMinsAgo),
  count,
});

describe('percentile', () => {
  it('interpolates linearly between ranks', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(values, 0.05)).toBeCloseTo(5.95);
    expect(percentile(values, 0.5)).toBeCloseTo(50.5);
  });

  it('handles the edges and empty input', () => {
    expect(percentile([7], 0.05)).toBe(7);
    expect(percentile([3, 9], 0)).toBe(3);
    expect(percentile([3, 9], 1)).toBe(9);
    expect(percentile([], 0.05)).toBeNull();
  });

  it('does not depend on input order', () => {
    expect(percentile([9, 3, 6], 0.5)).toBe(6);
  });
});

describe('estimateRestingHr', () => {
  it('takes the low percentile of quiet samples only', () => {
    // 40 quiet sleep-like samples 58..62 bpm (no step buckets = no steps),
    // plus 30 working samples at 120 bpm inside a step-y hour.
    const quiet = Array.from({ length: 40 }, (_, i) => sample(58 + (i % 5), 500 + i));
    const working = Array.from({ length: 30 }, (_, i) => sample(120, 100 + i));
    const steps = [bucket(3000, 135, 95)];

    expect(estimateRestingHr([...working, ...quiet], steps)).toBe(58);
  });

  it('samples during stepping are excluded even at low HR', () => {
    const quiet = Array.from({ length: 30 }, (_, i) => sample(64, 500 + i));
    const walkingLow = Array.from({ length: 30 }, (_, i) => sample(50, 100 + i));
    const steps = [bucket(3000, 135, 95)];

    // without the gate the 5th percentile would be 50
    expect(estimateRestingHr([...walkingLow, ...quiet], steps)).toBe(64);
  });

  it('returns null below the minimum sample count — no guessed baseline', () => {
    const few = Array.from(
      { length: RISK_CONFIG.baseline.minSamples - 1 },
      (_, i) => sample(60, 500 + i),
    );
    expect(estimateRestingHr(few, [])).toBeNull();
    expect(estimateRestingHr([], [])).toBeNull();
  });

  it('skips malformed samples instead of throwing', () => {
    const good = Array.from({ length: 25 }, (_, i) => sample(60, 500 + i));
    const bad: VitalReading[] = [
      { value: NaN, observedAt: atMinsAgo(490) },
      { value: 0, observedAt: atMinsAgo(489) },
      { value: 55, observedAt: 'bogus' },
    ];
    expect(estimateRestingHr([...good, ...bad], [])).toBe(60);
  });
});
