/**
 * One simulated worker's phone.
 *
 * Every decision here is made by a vendored module, exactly as it is on a real
 * handset: `decideProximity` gates the alert, `decideModality` picks the
 * channels, `assessRisk` and `nextAlertState` drive health alerts. This class
 * is only the wiring — it gathers inputs, calls the app's code, and reports the
 * verdict. Nothing in it may decide anything itself.
 *
 * The scene is never read directly. `getContext` is the seam: the runtime
 * supplies position, floor, movement and ambient noise, and the phone neither
 * knows nor cares that they come from a 3D agent.
 */
import type { ApiEvent, ContextSnapshot, Modality, RiskBand } from '@/api/types';
import { ALERT_CONFIG, INITIAL_LATCH, nextAlertState, type AlertLatchState } from '@/phone/vendor/health/alerting';
import { assessRisk, ageFromDob } from '@/phone/vendor/health/risk';
import { classifyContext } from '@/phone/vendor/context/ambientContext';
import { decideModality } from '@/phone/vendor/context/modality';
import { decideProximity, proximityContextSnapshot } from '@/phone/vendor/realtime/proximity';
import { planDelivery, type DeliveryPlan } from '@/phone/vendor/context/modalityDelivery';
import { frameToLatLon, type SceneFrame } from '@/runtime/geo';
import type { ProvisionedWorker } from '@/net/provisioning';
import type { IndividualAlertBody, ResponseBody, ResponseResult } from '@/phone/outbox';
import type { VitalsBuffer } from '@/phone/vitalsBuffer';

export type PhoneContext = {
  position: { x: number; z: number };
  floor: string | null;
  moving: boolean;
  /** ambient level in dBFS — negative, compared against NOISE_CONFIG.loudThresholdDbFs */
  noiseDbFs: number;
  /**
   * Age of that noise reading, ms. Fed to `classifyNoise`, whose staleness
   * branch treats an old sample as *unknown* rather than quiet — a worker can
   * walk from an office into a running plant faster than a stale reading
   * expires, so a stale "quiet" must never keep the sound channel on a masked
   * alert. Hardcoded to 0 in Phase 1; real once a monitor supplies it.
   */
  noiseAgeMs: number;
  /**
   * Age of the GPS fix, ms. Fed to `decideProximity`, which refuses to support
   * an out-of-range verdict from a fix older than its staleness bound and
   * safe-falls-back to delivering.
   */
  gpsAgeMs: number;
  /**
   * Whether the Steps grant is readable. False makes the vendored motion axis
   * report *unknown* rather than "still", which in turn makes the inactivity
   * gated rules abstain instead of firing on an assumption.
   */
  stepsReadable: boolean;
};

/**
 * A health alert this phone raised, as the worker sees it.
 *
 * The app does not only send these to the dashboard — it wakes the worker with
 * them. `alertNotification.ts` posts a titled notification on an alarm-grade
 * channel, danger takes a full-screen surface on the lock screen, every variant
 * vibrates, and the worker can answer "Got it". This carries what that surface
 * needs so the simulated watch shows the same thing.
 *
 * `delivery` comes from the app's own `planDelivery`, vendored, so a simulated
 * watch suppresses the same channels a real handset would in the same
 * conditions — sound masked in a loud plant, the screen never grabbed from
 * someone who is walking.
 */
export type PhoneHealthAlert = {
  band: Exclude<RiskBand, 'normal'>;
  /** the app's own notification title for this band */
  title: string;
  reason: string;
  hr: number | null;
  spo2: number | null;
  at: number;
  /** ISO of the raise — the app keys the alert's lifecycle on this */
  raisedAt: string;
  delivery: DeliveryPlan;
  /** server-assigned id, when the POST returned one */
  alertId: string | null;
  /** the worker has answered it; a health alert has no snooze or reject */
  acknowledged: boolean;
};

/**
 * The app's titles, copied from `health/alertNotification.ts`.
 *
 * Not vendored: they live in a module full of Android notification imports
 * that cannot be loaded here. Two strings are a fair thing to duplicate; the
 * *decision* modules are the ones that must never be re-implemented.
 */
const HEALTH_TITLE: Record<'caution' | 'danger', string> = {
  caution: 'Caution — elevated strain',
  danger: 'Danger — stop and rest now',
};

/**
 * What this phone decided about the last group alert it was handed.
 *
 * Recorded for display only — nothing reads it back into a decision. It exists
 * because the gate's verdict *is* the product's argument, and until now the
 * only way to see it was to query the server afterwards: sixty phones each
 * decided on their own floor and position, and the screen showed none of it.
 *
 * Both gates are kept rather than a single boolean, because "too far" and
 * "wrong floor" are completely different stories to tell — the second is the
 * one that surprises people, since a worker four metres away in plan can be a
 * storey up and correctly hear nothing.
 */
export type PhoneVerdict = {
  eventId: string;
  /** the phone alarmed */
  popped: boolean;
  distanceM: number | null;
  floorGate: string;
  gpsGate: string;
  /** the worker's own floor when the alert arrived */
  workerFloor: string | null;
};

export type PhoneAlert = {
  event: ApiEvent;
  modality: Modality;
  distanceM: number | null;
  snapshot: ContextSnapshot;
  at: number;
};

export type PhoneDeps = {
  worker: ProvisionedWorker;
  /**
   * Read per fix rather than held, because the origin can be moved while the
   * demo is running. A phone that cached it would keep reporting its position
   * against a frame the rest of the site had left.
   */
  frame: () => SceneFrame;
  buffer: VitalsBuffer;
  getContext: () => PhoneContext;
  postResponse: (
    token: string,
    eventId: string,
    body: ResponseBody,
  ) => Promise<ResponseResult | 'lost_race'>;
  postIndividualAlert: (
    token: string,
    body: IndividualAlertBody,
  ) => Promise<{ id: string } | null>;
  /**
   * Report that the worker acknowledged a health alert.
   *
   * `POST /individual-alerts/{id}/events` is live as of S3-BE7 and the fleet
   * wires this for real. It stays optional so a phone can be constructed
   * without a network in tests — and it never rejects, because it runs from a
   * UI click and a failed report must not stop the watch showing the worker
   * their own answer.
   */
  reportHealthAck?: (
    token: string,
    alertId: string | null,
    occurredAt: string,
  ) => Promise<void>;
};

export class VirtualPhone {
  activeAlert: PhoneAlert | null = null;
  riskBand: RiskBand = 'normal';
  /** The most recent raise, for display. Never read by any decision. */
  lastHealthAlert: PhoneHealthAlert | null = null;
  /** How this phone judged the last group alert. Display only. */
  lastVerdict: PhoneVerdict | null = null;
  /**
   * The most recent error a reporting POST raised. `handleEvent`/`ack`/
   * `reject`/`snooze` run from a WebSocket handler and UI callbacks, so a
   * reporting failure must never escape as an unhandled rejection — but it
   * must not vanish silently either, hence this field.
   *
   * `handleEvent` fires `received` un-awaited alongside an awaited `popped`,
   * so two reports can be in flight for the same event; a success on one
   * must not erase evidence that the other failed. This field is therefore
   * NOT cleared on a later success — it only ever holds the most recent
   * error. `reportFailureCount` is the monotonic counterpart: it never
   * decreases, so "has anything ever failed" survives even a subsequent run
   * of successes.
   */
  lastReportError: unknown = null;
  /** Total reporting failures across this phone's lifetime. Never decreases. */
  reportFailureCount = 0;

  private readonly deps: PhoneDeps;
  private readonly seen = new Set<string>();
  private latch: AlertLatchState = INITIAL_LATCH;
  private restingHr: number | null = null;

  constructor(deps: PhoneDeps) {
    this.deps = deps;
  }

  get workerId(): string {
    return this.deps.worker.userId;
  }

  /** Estimated resting HR, which the stress rule needs; set by the fleet at seed time. */
  setRestingHr(bpm: number): void {
    this.restingHr = bpm;
  }

  /**
   * A group alert arrived. The gate runs here, on this phone, with this
   * worker's own floor and position — which is the entire architecture in one
   * method.
   *
   * `event.id` is marked seen only once a decision (pop or ignore) has
   * actually been committed — never before. Marking it any earlier would let
   * a failure in `getContext` or the proximity gate itself permanently poison
   * the event id: the dedup check above would then discard every future
   * delivery of it without ever having decided anything.
   */
  async handleEvent(event: ApiEvent, nowMs: number): Promise<void> {
    if (this.seen.has(event.id)) return;

    // Mirrors the app's groupAlertGate.ts: 'received' is posted the instant
    // an event arrives — before the gate decides anything — as the audit
    // record that the alert reached this device at all, whether it goes on
    // to pop or gets ignored out of range. Fire-and-forget, exactly as the
    // app does it: not awaited, so it can never delay or fail the gate
    // decision that follows, and (via `report`'s own try/catch) it can never
    // escape as a rejection either. Placed after the dedup check above so a
    // duplicate delivery of the same event never produces a second one.
    void this.report(event.id, {
      action: 'received',
      occurred_at: new Date(nowMs).toISOString(),
    });

    const ctx = this.deps.getContext();
    const fix = frameToLatLon(this.deps.frame(), ctx.position.x, ctx.position.z);

    const input = {
      event: {
        floor: event.floor ?? null,
        latitude: event.latitude,
        longitude: event.longitude,
        alertRadiusM: event.alert_radius_m,
      },
      workerFloor: ctx.floor,
      gps: {
        latitude: fix.latitude,
        longitude: fix.longitude,
        // Not `nowMs`: a fix is as old as the last time it was taken, and the
        // vendored gate refuses to support an out-of-range verdict from a
        // stale one. Reporting it honestly is what makes that branch reachable.
        timestamp: nowMs - ctx.gpsAgeMs,
      },
      nowMs,
    };

    const verdict = decideProximity(input);
    const snapshot = proximityContextSnapshot(input, verdict);

    this.lastVerdict = {
      eventId: event.id,
      popped: verdict.shouldPop,
      distanceM: verdict.distanceM,
      floorGate: verdict.floorGate,
      gpsGate: verdict.gpsGate,
      workerFloor: ctx.floor,
    };

    if (!verdict.shouldPop) {
      this.seen.add(event.id);
      await this.report(event.id, {
        action: 'ignored_out_of_range',
        occurred_at: new Date(nowMs).toISOString(),
        distance_m: verdict.distanceM,
        context_snapshot: snapshot,
      });
      return;
    }

    const modality = decideModality(
      classifyContext({
        motion: { stepsReadable: ctx.stepsReadable, hasSteps: ctx.moving, at: nowMs },
        noise: { dbFs: ctx.noiseDbFs, ageMs: ctx.noiseAgeMs },
      }),
    );

    this.activeAlert = {
      event, modality, distanceM: verdict.distanceM, snapshot, at: nowMs,
    };
    this.seen.add(event.id);

    await this.report(event.id, {
      action: 'popped',
      occurred_at: new Date(nowMs).toISOString(),
      distance_m: verdict.distanceM,
      modality,
      context_snapshot: snapshot,
    });
  }

  /** The server resolved the event — clear without asking anything locally. */
  handleResolved(eventId: string): void {
    if (this.activeAlert?.event.id === eventId) this.activeAlert = null;
  }

  /** A snooze expired server-side; the alert returns. No local timer exists. */
  async handleReminder(event: ApiEvent, nowMs: number): Promise<void> {
    this.seen.delete(event.id);
    await this.handleEvent(event, nowMs);
  }

  async ack(nowMs: number): Promise<void> {
    await this.decide('ack', nowMs);
  }

  async reject(nowMs: number): Promise<void> {
    await this.decide('reject', nowMs);
  }

  async snooze(untilMs: number, nowMs: number): Promise<void> {
    const alert = this.activeAlert;
    if (!alert) return;
    this.activeAlert = null;
    await this.report(alert.event.id, {
      action: 'snooze',
      occurred_at: new Date(nowMs).toISOString(),
      snoozed_until: new Date(untilMs).toISOString(),
    });
  }

  /**
   * One poll of the health engine. The app runs this every 60 s; the simulator
   * runs it every couple of seconds against the same unmodified thresholds.
   */
  async tickVitals(nowMs: number): Promise<void> {
    const nowIso = new Date(nowMs).toISOString();
    // Read once: the risk assessment and the delivery plan must agree about
    // what this worker's phone is sensing, and two reads could straddle a tick.
    const health = this.deps.getContext();
    const assessment = assessRisk({
      hrSeries: this.deps.buffer.hrSeries(),
      spo2: this.deps.buffer.spo2(),
      steps: this.deps.buffer.steps(),
      stepsReadable: health.stepsReadable,
      restingHr: this.restingHr,
      age: ageFromDob(this.deps.worker.dateOfBirth, nowIso),
      nowIso,
    });

    this.riskBand = assessment.band;

    const tick = nextAlertState(this.latch, assessment);
    this.latch = tick.state;
    if (tick.raise === null) return;

    // The streak that actually produced this raise: dangerStreak for a danger
    // raise, cautionStreak for a caution raise (danger's enterTicks is 1, so it
    // raises on the first qualifying poll; caution needs 2). Reading it off the
    // latch state `nextAlertState` just returned — rather than assuming a
    // constant — keeps the audit trail honest for whichever band actually fired.
    const qualifyingPolls =
      tick.raise === 'danger' ? tick.state.dangerStreak : tick.state.cautionStreak;

    /*
      The same delivery decision the handset makes.

      Danger carries a safety floor — `forceVisual` — because its lock-screen
      wake and heavy vibration are the alarm posture and must survive a worker
      who is moving and not looking at the screen. Caution takes the full
      selection. Both come from the app's own module, so a loud plant masks the
      sound here exactly as it would there.
    */
    const modality = decideModality(
      classifyContext({
        motion: { stepsReadable: health.stepsReadable, hasSteps: health.moving, at: nowMs },
        noise: { dbFs: health.noiseDbFs, ageMs: health.noiseAgeMs },
      }),
    );
    const delivery = planDelivery(modality, {
      alarmGrade: tick.raise === 'danger',
      forceVisual: tick.raise === 'danger',
    });

    this.lastHealthAlert = {
      band: tick.raise,
      title: HEALTH_TITLE[tick.raise],
      reason: assessment.reason,
      hr: assessment.snapshot.hr,
      spo2: assessment.snapshot.spo2,
      at: nowMs,
      raisedAt: nowIso,
      delivery,
      alertId: null,
      acknowledged: false,
    };

    const raised = await this.deps.postIndividualAlert(this.deps.worker.accessToken, {
      risk_band: tick.raise,
      risk_score: assessment.score,
      vitals_snapshot: {
        hr: assessment.snapshot.hr,
        resting_hr_est: assessment.snapshot.restingHr,
        pct_hrmax: assessment.snapshot.pctHrMax,
        spo2: assessment.snapshot.spo2,
        steps_last_min: assessment.snapshot.stepsLastMin,
        sustained_s: assessment.snapshot.sustainedS,
      },
      reason: assessment.reason,
      raised_at: nowIso,
      decision_trace: {
        engine: 'risk-v1',
        rules: assessment.rules,
        debounce: {
          qualifying_polls: qualifyingPolls,
          required_polls: ALERT_CONFIG.enterTicks[tick.raise],
          poll_interval_s: 2,
        },
      },
    });

    // The lifecycle endpoint needs the server's id. Guarded because the raise
    // and the id arrive separately, and a second alert may have replaced this
    // one while the POST was in flight.
    if (raised && this.lastHealthAlert?.raisedAt === nowIso) {
      this.lastHealthAlert = { ...this.lastHealthAlert, alertId: raised.id };
    }
  }

  /**
   * The worker answered a health alert.
   *
   * A health alert has no ack/snooze/reject state machine — the app calls it
   * analytics-only, and the single action is acknowledging the advice. So this
   * marks it answered locally and reports the lifecycle event; there is no
   * verdict for the server to resolve.
   */
  async acknowledgeHealth(nowMs: number): Promise<void> {
    const alert = this.lastHealthAlert;
    if (!alert || alert.acknowledged) return;
    this.lastHealthAlert = { ...alert, acknowledged: true };
    await this.deps.reportHealthAck?.(
      this.deps.worker.accessToken,
      alert.alertId,
      new Date(nowMs).toISOString(),
    );
  }

  private async decide(action: 'ack' | 'reject', nowMs: number): Promise<void> {
    const alert = this.activeAlert;
    if (!alert) return;
    this.activeAlert = null;
    await this.report(alert.event.id, {
      action,
      occurred_at: new Date(nowMs).toISOString(),
    });
  }

  /**
   * Best-effort reporting. `handleEvent`, `ack`, `reject` and `snooze` are
   * invoked from a WebSocket message handler and UI callbacks — an escaping
   * rejection there becomes an unhandled promise rejection that can take out
   * the socket's message pump. The phone's own state (activeAlert, seen) has
   * already been committed by the caller before this runs, so a reporting
   * failure changes nothing about what the phone shows locally; it is only
   * recorded, not swallowed invisibly.
   *
   * Does NOT clear `lastReportError` on success: `received` (un-awaited) and
   * `popped`/`ack`/etc. (awaited) can both be in flight for the same event,
   * and a success on one must not erase evidence that the other failed.
   */
  private async report(eventId: string, body: ResponseBody): Promise<void> {
    try {
      await this.deps.postResponse(this.deps.worker.accessToken, eventId, body);
    } catch (err) {
      this.lastReportError = err;
      this.reportFailureCount += 1;
    }
  }
}
