/* VENDORED — DO NOT EDIT.
 * Source: TwelveSense-TT-MobileApp/Thalamus/src/health/alerting.ts @ 15b11d4
 * Sync check: `npm run check:vendor`. Fix drift by re-copying, never by editing.
 */
import { RiskBand } from '@/api/types';

import { POLL_INTERVAL_MS } from './poller';
import { RiskAssessment } from './risk';

/**
 * Debounce/hysteresis latch over per-poll risk assessments — the pure policy
 * (design doc §5, decided in S2-MB3) that decides when a band crossing becomes
 * an individual alert. Callers (HealthProvider) feed it one assessment per
 * successful poll and act on the returned `raise` / `recovered` flags; the
 * notification, POST, and history card are I/O layered on top.
 *
 * Policy:
 *  - a poll counts toward raising only on MEASURED evidence: the engine's
 *    `measuredBand` — the worst band among rules that judged fresh data. The
 *    missing/stale→caution safe fallback (the `data` rule) colors the Home
 *    card but never alerts (a watch off the wrist is not strain);
 *  - caution must hold `enterTicks.caution` consecutive measured polls before
 *    raising; danger raises after `enterTicks.danger` (immediately) — the
 *    severe case is never delayed;
 *  - once latched, nothing re-raises except a caution→danger escalation
 *    (exactly once); improvement back to caution stays silent — max two
 *    alerts per episode;
 *  - recovery = `recoveryTicks` consecutive NORMAL polls (fallback caution
 *    does not count) resets the latch, re-arming it for the next episode.
 */

// ---------------------------------------------------------------------------
// Tunable configuration — the alerting.test.ts sanity guards enforce the
// invariants noted below.
// ---------------------------------------------------------------------------

/**
 * Named separately so `latchMaxAgeMs` below can be *derived* from it rather
 * than restated — the two are one decision, and a drift between them would
 * silently change how long a restored latch suppresses a raise.
 */
const RECOVERY_TICKS = 3;

export const ALERT_CONFIG = {
  /** consecutive measured polls before a crossing raises; danger <= caution */
  enterTicks: { caution: 2, danger: 1 },
  /** consecutive normal polls that reset the latch (~minutes at 60s cadence) */
  recoveryTicks: RECOVERY_TICKS,
  /**
   * How long a persisted latch may be trusted across a blind gap (S3-MB6).
   *
   * Not a taste call. At reopen, "still the same episode" and "recovered and
   * relapsed while I was not looking" read identically off the vitals, and the
   * only thing the phone can reason about is whether a recovery could have
   * fitted in the gap it could not see. Recovery is `recoveryTicks` consecutive
   * normal polls, so that is exactly the longest gap the latch can be trusted
   * across — past it we re-arm, because a missed alert is the worse failure
   * (Constitution V).
   */
  latchMaxAgeMs: RECOVERY_TICKS * POLL_INTERVAL_MS,
} as const;

export type AlertLatchState = {
  /** band the worker has already been alerted at this episode */
  latched: 'none' | 'caution' | 'danger';
  /** consecutive polls with measured evidence at caution or worse */
  cautionStreak: number;
  /** consecutive polls with measured evidence at danger */
  dangerStreak: number;
  /** consecutive polls with the overall band at normal */
  normalStreak: number;
};

export const INITIAL_LATCH: AlertLatchState = {
  latched: 'none',
  cautionStreak: 0,
  dangerStreak: 0,
  normalStreak: 0,
};

export type AlertTick = {
  state: AlertLatchState;
  /** band to alert at this poll, or null (raise exactly once per crossing) */
  raise: 'caution' | 'danger' | null;
  /** true exactly on the poll that completes recovery (clear notification) */
  recovered: boolean;
};

const BAND_RANK: Record<RiskBand, number> = { normal: 0, caution: 1, danger: 2 };

/** Advance the latch by one poll's assessment. Pure — never mutates `state`. */
export function nextAlertState(state: AlertLatchState, assessment: RiskAssessment): AlertTick {
  // the evidence gate: the engine's worst band over rules that judged fresh
  // data — the data-fallback caution reads as 'normal' (= no evidence) here
  const measured = assessment.measuredBand;

  const cautionStreak = BAND_RANK[measured] >= BAND_RANK.caution ? state.cautionStreak + 1 : 0;
  const dangerStreak = measured === 'danger' ? state.dangerStreak + 1 : 0;
  const normalStreak = assessment.band === 'normal' ? state.normalStreak + 1 : 0;

  // Recovery and raising are mutually exclusive on any tick (a raise needs
  // measured caution+, recovery needs a normal band).
  if (state.latched !== 'none' && normalStreak >= ALERT_CONFIG.recoveryTicks) {
    return { state: INITIAL_LATCH, raise: null, recovered: true };
  }

  let latched = state.latched;
  let raise: AlertTick['raise'] = null;
  if (latched !== 'danger' && dangerStreak >= ALERT_CONFIG.enterTicks.danger) {
    latched = 'danger'; // first crossing or a caution→danger escalation
    raise = 'danger';
  } else if (latched === 'none' && cautionStreak >= ALERT_CONFIG.enterTicks.caution) {
    latched = 'caution';
    raise = 'caution';
  }

  return { state: { latched, cautionStreak, dangerStreak, normalStreak }, raise, recovered: false };
}

// ---------------------------------------------------------------------------
// Persistence (S3-MB6) — the episode outlives the process
// ---------------------------------------------------------------------------

/**
 * The latch used to be a `useRef` and nothing more, so closing the app re-armed
 * it and the next poll raised the SAME episode again: a second alarm, and a
 * second history card, for a worker who had already pressed "Got it".
 * (Acknowledging deliberately never touches the latch — it is a fact about the
 * worker, not a claim about their vitals — so the latch was the only thing
 * preventing a repeat, and it was the one thing that did not survive.)
 *
 * These two functions are the pure half of the fix; HealthProvider owns the
 * SecureStore read/write. The restore has to fail in the direction that
 * ALERTS, because a latch restored without limit would suppress a genuinely
 * new danger indefinitely — hence the age bound, the future-stamp check, and
 * "anything I cannot read means re-arm".
 */

/** What the persisted record carries: state, the episode's raises, and when. */
type LatchRecord = {
  s: AlertLatchState;
  /** the raise instants of the episode currently latched, ISO */
  r: string[];
  /** when this was written, ISO — the age bound is measured from here */
  at: string;
};

export type RestoredLatch = { state: AlertLatchState; raises: string[] };

const ARMED: RestoredLatch = { state: INITIAL_LATCH, raises: [] };

/** Serialize the latch and its episode. Short keys — this is a hot, small value. */
export function packLatch(state: AlertLatchState, raises: string[], atIso: string): string {
  const record: LatchRecord = { s: state, r: raises, at: atIso };
  return JSON.stringify(record);
}

/**
 * Read a persisted latch back, or re-arm.
 *
 * Re-arms — `{ INITIAL_LATCH, [] }`, i.e. the next crossing raises normally —
 * when the record is absent, unreadable, malformed, **stamped in the future**
 * (a clock moved, not a latch we can date), or older than
 * `ALERT_CONFIG.latchMaxAgeMs`.
 *
 * `answered` is the set of raise instants the worker already resolved, so the
 * in-memory Map that enforces "an alert ends acknowledged OR auto-recovered,
 * never both" (`alertResolution.ts`) — which dies with the process — is
 * re-established here. Note an answered raise drops out of `raises` but does
 * NOT re-arm the latch: pressing "Got it" ends the alert, not the episode.
 */
export function restoreLatch(
  raw: string | null | undefined,
  nowIso: string,
  answered?: ReadonlySet<string>,
): RestoredLatch {
  if (!raw) return ARMED;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return ARMED;
  }
  if (!isLatchRecord(parsed)) return ARMED;

  const writtenAt = Date.parse(parsed.at);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(writtenAt) || !Number.isFinite(now)) return ARMED;

  const age = now - writtenAt;
  // a negative age is a clock that moved, which tells us nothing about the gap
  if (age < 0 || age >= ALERT_CONFIG.latchMaxAgeMs) return ARMED;

  return {
    state: parsed.s,
    raises: answered ? parsed.r.filter((at) => !answered.has(at)) : parsed.r,
  };
}

const LATCHED: AlertLatchState['latched'][] = ['none', 'caution', 'danger'];

/** A streak is a count of polls: a finite, non-negative integer or nothing. */
const isStreak = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0;

function isLatchRecord(value: unknown): value is LatchRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as Partial<LatchRecord>;
  if (typeof r.at !== 'string' || r.at.length === 0) return false;
  if (!Array.isArray(r.r) || r.r.some((at) => typeof at !== 'string')) return false;

  const s = r.s;
  if (s === null || typeof s !== 'object') return false;
  return (
    LATCHED.includes((s as AlertLatchState).latched) &&
    isStreak((s as AlertLatchState).cautionStreak) &&
    isStreak((s as AlertLatchState).dangerStreak) &&
    isStreak((s as AlertLatchState).normalStreak)
  );
}
