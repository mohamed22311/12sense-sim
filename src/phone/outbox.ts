/**
 * Everything a virtual phone reports to the server.
 *
 * The contract's idempotency rule is what makes a retry safe: a repeat of a
 * known `client_event_id` is a no-op returning the current state, not a second
 * action. So the key is generated ONCE per action and reused across every
 * retry of it — generating a fresh key per attempt would turn one ack into
 * several distinct audit rows.
 *
 * A 409 is not an error here. It is the state machine working: another worker
 * acked first, this phone lost the race, and the attempt was still recorded.
 */
import { ApiError, apiRequest, newClientEventId } from '@/net/apiClient';
import type { ContextSnapshot, Modality } from '@/api/types';

export type ResponseAction =
  | 'received' | 'popped' | 'ignored_out_of_range' | 'ack' | 'snooze' | 'reject';

export type ResponseBody = {
  action: ResponseAction;
  occurred_at: string;
  snoozed_until?: string;
  distance_m?: number | null;
  modality?: Modality;
  context_snapshot?: ContextSnapshot | Record<string, unknown>;
};

export type ResponseResult = {
  event_id: string;
  worker_state: string;
  event_status?: string;
  resolved_by?: string | null;
};

type SendFn = (
  token: string,
  eventId: string,
  body: ResponseBody & { client_event_id: string },
) => Promise<ResponseResult>;

type SleepFn = (ms: number) => Promise<void>;

const realSend: SendFn = (token, eventId, body) =>
  apiRequest<ResponseResult>('POST', `/events/${eventId}/responses`, { token, body });

const realSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Backoff before retry attempts 2 and 3 (never before attempt 1, never after
 * the last attempt). Against a hard transport failure — connection refused,
 * DNS failure — `send` rejects in well under a millisecond, so without a
 * delay all `attempts` complete near-instantly and the retry policy is
 * decorative rather than giving a flaky connection real time to recover.
 */
const RETRY_DELAYS_MS = [200, 500, 1000];

/** 4xx other than 409 will fail identically on a retry; only transport is worth repeating. */
const worthRetrying = (e: unknown) =>
  !(e instanceof ApiError) || e.status === 0 || e.status >= 500;

export async function postResponse(
  token: string,
  eventId: string,
  body: ResponseBody,
  send: SendFn = realSend,
  attempts = 3,
  sleep: SleepFn = realSleep,
): Promise<ResponseResult | 'lost_race'> {
  const client_event_id = newClientEventId();
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
    try {
      return await send(token, eventId, { ...body, client_event_id });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) return 'lost_race';
      if (!worthRetrying(e)) throw e;
      lastError = e;
    }
  }
  throw lastError;
}

export type IndividualAlertBody = {
  risk_band: 'caution' | 'danger';
  risk_score: number;
  vitals_snapshot: Record<string, number | null>;
  reason: string;
  raised_at: string;
  decision_trace?: Record<string, unknown>;
};

/**
 * Health alerts are analytics only — the server records the phone's verdict and
 * raises nothing. A failure here must never disturb the demo, so it is
 * swallowed and reported as null rather than thrown into the tick loop.
 */
export async function postIndividualAlert(
  token: string,
  body: IndividualAlertBody,
): Promise<{ id: string } | null> {
  try {
    return await apiRequest<{ id: string }>('POST', '/individual-alerts', {
      token,
      body: { ...body, client_event_id: newClientEventId() },
    });
  } catch {
    return null;
  }
}
