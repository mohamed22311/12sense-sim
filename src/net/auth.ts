/**
 * Refreshing one worker's access token.
 *
 * Access tokens last 30 minutes; a demo run routinely outlives that. Each
 * worker refreshes independently — a dead refresh token only ends that one
 * worker's session, never the fleet's. `POST /auth/refresh` is the server's
 * only path back to a live access token; there is no other recovery from an
 * expired one.
 */
import { apiRequest } from './apiClient';
import type { RefreshResponse } from '@/api/types';

/** Injected in tests; production passes the real call through. Null ⇒ session over. */
export type RefreshTokenFn = (refreshToken: string) => Promise<string | null>;

export const refreshWorkerToken: RefreshTokenFn = async (refreshToken) => {
  try {
    const res = await apiRequest<RefreshResponse>('POST', '/auth/refresh', {
      body: { refresh_token: refreshToken },
    });
    return res.access_token;
  } catch {
    return null;
  }
};
