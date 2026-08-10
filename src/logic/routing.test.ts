import { describe, it, expect } from 'vitest';
import type { SensorData, RoutingDecision } from '../state/store';
import {
  routeWorker,
  buildReason,
  buildFlags,
  isMoving,
  isHighNoise,
  NOISE_THRESHOLD_DB,
} from './routing';

// A nominal, all-clear sensor reading. Tests override only the fields they exercise,
// so each case states exactly what drives the behaviour under test.
function sensors(overrides: Partial<SensorData> = {}): SensorData {
  return {
    heart_rate: 72,
    stress_index: 20,
    spo2: 98,
    noise_level: 40,
    motion_state: 'Stationary',
    battery: 90,
    ...overrides,
  };
}

describe('routeWorker — the chartered motion×noise truth table', () => {
  // The whole decision is asserted per row so a wrong channel/primary/suppression is caught.
  // The `Walking + high` row follows the charter: haptic only (audio can't be heard over
  // high noise). It is gated by AUDIO_IN_HIGH_NOISE_MOTION in routing.ts.
  const cases: Array<{
    name: string;
    motion: SensorData['motion_state'];
    noise: number;
    expected: RoutingDecision;
  }> = [
    { name: 'moving + high noise → haptic only (audio + visual suppressed, per charter)', motion: 'Walking', noise: 86,
      expected: { channels: ['haptic'], primary: 'haptic', suppressed: ['visual', 'audio'] } },
    { name: 'moving + low noise → haptic + audio', motion: 'Walking', noise: 50,
      expected: { channels: ['haptic', 'audio'], primary: 'haptic', suppressed: ['visual'] } },
    { name: 'stationary + high noise → haptic + visual', motion: 'Stationary', noise: 89,
      expected: { channels: ['haptic', 'visual'], primary: 'haptic', suppressed: ['audio'] } },
    { name: 'stationary + low noise → visual primary', motion: 'Stationary', noise: 43,
      expected: { channels: ['visual', 'audio'], primary: 'visual', suppressed: ['haptic'] } },
  ];

  it.each(cases)('$name', ({ motion, noise, expected }) => {
    expect(routeWorker(sensors({ motion_state: motion, noise_level: noise }))).toEqual(expected);
  });
});

describe('isMoving', () => {
  it('treats Walking and Running as moving', () => {
    expect(isMoving('Walking')).toBe(true);
    expect(isMoving('Running')).toBe(true);
  });

  it('treats Stationary and Resting as not moving', () => {
    expect(isMoving('Stationary')).toBe(false);
    expect(isMoving('Resting')).toBe(false);
  });

  it('safe fallback: treats unknown/missing motion as moving', () => {
    expect(isMoving(undefined)).toBe(true);
  });
});

describe('isHighNoise — threshold and safe fallback', () => {
  it(`is exclusive at the ${NOISE_THRESHOLD_DB} dB boundary`, () => {
    expect(isHighNoise(NOISE_THRESHOLD_DB)).toBe(false); // 70 dB is not "high"
    expect(isHighNoise(NOISE_THRESHOLD_DB + 1)).toBe(true); // 71 dB is
  });

  it('safe fallback: treats missing/NaN noise as high', () => {
    expect(isHighNoise(undefined)).toBe(true);
    expect(isHighNoise(NaN)).toBe(true);
  });
});

describe('routeWorker — safe fallback on bad input routes to the wrist', () => {
  it('missing noise (treated as high) + stationary → haptic + visual', () => {
    const d = routeWorker(sensors({ motion_state: 'Stationary', noise_level: undefined as unknown as number }));
    expect(d.channels).toEqual(['haptic', 'visual']);
    expect(d.primary).toBe('haptic');
  });
});

describe('buildReason', () => {
  it('returns a distinct explanation for each combination', () => {
    expect(buildReason(true, true)).toMatch(/motion.*high noise/i);
    expect(buildReason(true, false)).toMatch(/motion.*low noise/i);
    expect(buildReason(false, true)).toMatch(/stationary.*high noise/i);
    expect(buildReason(false, false)).toMatch(/stationary.*low noise/i);
  });
});

describe('buildFlags', () => {
  it('surfaces no flags for a nominal reading', () => {
    expect(buildFlags(sensors())).toEqual([]);
  });

  it('flags high stress, elevated HR, low SpO₂ and low battery', () => {
    const flags = buildFlags(sensors({ stress_index: 84, heart_rate: 118, spo2: 94, battery: 12 }));
    expect(flags).toEqual(expect.arrayContaining(['High Stress', 'Elevated HR', 'Low SpO₂', 'Low Battery']));
  });

  it('includes a rounded dB reading only when noise is above threshold', () => {
    expect(buildFlags(sensors({ noise_level: 70 }))).not.toContain('70 dB');
    expect(buildFlags(sensors({ noise_level: 85.6 }))).toContain('86 dB');
  });
});
