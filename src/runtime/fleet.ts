/**
 * Every virtual phone in the demo, and their sockets.
 *
 * The fleet does NOT fan events out itself — each phone holds its own
 * WebSocket and receives the server's own broadcast. `deliverToAll` exists for
 * tests and for the one case where the simulator legitimately drives every
 * phone at once; it is not the production delivery path, and using it as one
 * would quietly turn sixty independent clients back into a single fake.
 *
 * Access tokens last 30 minutes, well inside a demo's runtime, so the fleet
 * owns a CURRENT token per worker rather than reading the frozen one off the
 * `ProvisionedWorker` record: `tokenFor`/`refreshFor` below are the single
 * accessor both the socket and every REST report read through, so a refresh
 * that lands on one channel is visible on the other immediately.
 *
 * Each worker's phone, vitals buffer and socket live in ONE record keyed by
 * worker index. They are created together, torn down together, and every
 * lookup is by the index the rest of the simulator already uses.
 */
import type { ApiEvent, WsMessage } from '@/api/types';
import type { ProvisionedSession, ProvisionedWorker } from '@/net/provisioning';
import { connectPhoneSocket } from '@/net/wsClient';
import { refreshWorkerToken, type RefreshTokenFn } from '@/net/auth';
import { postHealthAlertEvent, postIndividualAlert, postResponse } from '@/phone/outbox';
import type { IndividualAlertBody, ResponseBody, ResponseResult } from '@/phone/outbox';
import { VirtualPhone, type PhoneContext } from '@/phone/VirtualPhone';
import { INITIAL_SPO2, VitalsBuffer } from '@/phone/vitalsBuffer';
import { estimateRestingHr } from '@/phone/vendor/health/baseline';
import { installBaselineSeriesReader } from '@/phone/vendor/health/healthConnect';
import type { SceneFrame } from '@/runtime/geo';
import { createStaggeredScheduler, type StaggeredScheduler } from '@/runtime/scheduler';

/** A resting heart rate for each worker, so the stress rule has a baseline. */
const RESTING_HR_BASE = 58;

/** The seeded resting rate for a worker, varied so the fleet is not uniform. */
export function seedRestingHrFor(index: number): number {
  return RESTING_HR_BASE + (index % 12);
}

type SocketHandle = { start(): void; stop(): void; kick(): void };

/**
 * The fleet's own token accessor for one worker — `get` always reads the
 * latest, `refresh` drives a real `/auth/refresh` call and stores the result.
 * Passed to `connect` so a test double can simulate the vendored controller's
 * 4401 handling without a real socket or a real network call.
 */
type WorkerToken = { get(): string; refresh(): Promise<string | null> };

/** Everything belonging to one worker, created and destroyed as a unit. */
type WorkerRecord = {
  worker: ProvisionedWorker;
  phone: VirtualPhone;
  buffer: VitalsBuffer;
  socket: SocketHandle;
};

/**
 * The sensing surface the fleet reads per worker. `Agents` satisfies this; so
 * does anything else that can answer "what does this worker's phone sense".
 * Declared structurally so `runtime/` does not depend on `sim/`.
 */
export type ContextSource = { contextFor(index: number): PhoneContext };

export type FleetDeps = {
  /** Read per fix; the origin can move while the demo runs. */
  frame: () => SceneFrame;
  /**
   * Per-worker sensing. Used when no `ContextSource` has been attached — which
   * is how every unit test drives a phone without a simulated building.
   */
  getContext: (worker: ProvisionedWorker) => PhoneContext;
  connect?: (
    worker: ProvisionedWorker,
    onMessage: (m: WsMessage) => void,
    token: WorkerToken,
  ) => SocketHandle;
  postResponse?: (
    token: string, eventId: string, body: ResponseBody,
  ) => Promise<ResponseResult | 'lost_race'>;
  postIndividualAlert?: (
    token: string, body: IndividualAlertBody,
  ) => Promise<{ id: string } | null>;
  /** overridable so tests never touch the network; defaults to the real /auth/refresh call */
  refreshToken?: RefreshTokenFn;
  /** overridable in tests; defaults to the real lifecycle POST */
  postHealthAlertEvent?: typeof postHealthAlertEvent;
  vitalsTickMs?: number;
};

export class Fleet {
  private readonly deps: FleetDeps;
  private records = new Map<number, WorkerRecord>();
  /** worker indices in start order — the scheduler ticks positionally */
  private order: number[] = [];
  private scheduler: StaggeredScheduler | null = null;
  /** current access token per worker index; absent ⇒ still the provisioned one */
  private tokens = new Map<number, string>();
  private contextSource: ContextSource | null = null;

  constructor(deps: FleetDeps) {
    this.deps = deps;
  }

  get phones(): VirtualPhone[] {
    return this.order.map((i) => this.records.get(i)!.phone);
  }

  get connectedCount(): number {
    return this.records.size;
  }

  buffer(index: number): VitalsBuffer | undefined {
    return this.records.get(index)?.buffer;
  }

  phoneFor(index: number): VirtualPhone | undefined {
    return this.records.get(index)?.phone;
  }

  /** Every worker's buffer, for whoever writes vitals into them. */
  buffersByIndex(): Map<number, VitalsBuffer> {
    return new Map([...this.records].map(([i, r]) => [i, r.buffer]));
  }

  /**
   * Attach the thing that knows where workers are. Until this is called the
   * fleet falls back to `deps.getContext`, which is what unit tests use.
   */
  attachContextSource(source: ContextSource | null): void {
    this.contextSource = source;
  }

  start(_session: ProvisionedSession, workers: ProvisionedWorker[]): void {
    // Idempotent by teardown: a second start would otherwise append a second
    // set of phones and sockets to the first, and the Reset flow does exactly
    // that.
    if (this.records.size > 0) this.stop();

    const now = Date.now();
    for (const worker of workers) this.addWorker(worker, now);

    // Wire the vendored Health-Connect seam to real data. The stub's own
    // docstring says it is "called once by the fleet" — until this call, that
    // was never true, and the reader stayed the module's do-nothing default.
    // There is no per-worker consumer for this yet, so a fleet-wide series is
    // the closest available reading; the point is that the seam is live.
    installBaselineSeriesReader(async () => ({
      hr: [...this.records.values()].flatMap((r) => r.buffer.hrSeries()),
      steps: [...this.records.values()].flatMap((r) => r.buffer.steps()),
    }));

    this.scheduler = createStaggeredScheduler({
      count: this.order.length,
      intervalMs: this.deps.vitalsTickMs ?? 2_000,
      onTick: (i) => {
        const record = this.records.get(this.order[i]);
        void record?.phone.tickVitals(Date.now());
      },
    });
    this.scheduler.start();
  }

  /** Seeds one worker's vitals, phone and socket, and registers all three. */
  private addWorker(worker: ProvisionedWorker, seedAtMs: number): void {
    this.tokens.set(worker.index, worker.accessToken);

    const buffer = new VitalsBuffer();
    // Resting HR varies a little per worker so the SEEDED series is personal
    // rather than shared. This is only the seed value, though — see below for
    // what actually gets handed to the risk engine.
    const seeded = seedRestingHrFor(worker.index);
    buffer.seed(seeded, seedAtMs);
    // seed() no longer sets SpO2 (a re-seed must not clobber an
    // already-accumulated one) — set the same starting value explicitly here,
    // once, at buffer creation, so first-seed behaviour is unchanged.
    buffer.setSpo2(INITIAL_SPO2, seedAtMs);

    const token: WorkerToken = {
      get: () => this.tokenFor(worker),
      refresh: () => this.refreshFor(worker),
    };
    const phone = this.spawnPhone(worker, buffer, token);

    // The resting HR the stress rule compares against should be genuinely
    // estimated, not just the value we asserted while seeding — so run it
    // through the vendored, tested estimator over the buffer's own series.
    // A freshly seeded buffer has 240+ quiet HR samples and no step buckets
    // yet (well over RISK_CONFIG.baseline.minSamples), so the estimator
    // succeeds here; falling back to the seed value only covers the
    // theoretical case of a buffer too sparse to estimate from.
    const estimated = estimateRestingHr(buffer.hrSeries(), buffer.steps());
    phone.setRestingHr(estimated ?? seeded);

    const socket =
      this.deps.connect?.(worker, (msg) => void this.route(phone, msg), token) ??
      connectPhoneSocket({
        getAccessToken: token.get,
        refreshAccessToken: token.refresh,
        onMessage: (msg) => void this.route(phone, msg),
        onStatus: () => {},
      });
    socket.start();

    this.records.set(worker.index, { worker, phone, buffer, socket });
    this.order.push(worker.index);
  }

  private spawnPhone(
    worker: ProvisionedWorker,
    buffer: VitalsBuffer,
    token: WorkerToken,
  ): VirtualPhone {
    const sendResponse = this.deps.postResponse ?? postResponse;
    const sendIndividualAlert = this.deps.postIndividualAlert ?? postIndividualAlert;
    const sendHealthEvent = this.deps.postHealthAlertEvent ?? postHealthAlertEvent;

    return new VirtualPhone({
      worker,
      frame: this.deps.frame,
      buffer,
      getContext: () =>
        this.contextSource?.contextFor(worker.index) ?? this.deps.getContext(worker),
      // VirtualPhone reads worker.accessToken (frozen at provisioning) and
      // passes it as `_token` below; it is deliberately ignored in favor of
      // this worker's current token, so a refresh reaches reporting too.
      postResponse: (_token, eventId, body) => sendResponse(token.get(), eventId, body),
      postIndividualAlert: (_token, body) => sendIndividualAlert(token.get(), body),
      /*
        The worker answering a health alert. `alertId` is null when the raise
        POST did not come back with one — a report with no alert to attach to
        is dropped rather than guessed at, because the server resolves the
        alert from the path id and there is nothing safe to put there.

        `app_screen` is the surface: in the simulator the worker answers on the
        watch face, which is the in-app screen rather than a notification
        action or a lock-screen alarm.
      */
      reportHealthAck: async (_token, alertId, occurredAt) => {
        if (!alertId) return;
        await sendHealthEvent(token.get(), alertId, 'acknowledged', occurredAt, 'app_screen');
      },
    });
  }

  stop(): void {
    this.scheduler?.stop();
    this.scheduler = null;
    for (const record of this.records.values()) record.socket.stop();
    this.records.clear();
    this.order = [];
    this.tokens.clear();
  }

  /** Test/utility path only — production delivery is each phone's own socket. */
  async deliverToAll(event: ApiEvent, nowMs: number): Promise<void> {
    await Promise.all(this.phones.map((p) => p.handleEvent(event, nowMs)));
  }

  /** The worker's current access token — refreshed if one has landed, else the provisioned one. */
  private tokenFor(worker: ProvisionedWorker): string {
    return this.tokens.get(worker.index) ?? worker.accessToken;
  }

  /**
   * Drives a real `/auth/refresh` for this worker and stores the result so
   * both the socket and every REST report see it immediately. A failed
   * refresh returns null and leaves the stale token in place — the vendored
   * controller reads that null as "session over" and stops reconnecting;
   * there is nothing else worth doing with a dead refresh token.
   */
  private async refreshFor(worker: ProvisionedWorker): Promise<string | null> {
    const fresh = await (this.deps.refreshToken ?? refreshWorkerToken)(worker.refreshToken);
    if (fresh) this.tokens.set(worker.index, fresh);
    return fresh;
  }

  private async route(phone: VirtualPhone, msg: WsMessage): Promise<void> {
    const now = Date.now();
    if (msg.type === 'event') await phone.handleEvent(msg.event, now);
    else if (msg.type === 'event_resolved') phone.handleResolved(msg.event_id);
    else if (msg.type === 'event_reminder') {
      await phone.handleReminder(msg.event, now);
    }
  }
}
