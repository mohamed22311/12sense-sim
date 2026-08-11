/**
 * Refreshing one worker's access token.
 *
 * Access tokens last 30 minutes; a demo run routinely outlives that. Each
 * worker refreshes independently — a dead refresh token only ends that one
 * worker's session, never the fleet's. `POST /auth/refresh` is the server's
 * only path back to a live access token; there is no other recovery from an
 * expired one.
 *
 * **Not every failure ends a session.** This used to catch everything and
 * return null, which the fleet reads as "signed out" — so one blip took that
 * worker's phone off the air for the rest of the demo, permanently, with no
 * way back. The server went to deliberate trouble to make that distinguishable
 * (S3-BE17): `/auth/refresh` reads the user row now, and answers **503 rather
 * than 401** when the database cannot be reached, precisely so a transient
 * fault is not mistaken for a revoked session.
 *
 * The handset gets that protection structurally — its refresh gate only runs
 * from a 401 handler, so a 503 never reaches it. The simulator calls refresh
 * directly, so it has to classify the failure itself, and this is where that
 * happens: only a genuine auth rejection ends the session; everything else is
 * retried and, if it still fails, left for the next attempt.
 */
import { ApiError } from './apiClient';
import { apiRequest } from './apiClient';
import type { RefreshResponse } from '@/api/types';

/** Injected in tests; production passes the real call through. Null ⇒ session over. */
export type RefreshTokenFn = (refreshToken: string) => Promise<string | null>;

/**
 * Statuses that genuinely mean "this session is over".
 *
 * 401 is a rejected or expired refresh token. 403 is the offboarding case the
 * server added in S3-BE17 — a worker whose status is no longer active is
 * refused at every surface, and that is a decision, not a fault.
 */
const SESSION_ENDED = new Set([401, 403]);

/** How many times a transient failure is retried before giving up for now. */
const ATTEMPTS = 3;

/** Backoff between attempts, ms. Short: a socket is waiting on this. */
const BACKOFF_MS = [400, 1200];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The outcome of a refresh, kept separate from the token so a caller can tell
 * "signed out" from "could not tell".
 */
export type RefreshOutcome =
  | { kind: 'refreshed'; accessToken: string }
  | { kind: 'signed-out'; status: number }
  | { kind: 'unavailable'; reason: string };

export async function refreshWorkerTokenDetailed(
  refreshToken: string,
  request: typeof apiRequest = apiRequest,
  wait: (ms: number) => Promise<unknown> = sleep,
): Promise<RefreshOutcome> {
  let lastReason = 'unknown';

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const res = await request<RefreshResponse>('POST', '/auth/refresh', {
        body: { refresh_token: refreshToken },
      });
      return { kind: 'refreshed', accessToken: res.access_token };
    } catch (error) {
      if (error instanceof ApiError && SESSION_ENDED.has(error.status)) {
        // A decision, not a fault. Retrying it would be pointless and would
        // hold a socket open waiting for an answer that will not change.
        return { kind: 'signed-out', status: error.status };
      }
      lastReason = error instanceof Error ? error.message : String(error);
      const backoff = BACKOFF_MS[attempt];
      if (backoff !== undefined) await wait(backoff);
    }
  }

  return { kind: 'unavailable', reason: lastReason };
}

/**
 * The fleet's view: a token, or null.
 *
 * `unavailable` returns null too — the caller has no token to use either way —
 * but the distinction is not lost, because the fleet keeps the refresh token
 * and will try again on the next 4401. What has changed is that a transient
 * failure no longer *ends* anything.
 */
export const refreshWorkerToken: RefreshTokenFn = async (refreshToken) => {
  const outcome = await refreshWorkerTokenDetailed(refreshToken);
  return outcome.kind === 'refreshed' ? outcome.accessToken : null;
};
