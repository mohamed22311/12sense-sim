import type { RiskBand } from '@/api/types';
import {
  ALERT_CONFIG,
  INITIAL_LATCH,
  nextAlertState,
  type AlertLatchState,
} from '@/phone/vendor/health/alerting';
import { assessRisk, ageFromDob } from '@/phone/vendor/health/risk';
import { classifyContext } from '@/phone/vendor/context/ambientContext';
import { decideModality } from '@/phone/vendor/context/modality';
import { planDelivery, type DeliveryPlan } from '@/phone/vendor/context/modalityDelivery';
import type { PhoneContext } from '@/phone/VirtualPhone';
import type { VitalsBuffer } from '@/phone/vitalsBuffer';

/**
 * The health engine, running with no account behind it.
 *
 * `VirtualPhone` already runs `assessRisk` and `nextAlertState` for a worker
 * who has a real login — this runs the identical pair for one who does not. It
 * exists because `?preview` has no tenant, so the vitals dials had nothing to
 * drive: you could raise a worker's heart rate to 180 and the watch would sit
 * there saying NORMAL, which reads as a broken feature rather than as an
 * absent one.
 *
 * It is deliberately **not** a simplified copy. It imports the same vendored
 * modules, keeps the same latch, and applies the same unmodified thresholds;
 * the only thing it omits is the POST, because there is nowhere to post to. If
 * these two ever disagree about whether a worker is in danger, that is a bug
 * in one of them, not a difference of intent.
 */

export type HealthState = {
  band: RiskBand;
  /** The most recent raise, for display. Never read by any decision. */
  raised: {
    band: Exclude<RiskBand, 'normal'>;
    title: string;
    reason: string;
    at: number;
    delivery: DeliveryPlan;
    acknowledged: boolean;
  } | null;
};

/** The app's own titles, matching `health/alertNotification.ts`. */
const TITLE: Record<'caution' | 'danger', string> = {
  caution: 'Caution — elevated strain',
  danger: 'Danger — stop and rest now',
};

/**
 * The app's documented fallback when no context is available.
 *
 * `buildIndividualAlertNotification` defaults to the band's all-channels plan
 * and calls it "the missing-context safe fallback" — so a watch with nothing
 * to sense shows the maximal treatment rather than guessing a quieter one.
 */
const ALL_CHANNELS = { visual: true, haptic: true, sound: true };

export type HealthWatch = {
  tick(nowMs: number): void;
  stateFor(index: number): HealthState;
  acknowledge(index: number): void;
  stop(): void;
};

export type HealthWatchOptions = {
  buffers: Map<number, VitalsBuffer>;
  restingHrFor(index: number): number;
  /** ISO date of birth per worker; the age drives `hrMaxForAge`. */
  dateOfBirthFor(index: number): string;
  /**
   * What each worker's phone is sensing, for the delivery plan. Optional: with
   * no source the app's own missing-context fallback applies.
   */
  contextFor?: (index: number) => PhoneContext;
  /** How often to poll. The app polls every 60 s; the simulator is watched. */
  intervalMs?: number;
};

const DEFAULT_INTERVAL_MS = 2_000;

const NORMAL: HealthState = { band: 'normal', raised: null };

export function createHealthWatch(opts: HealthWatchOptions): HealthWatch {
  const { buffers, restingHrFor, dateOfBirthFor, contextFor } = opts;
  const latches = new Map<number, AlertLatchState>();
  const states = new Map<number, HealthState>();

  const poll = (nowMs: number) => {
    const nowIso = new Date(nowMs).toISOString();
    for (const [index, buffer] of buffers) {
      const assessment = assessRisk({
        hrSeries: buffer.hrSeries(),
        spo2: buffer.spo2(),
        steps: buffer.steps(),
        // No context source here, so the honest answer is that steps are
        // readable — which is what the simulated agents report anyway.
        stepsReadable: true,
        restingHr: restingHrFor(index),
        age: ageFromDob(dateOfBirthFor(index), nowIso),
        nowIso,
      });

      const latch = latches.get(index) ?? INITIAL_LATCH;
      const tick = nextAlertState(latch, assessment);
      latches.set(index, tick.state);

      const previous = states.get(index) ?? NORMAL;
      if (tick.raise === null) {
        states.set(index, { band: assessment.band, raised: previous.raised });
        continue;
      }

      /*
        The same delivery decision the handset makes. Danger carries a safety
        floor — its lock-screen wake and heavy vibration are the alarm posture
        and survive a worker who is moving and not looking at the screen.
      */
      const context = contextFor?.(index);
      const modality = context
        ? decideModality(
            classifyContext({
              motion: {
                stepsReadable: context.stepsReadable,
                hasSteps: context.moving,
                at: nowMs,
              },
              noise: { dbFs: context.noiseDbFs, ageMs: context.noiseAgeMs },
            }),
          )
        : ALL_CHANNELS;

      states.set(index, {
        band: assessment.band,
        raised: {
          band: tick.raise,
          title: TITLE[tick.raise],
          reason: assessment.reason,
          at: nowMs,
          delivery: planDelivery(modality, {
            alarmGrade: tick.raise === 'danger',
            forceVisual: tick.raise === 'danger',
          }),
          acknowledged: false,
        },
      });
    }
  };

  const timer = setInterval(() => poll(Date.now()), opts.intervalMs ?? DEFAULT_INTERVAL_MS);

  return {
    tick: poll,
    stateFor(index) {
      return states.get(index) ?? NORMAL;
    },

    /** The worker answered. Local only — there is no account to report to. */
    acknowledge(index) {
      const state = states.get(index);
      if (!state?.raised || state.raised.acknowledged) return;
      states.set(index, { ...state, raised: { ...state.raised, acknowledged: true } });
    },
    stop() {
      clearInterval(timer);
    },
  };
}

/** Kept beside the engine so a caller can report the debounce it is subject to. */
export const HEALTH_ENTER_TICKS = ALERT_CONFIG.enterTicks;
