import { VitalReading } from '../health/vitals';
import {
  RISK_CONFIG,
  RiskInputs,
  ageFromDob,
  assessRisk,
  hrMaxForAge,
  isInactive,
  minutesAbove,
  stepsInWindow,
  sustainedMsFor,
} from '../health/risk';

/**
 * Risk engine v1 (health-signals.md §4–5): per-rule band boundaries, the
 * sustained-window and accumulator math, the steps ≈ 0 gating, the recovery
 * heuristic, and the safe fallback. The bias is still the point: missing,
 * stale, or sparse data never scores as healthy — and never fabricates an
 * alert either (measured evidence only).
 *
 * All tests run with age null → Tanaka default age 40 → HRmax 180, so the
 * zone edges are round numbers: 70% = 126 bpm, 80% = 144 bpm, 85% = 153 bpm.
 */

const now = '2026-07-16T12:00:00Z';
const nowMs = new Date(now).getTime();
const atMinsAgo = (mins: number) => new Date(nowMs - mins * 60_000).toISOString();

const reading = (value: number, minsAgo = 1): VitalReading => ({
  value,
  observedAt: atMinsAgo(minsAgo),
});

/** One HR sample per minute at `bpm`, from `fromMinsAgo` down to `toMinsAgo`. */
const hrRun = (bpm: number, fromMinsAgo: number, toMinsAgo = 0): VitalReading[] => {
  const out: VitalReading[] = [];
  for (let m = fromMinsAgo; m >= toMinsAgo; m--) out.push(reading(bpm, m));
  return out;
};

const bucket = (count: number, fromMinsAgo: number, toMinsAgo: number) => ({
  startTime: atMinsAgo(fromMinsAgo),
  endTime: atMinsAgo(toMinsAgo),
  count,
});

// Samsung writes step buckets only while stepping — a readable grant with no
// buckets IS the still state. The default fixture is therefore "still".
const STILL: never[] = [];
const ACTIVE = [bucket(400, 10, 0)];

const inputs = (over: Partial<RiskInputs>): RiskInputs => ({
  hrSeries: [],
  spo2: null,
  steps: [],
  stepsReadable: true,
  restingHr: null,
  age: null,
  nowIso: now,
  ...over,
});

const ruleOf = (risk: ReturnType<typeof assessRisk>, rule: string) =>
  risk.rules.find((r) => r.rule === rule);

// ---------------------------------------------------------------------------
// Personal context
// ---------------------------------------------------------------------------

describe('ageFromDob', () => {
  it('counts whole years, respecting the birthday', () => {
    expect(ageFromDob('1990-05-12', now)).toBe(36);
    expect(ageFromDob('1990-08-12', now)).toBe(35); // birthday later this year
  });

  it('is null for missing, malformed, or implausible dates', () => {
    expect(ageFromDob(null, now)).toBeNull();
    expect(ageFromDob('bogus', now)).toBeNull();
    expect(ageFromDob('2030-01-01', now)).toBeNull(); // future DOB
  });
});

describe('hrMaxForAge (Tanaka)', () => {
  it('208 − 0.7 × age', () => {
    expect(hrMaxForAge(30)).toBe(187);
    expect(hrMaxForAge(40)).toBe(180);
  });

  it('a null age falls back to the config default', () => {
    expect(hrMaxForAge(null)).toBe(hrMaxForAge(RISK_CONFIG.hrMax.defaultAge));
  });
});

// ---------------------------------------------------------------------------
// Series math
// ---------------------------------------------------------------------------

describe('sustainedMsFor', () => {
  const over125 = (v: number) => v > 125;

  it('measures the span of a contiguous qualifying run ending now', () => {
    expect(sustainedMsFor(hrRun(130, 5), over125, now)).toBe(5 * 60_000);
  });

  it('a single qualifying sample has held for 0 ms — sparse data never sustains', () => {
    expect(sustainedMsFor([reading(130, 1)], over125, now)).toBe(0);
  });

  it('a gap wider than maxSampleGapMs breaks the run', () => {
    const series = [reading(130, 12), reading(130, 1)]; // 11-min gap
    expect(sustainedMsFor(series, over125, now)).toBe(0);
  });

  it('returns 0 when the newest sample is stale or does not qualify', () => {
    expect(sustainedMsFor(hrRun(130, 25, 20), over125, now)).toBe(0); // newest 20 min old
    expect(sustainedMsFor([...hrRun(130, 5, 1), reading(90, 0)], over125, now)).toBe(0);
  });

  it('the run stops at the first non-qualifying sample', () => {
    const series = [...hrRun(90, 10, 6), ...hrRun(130, 5, 0)];
    expect(sustainedMsFor(series, over125, now)).toBe(5 * 60_000);
  });
});

describe('minutesAbove (cumulative-load accumulator)', () => {
  it('sums per-sample coverage until the next sample', () => {
    // 31 samples, 30 one-minute intervals all above threshold
    expect(minutesAbove(hrRun(150, 30), 144, 60 * 60_000, now)).toBe(30);
  });

  it('caps coverage at maxSampleGapMs so sparse data cannot inflate the load', () => {
    const series = [reading(150, 30), reading(150, 10)];
    // each sample covers at most 5 min (second one runs 10 min→now, capped)
    expect(minutesAbove(series, 144, 60 * 60_000, now)).toBe(10);
  });

  it('clips coverage to the window and ignores samples below the threshold', () => {
    const series = [...hrRun(150, 90, 55), ...hrRun(100, 54, 0)];
    // only the 60..55 min-ago slice of the high run is inside the window
    expect(minutesAbove(series, 144, 60 * 60_000, now)).toBe(6);
  });
});

describe('stepsInWindow / isInactive', () => {
  it('pro-rates a bucket by its overlap with the window', () => {
    expect(stepsInWindow([bucket(100, 10, 0)], 5 * 60_000, now)).toBe(50);
  });

  it('buckets outside the window contribute nothing', () => {
    expect(stepsInWindow([bucket(100, 60, 30)], 5 * 60_000, now)).toBe(0);
  });

  it('no buckets while the grant is readable = not moving (Samsung logs no bucket at rest)', () => {
    expect(isInactive([], now, true)).toBe(true);
    expect(isInactive([bucket(100, 60, 30)], now, true)).toBe(true); // old walk, still now
  });

  it('a denied Steps grant keeps the gate closed — no idea is not "still"', () => {
    expect(isInactive([], now, false)).toBe(false);
  });

  it('real walking keeps the gate open to "active"', () => {
    expect(isInactive(ACTIVE, now, true)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rule: exertion (% HRmax)
// ---------------------------------------------------------------------------

describe('exertion — %HRmax sustained', () => {
  const spo2 = reading(98);

  it('healthy vitals → normal with the all-clear phrase', () => {
    const risk = assessRisk(inputs({ hrSeries: hrRun(72, 6), spo2, steps: STILL }));
    expect(risk.band).toBe('normal');
    expect(risk.reason).toBe('Vitals in normal range');
  });

  it('72% of max sustained 5 min → caution, reason names the rule', () => {
    const risk = assessRisk(inputs({ hrSeries: hrRun(130, 5), spo2 }));
    expect(risk.band).toBe('caution');
    expect(risk.reason).toBe('Heart rate 72% of max for 5 min — pace yourself');
  });

  it('86% of max sustained 4 min → danger', () => {
    const risk = assessRisk(inputs({ hrSeries: hrRun(155, 4), spo2 }));
    expect(risk.band).toBe('danger');
    expect(risk.reason).toBe('Heart rate 86% of max for 4 min — take a rest break');
    expect(risk.snapshot.sustainedS).toBe(4 * 60);
  });

  it.each([
    [125, 'normal'], // 69.4%
    [126, 'caution'], // exactly 70%
    [153, 'caution'], // exactly 85% — danger needs to exceed it
    [154, 'danger'], // 85.6%
  ] as const)('%i bpm sustained → %s (band edges at 70/85%)', (bpm, band) => {
    const risk = assessRisk(inputs({ hrSeries: hrRun(bpm, 5), spo2 }));
    expect(ruleOf(risk, 'exertion')?.band).toBe(band);
  });

  it('a danger-zone burst shorter than the sustained window does not fire', () => {
    const risk = assessRisk(inputs({ hrSeries: [...hrRun(72, 10, 3), ...hrRun(155, 2)], spo2 }));
    expect(ruleOf(risk, 'exertion')?.band).toBe('normal');
  });
});

describe('exertion — not recovering during rest', () => {
  const spo2 = reading(98);
  // danger-level episode 20..8 min ago, then resting at 130 bpm (72% ≥ 70%)
  const parked = [...hrRun(160, 20, 8), ...hrRun(130, 7)];

  it('HR parked above the recovery line after a danger episode holds danger', () => {
    const risk = assessRisk(inputs({ hrSeries: parked, spo2, steps: STILL }));
    expect(risk.band).toBe('danger');
    expect(risk.reason).toContain('not dropping after 8 min of rest — keep resting');
  });

  it('dropping below the recovery line releases it', () => {
    const recovered = [...hrRun(160, 20, 8), ...hrRun(110, 7)]; // 61% < 70%
    const risk = assessRisk(inputs({ hrSeries: recovered, spo2, steps: STILL }));
    expect(risk.band).not.toBe('danger');
    expect(ruleOf(risk, 'exertion')?.band).toBe('normal');
  });

  it('walking (or an unreadable Steps grant) does not count as rest', () => {
    const active = assessRisk(inputs({ hrSeries: parked, spo2, steps: ACTIVE }));
    expect(ruleOf(active, 'exertion')?.reason ?? '').not.toContain('not dropping');
    const noGrant = assessRisk(inputs({ hrSeries: parked, spo2, stepsReadable: false }));
    expect(ruleOf(noGrant, 'exertion')?.reason ?? '').not.toContain('not dropping');
  });
});

// ---------------------------------------------------------------------------
// Rule: stress (HR − resting baseline, gated on steps ≈ 0)
// ---------------------------------------------------------------------------

describe('stress — HR above resting while inactive', () => {
  const spo2 = reading(98);

  it('+48 bpm sustained while still → danger', () => {
    const risk = assessRisk(
      inputs({ hrSeries: hrRun(110, 5), spo2, steps: STILL, restingHr: 62 }),
    );
    expect(risk.band).toBe('danger');
    expect(risk.reason).toBe(
      'Heart rate 48 bpm above your resting level while inactive — pause and check in',
    );
  });

  it('+26 bpm sustained while still → caution', () => {
    const risk = assessRisk(
      inputs({ hrSeries: hrRun(88, 5), spo2, steps: STILL, restingHr: 62 }),
    );
    expect(risk.band).toBe('caution');
    expect(risk.reason).toBe(
      'Heart rate 26 bpm above your resting level while inactive — take a moment to settle',
    );
  });

  it.each([
    [79, 'normal'], // +19
    [80, 'caution'], // exactly +20
    [100, 'caution'], // exactly +40 — danger needs to exceed it
    [101, 'danger'], // +41
  ] as const)('resting 60 + HR %i sustained → %s (edges at +20/+40)', (bpm, band) => {
    const risk = assessRisk(
      inputs({ hrSeries: hrRun(bpm, 5), spo2, steps: STILL, restingHr: 60 }),
    );
    expect(ruleOf(risk, 'stress')?.band).toBe(band);
  });

  it('physical work explains the elevation — the gate closes while active', () => {
    const risk = assessRisk(
      inputs({ hrSeries: hrRun(110, 5), spo2, steps: ACTIVE, restingHr: 62 }),
    );
    expect(ruleOf(risk, 'stress')).toBeUndefined();
    expect(risk.band).toBe('normal');
  });

  it('empty step data while readable IS stillness — the rule still judges', () => {
    // Samsung logs no bucket at rest; requiring a bucket would blind the rule
    // for exactly the workers it watches.
    const risk = assessRisk(inputs({ hrSeries: hrRun(110, 5), spo2, steps: [], restingHr: 62 }));
    expect(ruleOf(risk, 'stress')?.band).toBe('danger');
  });

  it('a denied Steps grant keeps the gate closed (never alerts on assumption)', () => {
    const risk = assessRisk(
      inputs({ hrSeries: hrRun(110, 5), spo2, stepsReadable: false, restingHr: 62 }),
    );
    expect(ruleOf(risk, 'stress')).toBeUndefined();
  });

  it('no baseline yet — the rule waits for one instead of guessing', () => {
    const risk = assessRisk(inputs({ hrSeries: hrRun(110, 5), spo2, steps: STILL }));
    expect(ruleOf(risk, 'stress')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Rule: SpO2
// ---------------------------------------------------------------------------

describe('spo2 bands', () => {
  const hrSeries = hrRun(72, 6);

  it.each([
    [100, 'normal'],
    [95, 'normal'],
    [94, 'caution'],
    [90, 'caution'],
    [89, 'danger'],
  ] as const)('%i%% → %s', (pct, band) => {
    const risk = assessRisk(inputs({ hrSeries, spo2: reading(pct) }));
    expect(ruleOf(risk, 'spo2')?.band).toBe(band);
  });

  it('danger carries the stop-and-seek-help phrase', () => {
    const risk = assessRisk(inputs({ hrSeries, spo2: reading(89) }));
    expect(risk.reason).toBe(
      "Blood-oxygen 89% — stop, move to fresh air, and seek help if it doesn't recover",
    );
  });

  it('caution suggests a re-check', () => {
    const risk = assessRisk(inputs({ hrSeries, spo2: reading(93.4) }));
    expect(risk.reason).toBe('Blood-oxygen 93% — take a break and re-check');
  });
});

// ---------------------------------------------------------------------------
// Rule: resting HR (caution-only check-in)
// ---------------------------------------------------------------------------

describe('restingHr — persistent outliers while still', () => {
  const spo2 = reading(98);

  it('HR >100 for 12 min while still → caution check-in (never danger)', () => {
    const risk = assessRisk(inputs({ hrSeries: hrRun(105, 12), spo2, steps: STILL }));
    expect(risk.band).toBe('caution');
    expect(risk.reason).toBe('Heart rate over 100 for 12 min while resting — check in');
  });

  it('unusually low HR for 12 min while still → caution check-in', () => {
    const risk = assessRisk(inputs({ hrSeries: hrRun(45, 12), spo2, steps: STILL }));
    expect(risk.band).toBe('caution');
    expect(risk.reason).toBe('Unusually low heart rate (45 bpm) — please check in');
  });

  it('needs the full sustained window', () => {
    const risk = assessRisk(inputs({ hrSeries: hrRun(105, 8), spo2, steps: STILL }));
    expect(ruleOf(risk, 'restingHr')?.band).toBe('normal');
  });

  it('does not judge a moving worker', () => {
    const risk = assessRisk(inputs({ hrSeries: hrRun(105, 12), spo2, steps: ACTIVE }));
    expect(ruleOf(risk, 'restingHr')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Rule: cumulative load
// ---------------------------------------------------------------------------

describe('cumulative load — minutes above 80% HRmax in the trailing hour', () => {
  const spo2 = reading(98);

  it('29 min above → danger', () => {
    // 150 bpm (83%) 40..12 min ago — high zone but never the 85% danger zone
    const series = [...hrRun(150, 40, 12), ...hrRun(100, 11)];
    const risk = assessRisk(inputs({ hrSeries: series, spo2 }));
    expect(risk.band).toBe('danger');
    expect(risk.reason).toBe(
      '29 min above 80% of max heart rate in the last hour — take a longer break',
    );
  });

  it('13 min above → caution', () => {
    const series = [...hrRun(150, 24, 12), ...hrRun(100, 11)];
    const risk = assessRisk(inputs({ hrSeries: series, spo2 }));
    expect(risk.band).toBe('caution');
    expect(risk.reason).toBe(
      '13 min above 80% of max heart rate in the last hour — plan a break soon',
    );
  });

  it('under the caution line → normal', () => {
    const series = [...hrRun(150, 8, 4), ...hrRun(100, 3)];
    const risk = assessRisk(inputs({ hrSeries: series, spo2 }));
    expect(ruleOf(risk, 'load')?.band).toBe('normal');
  });
});

// ---------------------------------------------------------------------------
// Safe fallback (bias toward caution) + combining
// ---------------------------------------------------------------------------

describe('data fallback — missing/stale vitals bias toward caution', () => {
  it('nothing at all → caution 0.5 with one actionable phrase, no measured evidence', () => {
    const risk = assessRisk(inputs({}));
    expect(risk.band).toBe('caution');
    expect(risk.measuredBand).toBe('normal');
    expect(risk.score).toBe(0.5);
    expect(risk.reason).toBe('No recent vitals — check watch connection');
  });

  it('fresh HR but no SpO2 → caution', () => {
    const risk = assessRisk(inputs({ hrSeries: hrRun(72, 6) }));
    expect(risk.band).toBe('caution');
    expect(risk.reason).toBe('No recent SpO2 reading');
  });

  it('stale HR names its age', () => {
    const risk = assessRisk(inputs({ hrSeries: hrRun(72, 30, 20), spo2: reading(98) }));
    expect(risk.band).toBe('caution');
    expect(risk.reason).toBe('Heart rate reading is stale (20 min ago)');
  });

  it('stale SpO2 names its age', () => {
    const risk = assessRisk(inputs({ hrSeries: hrRun(72, 6), spo2: reading(98, 45) }));
    expect(risk.reason).toBe('SpO2 reading is stale (45 min ago)');
  });

  it('a reading exactly at the stale limit still counts', () => {
    const limitMins = RISK_CONFIG.staleAfterMs / 60_000;
    const risk = assessRisk(
      inputs({ hrSeries: hrRun(72, 6), spo2: reading(98, limitMins) }),
    );
    expect(risk.band).toBe('normal');
  });

  it('missing data never masks a measured danger', () => {
    const risk = assessRisk(inputs({ spo2: reading(88) }));
    expect(risk.band).toBe('danger');
    expect(risk.measuredBand).toBe('danger');
    expect(risk.reason).toContain('Blood-oxygen 88%');
  });
});

describe('combining — highest band wins, reasons are priority-ordered', () => {
  it('two rules at the top band join their reasons, SpO2 first', () => {
    const risk = assessRisk(inputs({ hrSeries: hrRun(155, 4), spo2: reading(88) }));
    expect(risk.band).toBe('danger');
    expect(risk.reason).toBe(
      "Blood-oxygen 88% — stop, move to fresh air, and seek help if it doesn't recover · " +
        'Heart rate 86% of max for 4 min — take a rest break',
    );
  });

  it('a caution rule never outranks a danger rule in the reason', () => {
    // SpO2 caution + exertion danger → only the danger reason shows
    const risk = assessRisk(inputs({ hrSeries: hrRun(155, 4), spo2: reading(93) }));
    expect(risk.band).toBe('danger');
    expect(risk.reason).toBe('Heart rate 86% of max for 4 min — take a rest break');
  });
});

// ---------------------------------------------------------------------------
// Score + snapshot payload
// ---------------------------------------------------------------------------

describe('score — max across rules, always inside the band slice', () => {
  const { cautionAt, dangerAt } = RISK_CONFIG.score;

  it('normal vitals score below the caution cut', () => {
    const risk = assessRisk(inputs({ hrSeries: hrRun(72, 6), spo2: reading(98), steps: STILL }));
    expect(risk.band).toBe('normal');
    expect(risk.score).toBeGreaterThan(0);
    expect(risk.score).toBeLessThan(cautionAt);
  });

  it('a caution band scores inside the caution slice', () => {
    const risk = assessRisk(inputs({ hrSeries: hrRun(130, 5), spo2: reading(98) }));
    expect(risk.score).toBeGreaterThanOrEqual(cautionAt);
    expect(risk.score).toBeLessThanOrEqual(dangerAt);
  });

  it('a danger band scores in the danger slice', () => {
    const risk = assessRisk(inputs({ hrSeries: hrRun(155, 4), spo2: reading(88) }));
    expect(risk.score).toBeGreaterThanOrEqual(dangerAt);
    expect(risk.score).toBeLessThanOrEqual(1);
  });
});

describe('snapshot — the api-contract vitals_snapshot fields', () => {
  it('carries measured values, the baseline, and steps', () => {
    const risk = assessRisk(
      inputs({ hrSeries: hrRun(72, 6), spo2: reading(98), steps: STILL, restingHr: 62 }),
    );
    expect(risk.snapshot).toEqual({
      hr: 72,
      spo2: 98,
      pctHrMax: 0.4, // 72 / 180
      restingHr: 62,
      stepsLastMin: 0,
      sustainedS: null,
    });
  });

  it('unknown fields are null, never fabricated', () => {
    const risk = assessRisk(inputs({ stepsReadable: false }));
    expect(risk.snapshot).toEqual({
      hr: null,
      spo2: null,
      pctHrMax: null,
      restingHr: null,
      stepsLastMin: null,
      sustainedS: null,
    });
  });

  it('sustainedS reports how long the firing rule has held', () => {
    const risk = assessRisk(inputs({ hrSeries: hrRun(130, 5), spo2: reading(98) }));
    expect(risk.snapshot.sustainedS).toBe(5 * 60);
  });
});

// ---------------------------------------------------------------------------
// Config sanity (protects future tuning)
// ---------------------------------------------------------------------------

describe('RISK_CONFIG sanity', () => {
  it('exertion zones are ordered and the recovery line is not above danger', () => {
    const { cautionPct, dangerPct, recovery } = RISK_CONFIG.exertion;
    expect(cautionPct).toBeLessThan(dangerPct);
    expect(dangerPct).toBeLessThan(1);
    expect(recovery.belowPct).toBeLessThanOrEqual(dangerPct);
    expect(recovery.restMs).toBeLessThan(recovery.lookbackMs);
  });

  it('stress deltas are ordered', () => {
    expect(RISK_CONFIG.stress.cautionBpm).toBeLessThan(RISK_CONFIG.stress.dangerBpm);
  });

  it('SpO2 danger line sits below the caution line', () => {
    expect(RISK_CONFIG.spo2.danger).toBeLessThan(RISK_CONFIG.spo2.caution);
  });

  it('resting-HR lines bracket a normal zone', () => {
    expect(RISK_CONFIG.restingHr.low).toBeLessThan(RISK_CONFIG.restingHr.high);
  });

  it('cumulative-load cut-points are ordered and fit the window', () => {
    const { cautionMin, dangerMin, windowMs } = RISK_CONFIG.cumulativeLoad;
    expect(cautionMin).toBeLessThan(dangerMin);
    expect(dangerMin).toBeLessThan(windowMs / 60_000);
  });

  it('score slices are ordered and reachable', () => {
    expect(RISK_CONFIG.score.cautionAt).toBeLessThan(RISK_CONFIG.score.dangerAt);
    expect(RISK_CONFIG.score.dangerAt).toBeLessThanOrEqual(1);
  });

  it('baseline estimation parameters are plausible', () => {
    const { percentile, minSamples, days } = RISK_CONFIG.baseline;
    expect(percentile).toBeGreaterThan(0);
    expect(percentile).toBeLessThan(1);
    expect(minSamples).toBeGreaterThan(0);
    expect(days).toBeGreaterThanOrEqual(1);
  });
});
