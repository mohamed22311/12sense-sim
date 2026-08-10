/* VENDORED — DO NOT EDIT.
 * Source: TwelveSense-TT-MobileApp/Thalamus/src/health/risk.ts @ 15b11d4
 * Sync check: `npm run check:vendor`. Fix drift by re-copying, never by editing.
 */
/**
 * Pure rule-based risk engine v1 (docs/research/health-signals.md §4–5): each
 * rule scores the trailing vitals series against the centralized thresholds;
 * the overall band is the HIGHEST band any rule reaches and the reason names
 * the rule(s) that fired. No I/O, no React — callers feed it a RiskInputs and
 * read the assessment.
 *
 * Rules (§5 table):
 *  - exertion  — % of Tanaka HRmax, sustained; danger also holds when HR is
 *    not recovering during rest after a danger-level episode;
 *  - stress    — HR above the estimated resting baseline while inactive
 *    (steps ≈ 0) — the HRV replacement (§1: Samsung never syncs HRV);
 *  - spo2      — clinical SpO2 bands on a fresh reading;
 *  - restingHr — persistently high (>100) or unusually low (<50) HR while
 *    still → caution-only "check in" prompt (never a diagnosis, §3);
 *  - load      — cumulative minutes above 80% HRmax in the trailing hour;
 *  - data      — safe fallback (Constitution III): missing/stale vitals bias
 *    to caution, never "assumed fine". It is the only rule with
 *    `measured: false`, so it colors the UI but never drives alerts.
 *
 * Samsung syncs HR sparsely when idle and SpO2 only on-demand/during sleep
 * (§2), so all sustained/accumulator math requires sample coverage
 * (`series.maxSampleGapMs`) and degrades to NOT firing on sparse data while
 * the data rule keeps the overall band honest.
 */

import { RiskBand } from '@/api/types';

import { StepBucket, VitalReading, formatAge, readingAgeMs } from './vitals';

// ---------------------------------------------------------------------------
// Tunable configuration — every threshold, window, and cut-point lives here
// (§5 "tunable thresholds"). The risk.test.ts sanity guards enforce the
// invariants noted below.
// ---------------------------------------------------------------------------

export const RISK_CONFIG = {
  /** Tanaka 2001: HRmax = base − perYear × age; defaultAge covers a null DOB */
  hrMax: { base: 208, perYear: 0.7, defaultAge: 40 },
  /** a reading older than this is unreliable → data rule (biases to caution) */
  staleAfterMs: 15 * 60_000,
  /** a gap wider than this breaks a sustained run / caps accumulator coverage */
  series: { maxSampleGapMs: 5 * 60_000 },
  /** %HRmax: ≥cautionPct caution, >dangerPct danger — after sustainedMs */
  exertion: {
    cautionPct: 0.7,
    dangerPct: 0.85,
    sustainedMs: 3 * 60_000,
    /** "not recovering during rest": a danger episode ended ≥restMs ago
     * (within lookbackMs), steps ≈ 0 since, and HR still ≥ belowPct */
    recovery: { belowPct: 0.7, restMs: 5 * 60_000, lookbackMs: 15 * 60_000 },
  },
  /** HR − resting baseline while inactive: ≥caution caution, >danger danger */
  stress: { cautionBpm: 20, dangerBpm: 40, sustainedMs: 3 * 60_000 },
  /** the "steps ≈ 0" gate: at most maxSteps across the trailing window */
  inactivity: { windowMs: 5 * 60_000, maxSteps: 10 },
  /** %: ≥caution normal, ≥danger caution, else danger (clinical framing) */
  spo2: { caution: 95, danger: 90 },
  /** bpm while still, sustained: >high or <low → caution-only check-in */
  restingHr: { high: 100, low: 50, sustainedMs: 10 * 60_000 },
  /** minutes at/above pctHrMax·HRmax in the trailing window */
  cumulativeLoad: { pctHrMax: 0.8, windowMs: 60 * 60_000, cautionMin: 10, dangerMin: 25 },
  /** resting-HR baseline estimation (baseline.ts + restingBaseline.ts) */
  baseline: { days: 7, percentile: 0.05, minSamples: 20, recomputeAfterMs: 24 * 3_600_000 },
  /** band ↔ score slices: normal [0,cautionAt), caution [cautionAt,dangerAt), danger [dangerAt,1] */
  score: { cautionAt: 0.4, dangerAt: 0.8 },
} as const;

export type RuleKind = 'exertion' | 'stress' | 'spo2' | 'restingHr' | 'load' | 'data';

export type RuleAssessment = {
  rule: RuleKind;
  band: RiskBand;
  /** 0..1, always inside the band's score slice */
  score: number;
  /** the measurement the rule judged (%HRmax, Δbpm, %, bpm, minutes) — null for `data` */
  value: number | null;
  /** how long the condition has held, when the rule fired on a sustained run */
  sustainedS: number | null;
  /** action-oriented phrase; null when the rule is normal */
  reason: string | null;
  /** false only for the data fallback — the alert latch's evidence gate */
  measured: boolean;
};

export type RiskInputs = {
  /** trailing HR samples (≥ cumulativeLoad.windowMs), ascending */
  hrSeries: VitalReading[];
  /** latest SpO2 spot reading (24 h lookback) */
  spo2: VitalReading | null;
  /** trailing step buckets covering the same window (empty = not moving, IF readable) */
  steps: StepBucket[];
  /** the Steps grant was readable — gates the steps ≈ 0 rules */
  stepsReadable: boolean;
  /** estimated resting HR (restingBaseline.ts); null until computable */
  restingHr: number | null;
  /** worker age from date_of_birth; null → RISK_CONFIG.hrMax.defaultAge */
  age: number | null;
  nowIso: string;
};

export type RiskAssessment = {
  band: RiskBand;
  /** worst band among measured rules — what the alert latch may act on */
  measuredBand: RiskBand;
  /** 0..1, max across rule scores — the api-contract risk_score */
  score: number;
  /** reasons of every top-band rule, priority-ordered, ' · '-joined */
  reason: string;
  rules: RuleAssessment[];
  /** the api-contract vitals_snapshot fields, null where unknown */
  snapshot: {
    hr: number | null;
    spo2: number | null;
    pctHrMax: number | null;
    restingHr: number | null;
    stepsLastMin: number | null;
    sustainedS: number | null;
  };
};

const BAND_RANK: Record<RiskBand, number> = { normal: 0, caution: 1, danger: 2 };

const maxBand = (bands: RiskBand[]): RiskBand =>
  bands.reduce((worst, b) => (BAND_RANK[b] > BAND_RANK[worst] ? b : worst), 'normal');

// ---------------------------------------------------------------------------
// Personal context
// ---------------------------------------------------------------------------

/** Whole years between a DOB and now; null for missing/bad/implausible dates. */
export function ageFromDob(dobIso: string | null, nowIso: string): number | null {
  if (!dobIso) return null;
  const dob = new Date(dobIso);
  const now = new Date(nowIso);
  if (Number.isNaN(dob.getTime()) || Number.isNaN(now.getTime())) return null;
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 && age <= 130 ? age : null;
}

/** Tanaka 2001 personalized max HR; a null age uses the config default. */
export function hrMaxForAge(age: number | null): number {
  const { base, perYear, defaultAge } = RISK_CONFIG.hrMax;
  return base - perYear * (age ?? defaultAge);
}

// ---------------------------------------------------------------------------
// Series math (exported for tests and for baseline.ts)
// ---------------------------------------------------------------------------

type Sample = { t: number; value: number };

function cleanSeries(series: VitalReading[]): Sample[] {
  const out: Sample[] = [];
  for (const s of series) {
    const t = new Date(s.observedAt).getTime();
    if (Number.isNaN(t) || !Number.isFinite(s.value)) continue;
    out.push({ t, value: s.value });
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * How long `predicate` has held, contiguously, up to the newest sample:
 * newest sample must be fresh and satisfy it; walking back, the run breaks at
 * the first non-qualifying sample or a gap wider than maxSampleGapMs. A
 * single qualifying sample has held for 0 ms — sparse data never "sustains".
 */
export function sustainedMsFor(
  series: VitalReading[],
  predicate: (value: number) => boolean,
  nowIso: string,
): number {
  const samples = cleanSeries(series);
  if (!samples.length) return 0;
  const now = new Date(nowIso).getTime();
  const newest = samples[samples.length - 1];
  if (Number.isNaN(now) || now - newest.t > RISK_CONFIG.staleAfterMs) return 0;
  if (!predicate(newest.value)) return 0;
  let start = newest.t;
  for (let i = samples.length - 2; i >= 0; i--) {
    const s = samples[i];
    if (!predicate(s.value) || start - s.t > RISK_CONFIG.series.maxSampleGapMs) break;
    start = s.t;
  }
  return newest.t - start;
}

/**
 * TRIMP-style accumulator: minutes at/above `threshold` inside the trailing
 * window. Each qualifying sample covers until the next sample (or now),
 * capped at maxSampleGapMs so sparse data can't inflate the load.
 */
export function minutesAbove(
  series: VitalReading[],
  threshold: number,
  windowMs: number,
  nowIso: string,
): number {
  const samples = cleanSeries(series);
  const now = new Date(nowIso).getTime();
  if (Number.isNaN(now)) return 0;
  const windowStart = now - windowMs;
  let msAbove = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.t >= now || s.value < threshold) continue;
    const next = i + 1 < samples.length ? samples[i + 1].t : now;
    const coverEnd = Math.min(next, now, s.t + RISK_CONFIG.series.maxSampleGapMs);
    const coverStart = Math.max(s.t, windowStart);
    if (coverEnd > coverStart) msAbove += coverEnd - coverStart;
  }
  return msAbove / 60_000;
}

/** Steps inside the trailing window ending at nowIso (buckets pro-rated by overlap). */
export function stepsInWindow(steps: StepBucket[], windowMs: number, nowIso: string): number {
  const now = new Date(nowIso).getTime();
  if (Number.isNaN(now)) return 0;
  const windowStart = now - windowMs;
  let count = 0;
  for (const b of steps) {
    const s = new Date(b.startTime).getTime();
    const e = new Date(b.endTime).getTime();
    if (Number.isNaN(s) || Number.isNaN(e) || !Number.isFinite(b.count) || b.count < 0) continue;
    const overlapStart = Math.max(s, windowStart);
    const overlapEnd = Math.min(e, now);
    if (overlapEnd < overlapStart) continue;
    count += e > s ? b.count * ((overlapEnd - overlapStart) / (e - s)) : b.count;
  }
  return Math.round(count);
}

/**
 * The "steps ≈ 0" gate for the stress/restingHr rules. Samsung writes step
 * buckets only while stepping, so an EMPTY window is the normal signature of
 * a resting worker — no bucket counts as 0 steps. The guard against
 * manufacturing "inactive" alerts is `stepsReadable`: with the Steps grant
 * denied the gate stays closed (we truly have no idea), and the gated rules
 * additionally require fresh HR, so a watch off the wrist never qualifies.
 */
export function isInactive(steps: StepBucket[], nowIso: string, stepsReadable: boolean): boolean {
  if (!stepsReadable) return false;
  return stepsInWindow(steps, RISK_CONFIG.inactivity.windowMs, nowIso) <= RISK_CONFIG.inactivity.maxSteps;
}

// ---------------------------------------------------------------------------
// Scoring — each rule maps its measurement into its band's slice of [0, 1],
// so max(score) is always consistent with max(band).
// ---------------------------------------------------------------------------

function bandScore(band: RiskBand, frac: number): number {
  const f = Math.min(1, Math.max(0, frac));
  const { cautionAt, dangerAt } = RISK_CONFIG.score;
  if (band === 'danger') return dangerAt + (1 - dangerAt) * f;
  if (band === 'caution') return cautionAt + (dangerAt - cautionAt) * f;
  return cautionAt * f;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const minsLabel = (msDuration: number) => Math.max(1, Math.round(msDuration / 60_000));

// ---------------------------------------------------------------------------
// Rules — each returns null when it has nothing fresh to judge (the data
// rule owns that story).
// ---------------------------------------------------------------------------

type SeriesContext = {
  hrSeries: VitalReading[];
  steps: StepBucket[];
  stepsReadable: boolean;
  /** newest HR sample, already known fresh */
  latest: Sample;
  hrMax: number;
  nowIso: string;
  now: number;
};

/** Most recent danger-level exertion episode that already ended, if any. */
function lastDangerEpisodeEnd(samples: Sample[], isDanger: (v: number) => boolean): number | null {
  const { maxSampleGapMs } = RISK_CONFIG.series;
  const { sustainedMs } = RISK_CONFIG.exertion;
  let episodeEnd: number | null = null;
  let runStart: number | null = null;
  let prev: number | null = null;
  for (const s of samples) {
    if (isDanger(s.value)) {
      if (runStart === null || (prev !== null && s.t - prev > maxSampleGapMs)) runStart = s.t;
      if (s.t - runStart >= sustainedMs) episodeEnd = s.t;
      prev = s.t;
    } else {
      runStart = null;
      prev = null;
    }
  }
  return episodeEnd;
}

function assessExertion(ctx: SeriesContext): RuleAssessment {
  const cfg = RISK_CONFIG.exertion;
  const pctOf = (v: number) => v / ctx.hrMax;
  const currentPct = pctOf(ctx.latest.value);
  const pctLabel = Math.round(currentPct * 100);

  const dangerMs = sustainedMsFor(ctx.hrSeries, (v) => pctOf(v) > cfg.dangerPct, ctx.nowIso);
  if (dangerMs >= cfg.sustainedMs) {
    return {
      rule: 'exertion',
      band: 'danger',
      score: bandScore('danger', (currentPct - cfg.dangerPct) / (1 - cfg.dangerPct)),
      value: round2(currentPct),
      sustainedS: Math.round(dangerMs / 1000),
      reason: `Heart rate ${pctLabel}% of max for ${minsLabel(dangerMs)} min — take a rest break`,
      measured: true,
    };
  }

  // Not recovering during rest: a danger episode ended, the worker has been
  // still since, and HR never dropped back under the recovery line.
  const samples = cleanSeries(ctx.hrSeries);
  const episodeEnd = lastDangerEpisodeEnd(samples, (v) => pctOf(v) > cfg.dangerPct);
  if (episodeEnd !== null) {
    const sinceEnd = ctx.now - episodeEnd;
    if (sinceEnd >= cfg.recovery.restMs && sinceEnd <= cfg.recovery.lookbackMs) {
      const after = samples.filter((s) => s.t > episodeEnd);
      const stillHigh = after.length > 0 && after.every((s) => pctOf(s.value) >= cfg.recovery.belowPct);
      const restSteps = stepsInWindow(ctx.steps, sinceEnd, ctx.nowIso);
      if (stillHigh && ctx.stepsReadable && restSteps <= RISK_CONFIG.inactivity.maxSteps) {
        return {
          rule: 'exertion',
          band: 'danger',
          score: bandScore('danger', (currentPct - cfg.dangerPct) / (1 - cfg.dangerPct)),
          value: round2(currentPct),
          sustainedS: Math.round(sinceEnd / 1000),
          reason: `Heart rate ${pctLabel}% of max and not dropping after ${minsLabel(sinceEnd)} min of rest — keep resting`,
          measured: true,
        };
      }
    }
  }

  const cautionMs = sustainedMsFor(ctx.hrSeries, (v) => pctOf(v) >= cfg.cautionPct, ctx.nowIso);
  if (cautionMs >= cfg.sustainedMs) {
    return {
      rule: 'exertion',
      band: 'caution',
      score: bandScore('caution', (currentPct - cfg.cautionPct) / (cfg.dangerPct - cfg.cautionPct)),
      value: round2(currentPct),
      sustainedS: Math.round(cautionMs / 1000),
      reason: `Heart rate ${pctLabel}% of max for ${minsLabel(cautionMs)} min — pace yourself`,
      measured: true,
    };
  }

  return {
    rule: 'exertion',
    band: 'normal',
    score: bandScore('normal', currentPct / cfg.cautionPct),
    value: round2(currentPct),
    sustainedS: null,
    reason: null,
    measured: true,
  };
}

function assessStress(ctx: SeriesContext, restingHr: number): RuleAssessment {
  const cfg = RISK_CONFIG.stress;
  const delta = Math.round(ctx.latest.value - restingHr);

  const dangerMs = sustainedMsFor(ctx.hrSeries, (v) => v - restingHr > cfg.dangerBpm, ctx.nowIso);
  if (dangerMs >= cfg.sustainedMs) {
    return {
      rule: 'stress',
      band: 'danger',
      score: bandScore('danger', (delta - cfg.dangerBpm) / (cfg.dangerBpm - cfg.cautionBpm)),
      value: delta,
      sustainedS: Math.round(dangerMs / 1000),
      reason: `Heart rate ${delta} bpm above your resting level while inactive — pause and check in`,
      measured: true,
    };
  }

  const cautionMs = sustainedMsFor(ctx.hrSeries, (v) => v - restingHr >= cfg.cautionBpm, ctx.nowIso);
  if (cautionMs >= cfg.sustainedMs) {
    return {
      rule: 'stress',
      band: 'caution',
      score: bandScore('caution', (delta - cfg.cautionBpm) / (cfg.dangerBpm - cfg.cautionBpm)),
      value: delta,
      sustainedS: Math.round(cautionMs / 1000),
      reason: `Heart rate ${delta} bpm above your resting level while inactive — take a moment to settle`,
      measured: true,
    };
  }

  return {
    rule: 'stress',
    band: 'normal',
    score: bandScore('normal', delta / cfg.cautionBpm),
    value: delta,
    sustainedS: null,
    reason: null,
    measured: true,
  };
}

function assessRestingHr(ctx: SeriesContext): RuleAssessment {
  const cfg = RISK_CONFIG.restingHr;
  const bpm = Math.round(ctx.latest.value);

  const highMs = sustainedMsFor(ctx.hrSeries, (v) => v > cfg.high, ctx.nowIso);
  if (highMs >= cfg.sustainedMs) {
    return {
      rule: 'restingHr',
      band: 'caution',
      score: bandScore('caution', 0.5),
      value: bpm,
      sustainedS: Math.round(highMs / 1000),
      reason: `Heart rate over ${cfg.high} for ${minsLabel(highMs)} min while resting — check in`,
      measured: true,
    };
  }

  const lowMs = sustainedMsFor(ctx.hrSeries, (v) => v < cfg.low, ctx.nowIso);
  if (lowMs >= cfg.sustainedMs) {
    return {
      rule: 'restingHr',
      band: 'caution',
      score: bandScore('caution', 0.5),
      value: bpm,
      sustainedS: Math.round(lowMs / 1000),
      reason: `Unusually low heart rate (${bpm} bpm) — please check in`,
      measured: true,
    };
  }

  return {
    rule: 'restingHr',
    band: 'normal',
    score: 0,
    value: bpm,
    sustainedS: null,
    reason: null,
    measured: true,
  };
}

function assessLoad(ctx: SeriesContext): RuleAssessment {
  const cfg = RISK_CONFIG.cumulativeLoad;
  const minutes = minutesAbove(ctx.hrSeries, ctx.hrMax * cfg.pctHrMax, cfg.windowMs, ctx.nowIso);
  const minLabel = Math.round(minutes);
  const pctLabel = Math.round(cfg.pctHrMax * 100);
  const windowLabel = Math.round(cfg.windowMs / 3_600_000) === 1 ? 'hour' : `${Math.round(cfg.windowMs / 60_000)} min`;

  if (minutes > cfg.dangerMin) {
    return {
      rule: 'load',
      band: 'danger',
      score: bandScore('danger', (minutes - cfg.dangerMin) / (cfg.windowMs / 60_000 - cfg.dangerMin)),
      value: minLabel,
      sustainedS: Math.round(minutes * 60),
      reason: `${minLabel} min above ${pctLabel}% of max heart rate in the last ${windowLabel} — take a longer break`,
      measured: true,
    };
  }
  if (minutes >= cfg.cautionMin) {
    return {
      rule: 'load',
      band: 'caution',
      score: bandScore('caution', (minutes - cfg.cautionMin) / (cfg.dangerMin - cfg.cautionMin)),
      value: minLabel,
      sustainedS: Math.round(minutes * 60),
      reason: `${minLabel} min above ${pctLabel}% of max heart rate in the last ${windowLabel} — plan a break soon`,
      measured: true,
    };
  }
  return {
    rule: 'load',
    band: 'normal',
    score: bandScore('normal', minutes / cfg.cautionMin),
    value: minLabel,
    sustainedS: null,
    reason: null,
    measured: true,
  };
}

function assessSpo2(pct: number): RuleAssessment {
  const cfg = RISK_CONFIG.spo2;
  const v = Math.round(pct);
  if (pct < cfg.danger) {
    return {
      rule: 'spo2',
      band: 'danger',
      score: bandScore('danger', (cfg.danger - pct) / 10),
      value: v,
      sustainedS: null,
      reason: `Blood-oxygen ${v}% — stop, move to fresh air, and seek help if it doesn't recover`,
      measured: true,
    };
  }
  if (pct < cfg.caution) {
    return {
      rule: 'spo2',
      band: 'caution',
      score: bandScore('caution', (cfg.caution - pct) / (cfg.caution - cfg.danger)),
      value: v,
      sustainedS: null,
      reason: `Blood-oxygen ${v}% — take a break and re-check`,
      measured: true,
    };
  }
  return {
    rule: 'spo2',
    band: 'normal',
    score: bandScore('normal', (100 - pct) / (100 - cfg.caution)),
    value: v,
    sustainedS: null,
    reason: null,
    measured: true,
  };
}

type FreshnessProblem = 'missing' | 'stale' | null;

function dataRule(
  hrProblem: FreshnessProblem,
  hrAgeMs: number | null,
  spo2Problem: FreshnessProblem,
  spo2AgeMs: number | null,
): RuleAssessment {
  let reason: string | null = null;
  if (hrProblem && spo2Problem) {
    reason = 'No recent vitals — check watch connection';
  } else if (hrProblem) {
    reason =
      hrProblem === 'stale'
        ? `Heart rate reading is stale (${formatAge(hrAgeMs)})`
        : 'No recent heart-rate reading';
  } else if (spo2Problem) {
    reason =
      spo2Problem === 'stale'
        ? `SpO2 reading is stale (${formatAge(spo2AgeMs)})`
        : 'No recent SpO2 reading';
  }
  return {
    rule: 'data',
    band: reason ? 'caution' : 'normal',
    // 0.25 into the caution slice = 0.5 with default cut-points — the same
    // safe-fallback score the engine has always reported for a silent watch
    score: reason ? bandScore('caution', 0.25) : 0,
    value: null,
    sustainedS: null,
    reason,
    measured: false,
  };
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/** Reason ordering within a band: the more specific/actionable signal leads. */
const REASON_PRIORITY: RuleKind[] = ['spo2', 'exertion', 'stress', 'load', 'restingHr', 'data'];

export function assessRisk(inputs: RiskInputs): RiskAssessment {
  const now = new Date(inputs.nowIso).getTime();
  const hrMax = hrMaxForAge(inputs.age);
  const samples = cleanSeries(inputs.hrSeries);

  const newest = samples.length ? samples[samples.length - 1] : null;
  const hrAgeMs = newest ? Math.max(0, now - newest.t) : null;
  const hrFresh = newest !== null && hrAgeMs !== null && hrAgeMs <= RISK_CONFIG.staleAfterMs;
  const hrProblem: FreshnessProblem = newest === null ? 'missing' : hrFresh ? null : 'stale';

  const spo2AgeMs = inputs.spo2 ? readingAgeMs(inputs.spo2, inputs.nowIso) : null;
  const spo2Fresh = spo2AgeMs !== null && spo2AgeMs <= RISK_CONFIG.staleAfterMs;
  const spo2Problem: FreshnessProblem = !inputs.spo2 ? 'missing' : spo2Fresh ? null : 'stale';

  const inactive = isInactive(inputs.steps, inputs.nowIso, inputs.stepsReadable);

  const rules: RuleAssessment[] = [];
  if (hrFresh && newest) {
    const ctx: SeriesContext = {
      hrSeries: inputs.hrSeries,
      steps: inputs.steps,
      stepsReadable: inputs.stepsReadable,
      latest: newest,
      hrMax,
      nowIso: inputs.nowIso,
      now,
    };
    rules.push(assessExertion(ctx));
    if (inactive && inputs.restingHr !== null) rules.push(assessStress(ctx, inputs.restingHr));
    if (inactive) rules.push(assessRestingHr(ctx));
    rules.push(assessLoad(ctx));
  }
  if (spo2Fresh && inputs.spo2) rules.push(assessSpo2(inputs.spo2.value));
  rules.push(dataRule(hrProblem, hrAgeMs, spo2Problem, spo2AgeMs));

  const band = maxBand(rules.map((r) => r.band));
  const measuredBand = maxBand(rules.filter((r) => r.measured).map((r) => r.band));
  const score = round2(Math.max(...rules.map((r) => r.score)));

  const firing = rules
    .filter((r) => r.band === band && r.reason !== null)
    .sort((a, b) => REASON_PRIORITY.indexOf(a.rule) - REASON_PRIORITY.indexOf(b.rule));
  const reason = firing.length
    ? firing.map((r) => r.reason as string).join(' · ')
    : 'Vitals in normal range';

  const stepsLastMin = inputs.stepsReadable
    ? stepsInWindow(inputs.steps, 60_000, inputs.nowIso)
    : null;

  return {
    band,
    measuredBand,
    score,
    reason,
    rules,
    snapshot: {
      hr: hrFresh && newest ? Math.round(newest.value) : null,
      spo2: spo2Fresh && inputs.spo2 ? Math.round(inputs.spo2.value) : null,
      pctHrMax: hrFresh && newest ? round2(newest.value / hrMax) : null,
      restingHr: inputs.restingHr,
      stepsLastMin,
      sustainedS: firing.length ? (firing[0].sustainedS ?? null) : null,
    },
  };
}
