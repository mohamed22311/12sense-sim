import { describe, expect, it } from 'vitest';
import { assessRisk, RISK_CONFIG } from '@/phone/vendor/health/risk';
import { BACKFILL_MS, BUFFER_WINDOW_MS, VitalsBuffer } from '@/phone/vitalsBuffer';

const NOW = Date.parse('2026-08-09T12:00:00Z');

describe('VitalsBuffer', () => {
  it('evicts samples older than the window', () => {
    const b = new VitalsBuffer();
    b.append(70, NOW - BUFFER_WINDOW_MS - 60_000);
    b.append(72, NOW);
    expect(b.hrSeries()).toHaveLength(1);
  });

  it('keeps samples in ascending time order', () => {
    const b = new VitalsBuffer();
    b.append(70, NOW - 30_000);
    b.append(75, NOW);
    const times = b.hrSeries().map((r) => Date.parse(r.observedAt));
    expect(times).toEqual([...times].sort((a, z) => a - z));
  });

  it('seeds a full window of plausible resting history', () => {
    const b = new VitalsBuffer();
    b.seed(62, NOW);
    const series = b.hrSeries();
    expect(series.length).toBeGreaterThan(10);
    expect(Math.min(...series.map((r) => r.value))).toBeGreaterThan(40);
    expect(Math.max(...series.map((r) => r.value))).toBeLessThan(100);
  });

  it('backfill makes the real engine return danger with no threshold change', () => {
    const b = new VitalsBuffer();
    b.seed(62, NOW);
    // 34-year-old: hrMax = 208 - 0.7*34 = 184.2; danger is > 85% => > 156.6
    b.backfillHr(170, BACKFILL_MS, NOW);

    const assessment = assessRisk({
      hrSeries: b.hrSeries(),
      spo2: b.spo2(),
      steps: b.steps(),
      stepsReadable: true,
      restingHr: 62,
      age: 34,
      nowIso: new Date(NOW).toISOString(),
    });

    expect(assessment.measuredBand).toBe('danger');
    expect(RISK_CONFIG.exertion.dangerPct).toBe(0.85); // unchanged, as promised
  });

  it('backfill covers more than the sustained window the engine requires', () => {
    expect(BACKFILL_MS).toBeGreaterThan(RISK_CONFIG.exertion.sustainedMs);
  });

  it('reports the newest spo2 reading', () => {
    const b = new VitalsBuffer();
    b.setSpo2(97, NOW - 60_000);
    b.setSpo2(93, NOW);
    expect(b.spo2()?.value).toBe(93);
  });

  it('a re-seed preserves previously appended steps and SpO2 (a Reset must not discard them)', () => {
    const b = new VitalsBuffer();
    b.seed(62, NOW - 60_000);
    b.setSpo2(91, NOW - 30_000);
    b.appendSteps(500, NOW - 30_000, NOW);

    // Re-seed — e.g. a Reset flow that changes the worker's baseline HR.
    b.seed(70, NOW);

    expect(b.spo2()?.value).toBe(91);
    expect(b.steps()).toHaveLength(1);
    expect(b.steps()[0].count).toBe(500);
    // The HR series itself is still replaced by the new seed.
    expect(b.hrSeries().length).toBeGreaterThan(10);
  });
});
