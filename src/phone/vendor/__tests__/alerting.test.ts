import { POLL_INTERVAL_MS } from '../health/poller';
import { assessRisk, RiskAssessment, RiskInputs } from '../health/risk';
import { VitalReading } from '../health/vitals';
import {
  ALERT_CONFIG,
  AlertLatchState,
  AlertTick,
  INITIAL_LATCH,
  nextAlertState,
  packLatch,
  restoreLatch,
} from '../health/alerting';

/**
 * The debounce/hysteresis latch that turns per-poll risk assessments into
 * individual alerts (design doc §5, decided in S2-MB3). The invariants under
 * test: exactly one raise per crossing, Danger without delay, flapping never
 * double-raises, missing/stale-driven caution neither raises nor recovers,
 * and recovery re-arms the latch for the next episode.
 *
 * Assessments are produced by the real risk engine, not hand-built, so these
 * are integration cases over assessRisk → nextAlertState. Age null → Tanaka
 * default HRmax 180, so 130 bpm ≈ 72% (caution) and 160 bpm ≈ 89% (danger).
 */

const now = '2026-07-14T12:00:00Z';

const reading = (value: number, minsAgo = 1): VitalReading => ({
  value,
  observedAt: new Date(new Date(now).getTime() - minsAgo * 60_000).toISOString(),
});

/** one HR sample per minute at `bpm` over the trailing `mins` minutes */
const hrRun = (bpm: number, mins: number): VitalReading[] => {
  const out: VitalReading[] = [];
  for (let m = mins; m >= 0; m--) out.push(reading(bpm, m));
  return out;
};

const inputs = (hrSeries: VitalReading[], spo2: VitalReading | null): RiskInputs => ({
  hrSeries,
  spo2,
  steps: [],
  stepsReadable: false, // gate the steps ≈ 0 rules out — these ticks exercise exertion/SpO2
  restingHr: null,
  age: null,
  nowIso: now,
});

// Named poll ticks: what the risk engine sees at each 60s poll.
const TICK = {
  /** healthy measured vitals → normal */
  normal: () => assessRisk(inputs(hrRun(72, 6), reading(98))),
  /** measured 72% of HRmax sustained → caution on real evidence */
  caution: () => assessRisk(inputs(hrRun(130, 6), reading(98))),
  /** measured 89% of HRmax sustained → danger on real evidence */
  danger: () => assessRisk(inputs(hrRun(160, 6), reading(98))),
  /** measured SpO2 88% → danger on real evidence */
  dangerSpo2: () => assessRisk(inputs(hrRun(72, 6), reading(88))),
  /** nothing measured (watch off wrist) → caution purely by safe fallback */
  missing: () => assessRisk(inputs([], null)),
  /** stale HR + healthy SpO2 → caution purely by staleness fallback */
  stale: () => assessRisk(inputs(hrRun(72, 60).slice(0, 30), reading(98))),
} as const;

type TickName = keyof typeof TICK;

/** Fold a poll sequence through the latch; collect every tick's outcome. */
function run(names: TickName[], from: AlertLatchState = INITIAL_LATCH) {
  const ticks: AlertTick[] = [];
  let state = from;
  for (const name of names) {
    const tick = nextAlertState(state, TICK[name]());
    ticks.push(tick);
    state = tick.state;
  }
  return {
    state,
    ticks,
    raises: ticks.map((t) => t.raise).filter((r) => r !== null),
    recoveries: ticks.filter((t) => t.recovered).length,
  };
}

describe('ALERT_CONFIG sanity', () => {
  it('debounce and recovery windows are at least one poll', () => {
    expect(ALERT_CONFIG.enterTicks.caution).toBeGreaterThanOrEqual(1);
    expect(ALERT_CONFIG.enterTicks.danger).toBeGreaterThanOrEqual(1);
    expect(ALERT_CONFIG.recoveryTicks).toBeGreaterThanOrEqual(1);
  });

  it('danger is never slower to raise than caution', () => {
    expect(ALERT_CONFIG.enterTicks.danger).toBeLessThanOrEqual(ALERT_CONFIG.enterTicks.caution);
  });
});

describe('measuredBand — the measured-evidence gate', () => {
  it.each([
    ['normal', 'normal'],
    ['caution', 'caution'],
    ['danger', 'danger'],
    ['dangerSpo2', 'danger'],
    // safe-fallback caution carries no measured evidence
    ['missing', 'normal'],
    ['stale', 'normal'],
  ] as const)('%s tick → %s', (name, band) => {
    expect(TICK[name]().measuredBand).toBe(band);
  });
});

describe('caution entry debounce', () => {
  it('a single caution poll does not raise', () => {
    const { raises } = run(['caution']);
    expect(raises).toEqual([]);
  });

  it('the second consecutive caution poll raises exactly once', () => {
    const { ticks, raises, state } = run(['caution', 'caution', 'caution', 'caution']);
    expect(ticks[1].raise).toBe('caution');
    expect(raises).toEqual(['caution']);
    expect(state.latched).toBe('caution');
  });

  it('flapping across the caution boundary never raises', () => {
    const { raises } = run(['caution', 'normal', 'caution', 'normal', 'caution', 'normal']);
    expect(raises).toEqual([]);
  });
});

describe('danger entry', () => {
  it('raises on the first danger poll — no delay on the severe case', () => {
    const { ticks, state } = run(['danger']);
    expect(ticks[0].raise).toBe('danger');
    expect(state.latched).toBe('danger');
  });

  it('a catastrophic SpO2 alone raises danger immediately', () => {
    const { ticks } = run(['dangerSpo2']);
    expect(ticks[0].raise).toBe('danger');
  });

  it('danger flapping raises only once until full recovery', () => {
    const { raises } = run(['danger', 'normal', 'danger', 'normal', 'danger']);
    expect(raises).toEqual(['danger']);
  });
});

describe('safe-fallback caution never alerts (measured evidence only)', () => {
  it('missing vitals — watch off wrist — never raise, however long', () => {
    const { raises, state } = run(['missing', 'missing', 'missing', 'missing', 'missing']);
    expect(raises).toEqual([]);
    expect(state.latched).toBe('none');
  });

  it('stale-reading caution never raises', () => {
    const { raises } = run(['stale', 'stale', 'stale']);
    expect(raises).toEqual([]);
  });

  it('a fallback tick breaks a measured caution streak', () => {
    // caution, missing, caution — never two consecutive measured ticks
    const { raises } = run(['caution', 'missing', 'caution', 'missing']);
    expect(raises).toEqual([]);
  });
});

describe('escalation and improvement', () => {
  it('latched caution escalates to danger with exactly one more raise', () => {
    const { raises } = run(['caution', 'caution', 'danger', 'danger', 'danger']);
    expect(raises).toEqual(['caution', 'danger']);
  });

  it('improvement danger → caution stays silent until full recovery', () => {
    const { raises, state } = run(['danger', 'caution', 'caution', 'caution']);
    expect(raises).toEqual(['danger']);
    expect(state.latched).toBe('danger');
  });
});

describe('recovery hysteresis', () => {
  it('two normal polls are not enough; the third recovers and unlatches', () => {
    const { ticks, state } = run(['danger', 'normal', 'normal', 'normal']);
    expect(ticks[1].recovered).toBe(false);
    expect(ticks[2].recovered).toBe(false);
    expect(ticks[3].recovered).toBe(true);
    expect(state).toEqual(INITIAL_LATCH);
  });

  it('a measured caution blip restarts the recovery count', () => {
    const { recoveries, state } = run(['danger', 'normal', 'normal', 'caution', 'normal', 'normal']);
    expect(recoveries).toBe(0);
    expect(state.latched).toBe('danger');
  });

  it('fallback caution (missing vitals) does not count toward recovery', () => {
    const { recoveries, state } = run(['danger', 'missing', 'missing', 'missing', 'missing']);
    expect(recoveries).toBe(0);
    expect(state.latched).toBe('danger');
  });

  it('after recovery a fresh crossing raises again', () => {
    const { raises, recoveries } = run([
      'caution', 'caution',            // episode 1 — raise caution
      'normal', 'normal', 'normal',    // recover
      'caution', 'caution',            // episode 2 — raise again
    ]);
    expect(raises).toEqual(['caution', 'caution']);
    expect(recoveries).toBe(1);
  });

  it('normal polls while unlatched never report a recovery', () => {
    const { recoveries } = run(['normal', 'normal', 'normal', 'normal']);
    expect(recoveries).toBe(0);
  });
});

describe('state is plain data', () => {
  it('nextAlertState never mutates its input state', () => {
    const before: AlertLatchState = { ...INITIAL_LATCH };
    nextAlertState(INITIAL_LATCH, TICK.danger());
    expect(INITIAL_LATCH).toEqual(before);
  });

  it('ticks are deterministic for identical inputs', () => {
    const a = nextAlertState(INITIAL_LATCH, TICK.caution());
    const b = nextAlertState(INITIAL_LATCH, TICK.caution());
    expect(a).toEqual(b);
  });
});

describe('assessment plumbing for the raise payload', () => {
  it('the danger tick carries the score, reason, and snapshot the POST needs', () => {
    const assessment: RiskAssessment = TICK.danger();
    expect(assessment.band).toBe('danger');
    expect(assessment.score).toBeGreaterThanOrEqual(0.8);
    expect(assessment.reason).toContain('take a rest break');
    expect(assessment.snapshot.hr).toBe(160);
    expect(assessment.snapshot.pctHrMax).toBeCloseTo(0.89);
  });
});

describe('packLatch / restoreLatch — the episode outlives the process', () => {
  /**
   * The latch used to be a `useRef`, so closing the app re-armed it and the next
   * poll raised the SAME episode again: a second alarm, and a second history
   * card, for a worker who had already pressed "Got it". (Acknowledging
   * deliberately never touches the latch — it is a fact about the worker, not a
   * claim about their vitals — so the latch was the only thing preventing a
   * repeat, and it was the one thing that did not survive.)
   *
   * Restoring it has to fail in the direction that ALERTS, because a latch
   * restored without limit would suppress a genuinely new danger indefinitely.
   */
  const at = '2026-07-14T12:00:00Z';
  const latched: AlertLatchState = {
    latched: 'danger',
    cautionStreak: 4,
    dangerStreak: 2,
    normalStreak: 0,
  };
  const later = (ms: number) => new Date(new Date(at).getTime() + ms).toISOString();

  it('round-trips the latch and the episode raises', () => {
    const raw = packLatch(latched, [at], at);
    expect(restoreLatch(raw, later(60_000))).toEqual({ state: latched, raises: [at] });
  });

  it('holds inside the age bound, so reopening the app does not re-raise', () => {
    const raw = packLatch(latched, [at], at);
    const restored = restoreLatch(raw, later(ALERT_CONFIG.latchMaxAgeMs - 1_000));
    expect(restored.state.latched).toBe('danger');
    // and a latched episode raises nothing more, whatever the vitals say
    expect(nextAlertState(restored.state, TICK.danger()).raise).toBeNull();
  });

  it('re-arms past the age bound — a missed alert is the worse failure', () => {
    const raw = packLatch(latched, [at], at);
    const restored = restoreLatch(raw, later(ALERT_CONFIG.latchMaxAgeMs + 1_000));
    expect(restored).toEqual({ state: INITIAL_LATCH, raises: [] });
    expect(nextAlertState(restored.state, TICK.danger()).raise).toBe('danger');
  });

  it('bounds the gap by the recovery window — a longer one could have hidden a recovery', () => {
    // The bound is not a taste call: at reopen, "still the same episode" and
    // "recovered and relapsed while I was not looking" read identically off the
    // vitals, and the ONLY thing the phone can reason about is whether a
    // recovery could have fitted in the blind gap. Recovery is `recoveryTicks`
    // consecutive normal polls, so that is exactly the longest gap the latch can
    // be trusted across.
    expect(ALERT_CONFIG.latchMaxAgeMs).toBe(ALERT_CONFIG.recoveryTicks * POLL_INTERVAL_MS);
  });

  it('re-arms across a gap that a full recovery could have fitted inside', () => {
    // the reported case: vitals recovered and went back to danger while the app
    // was closed, and the phone stayed silent because it had assumed the episode
    // it could not see was still the one it remembered
    const blind = ALERT_CONFIG.recoveryTicks * POLL_INTERVAL_MS + 1;
    const restored = restoreLatch(packLatch(latched, [at], at), later(blind));
    expect(nextAlertState(restored.state, TICK.danger()).raise).toBe('danger');
  });

  it('keeps the latch across a gap too short to have hidden one', () => {
    const blind = (ALERT_CONFIG.recoveryTicks - 1) * POLL_INTERVAL_MS;
    const restored = restoreLatch(packLatch(latched, [at], at), later(blind));
    expect(nextAlertState(restored.state, TICK.danger()).raise).toBeNull();
  });

  it('re-arms on a record stamped in the future (a clock moved, not a latch)', () => {
    const raw = packLatch(latched, [at], later(10 * 60_000));
    expect(restoreLatch(raw, at)).toEqual({ state: INITIAL_LATCH, raises: [] });
  });

  it('drops raises the worker already answered, but keeps the latch', () => {
    // an alert ends acknowledged OR auto-recovered, never both — and the Map
    // that enforces that dies with the process, so it is re-established here
    const second = later(60_000);
    const raw = packLatch(latched, [at, second], second);
    const restored = restoreLatch(raw, later(120_000), new Set([at]));
    expect(restored.raises).toEqual([second]);
    expect(restored.state.latched).toBe('danger');
  });

  it('keeps the latch when every raise was answered', () => {
    const raw = packLatch(latched, [at], at);
    const restored = restoreLatch(raw, later(60_000), new Set([at]));
    expect(restored.raises).toEqual([]);
    expect(restored.state.latched).toBe('danger');
  });

  it('re-arms on nothing stored, unreadable JSON, or a malformed record', () => {
    const armed = { state: INITIAL_LATCH, raises: [] };
    expect(restoreLatch(null, at)).toEqual(armed);
    expect(restoreLatch(undefined, at)).toEqual(armed);
    expect(restoreLatch('', at)).toEqual(armed);
    expect(restoreLatch('{not json', at)).toEqual(armed);
    expect(restoreLatch('[]', at)).toEqual(armed);
    expect(restoreLatch(JSON.stringify({ s: latched, r: [at] }), at)).toEqual(armed); // no `at`
    expect(restoreLatch(JSON.stringify({ s: latched, at }), at)).toEqual(armed); // no raises
    expect(restoreLatch(JSON.stringify({ s: { latched: 'huh' }, r: [], at }), at)).toEqual(armed);
    expect(
      restoreLatch(JSON.stringify({ s: { ...latched, normalStreak: -1 }, r: [], at }), at),
    ).toEqual(armed);
    expect(restoreLatch(JSON.stringify({ s: latched, r: [7], at }), at)).toEqual(armed);
  });

  it('restores an unlatched-but-counting state, so a crossing is not delayed twice', () => {
    // one caution poll had already been banked when the process died; caution
    // needs two, and losing the first would cost the worker a whole poll
    const counting: AlertLatchState = { ...INITIAL_LATCH, cautionStreak: 1 };
    const restored = restoreLatch(packLatch(counting, [], at), later(60_000));
    expect(restored.state).toEqual(counting);
    expect(nextAlertState(restored.state, TICK.caution()).raise).toBe('caution');
  });
});
