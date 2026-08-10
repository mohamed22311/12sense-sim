import {
  classifyContext,
  classifyMotion,
  classifyNoise,
  NOISE_CONFIG,
} from '../context/ambientContext';

/**
 * Ambient-context classifier (S3-MB1): raw step + noise readings → {motion,
 * noise} classes. Covers the motion truth table, the dBFS threshold boundary,
 * and the stale/missing → unknown safe-fallback rules that keep a stale
 * silence from suppressing the sound channel.
 */

describe('classifyMotion — Health Connect step signal', () => {
  it('readable + steps present → moving', () => {
    expect(classifyMotion({ stepsReadable: true, hasSteps: true, at: 0 })).toBe('moving');
  });

  it('readable + no steps → still (Samsung writes buckets only while stepping)', () => {
    expect(classifyMotion({ stepsReadable: true, hasSteps: false, at: 0 })).toBe('still');
  });

  it('not readable → unknown (null), regardless of hasSteps', () => {
    expect(classifyMotion({ stepsReadable: false, hasSteps: false, at: 0 })).toBeNull();
    expect(classifyMotion({ stepsReadable: false, hasSteps: true, at: 0 })).toBeNull();
  });

  it('missing signal → unknown (null)', () => {
    expect(classifyMotion(null)).toBeNull();
  });
});

describe('classifyNoise — dBFS threshold', () => {
  const { loudThresholdDbFs, staleAfterMs } = NOISE_CONFIG;

  it('above threshold → loud', () => {
    expect(classifyNoise({ dbFs: loudThresholdDbFs + 5, ageMs: 0 })).toBe('loud');
  });

  it('exactly at threshold → loud (inclusive boundary)', () => {
    expect(classifyNoise({ dbFs: loudThresholdDbFs, ageMs: 0 })).toBe('loud');
  });

  it('just below threshold → quiet', () => {
    expect(classifyNoise({ dbFs: loudThresholdDbFs - 0.001, ageMs: 0 })).toBe('quiet');
  });

  it('a very low level → quiet', () => {
    expect(classifyNoise({ dbFs: -80, ageMs: 1000 })).toBe('quiet');
  });

  it('stale sample → unknown (null), never a stale "quiet"', () => {
    expect(classifyNoise({ dbFs: -80, ageMs: staleAfterMs + 1 })).toBeNull();
  });

  it('sample exactly at the stale boundary is still usable', () => {
    expect(classifyNoise({ dbFs: -80, ageMs: staleAfterMs })).toBe('quiet');
  });

  it('missing sample → unknown (null)', () => {
    expect(classifyNoise(null)).toBeNull();
  });

  it('non-finite level → unknown (null)', () => {
    expect(classifyNoise({ dbFs: NaN, ageMs: 0 })).toBeNull();
    expect(classifyNoise({ dbFs: -Infinity, ageMs: 0 })).toBeNull();
  });

  it('a future-dated sample (clock skew) is treated as fresh', () => {
    expect(classifyNoise({ dbFs: loudThresholdDbFs, ageMs: -5000 })).toBe('loud');
  });
});

describe('classifyContext — composition', () => {
  it('composes both axes', () => {
    expect(
      classifyContext({
        motion: { stepsReadable: true, hasSteps: true, at: 0 },
        noise: { dbFs: -50, ageMs: 0 },
      }),
    ).toEqual({ motion: 'moving', noise: 'quiet' });
  });

  it('propagates unknowns independently', () => {
    expect(
      classifyContext({
        motion: null,
        noise: { dbFs: NOISE_CONFIG.loudThresholdDbFs, ageMs: 0 },
      }),
    ).toEqual({ motion: null, noise: 'loud' });
  });

  it('all-unknown when nothing is sensed', () => {
    expect(classifyContext({ motion: null, noise: null })).toEqual({ motion: null, noise: null });
  });
});
