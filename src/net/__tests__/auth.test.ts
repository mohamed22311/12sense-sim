import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/net/apiClient';
import { refreshWorkerTokenDetailed } from '@/net/auth';

/**
 * The distinction these lock down is the whole point of the change.
 *
 * The server answers 503 rather than 401 when it cannot reach the database
 * (S3-BE17), specifically so a transient fault is not read as a revoked
 * session. The simulator calls `/auth/refresh` directly rather than from a 401
 * handler, so it has to make that call itself — and it used to collapse every
 * failure into "signed out", taking a worker's phone off the air for the rest
 * of a demo with no way back.
 */

const ok = { access_token: 'fresh-token' };
const noWait = () => Promise.resolve();

describe('refreshWorkerTokenDetailed', () => {
  it('returns the new token on success', async () => {
    const request = vi.fn().mockResolvedValue(ok);
    const outcome = await refreshWorkerTokenDetailed('rt', request as never, noWait);
    expect(outcome).toEqual({ kind: 'refreshed', accessToken: 'fresh-token' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('ends the session on 401, without retrying', async () => {
    // A rejected refresh token will not become valid on the second ask, and
    // retrying holds a socket open waiting for an answer that cannot change.
    const request = vi.fn().mockRejectedValue(new ApiError('nope', { status: 401 }));
    const outcome = await refreshWorkerTokenDetailed('rt', request as never, noWait);
    expect(outcome).toEqual({ kind: 'signed-out', status: 401 });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('ends the session on 403, which is how an offboarded worker is refused', async () => {
    const request = vi.fn().mockRejectedValue(new ApiError('offboarded', { status: 403 }));
    const outcome = await refreshWorkerTokenDetailed('rt', request as never, noWait);
    expect(outcome).toEqual({ kind: 'signed-out', status: 403 });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('retries a 503 and succeeds if the blip passes', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('db down', { status: 503 }))
      .mockResolvedValue(ok);
    const outcome = await refreshWorkerTokenDetailed('rt', request as never, noWait);
    expect(outcome).toEqual({ kind: 'refreshed', accessToken: 'fresh-token' });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('reports a persistent 503 as unavailable, NOT as signed out', async () => {
    // The distinction that matters: the fleet keeps the refresh token and can
    // try again. Reporting this as signed-out is what used to strand a worker.
    const request = vi.fn().mockRejectedValue(new ApiError('db down', { status: 503 }));
    const outcome = await refreshWorkerTokenDetailed('rt', request as never, noWait);
    expect(outcome.kind).toBe('unavailable');
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('treats a network failure as transient too', async () => {
    // No status at all — a dropped connection or an aborted timeout. Unknown
    // is not the same as refused.
    const request = vi.fn().mockRejectedValue(new Error('network error'));
    const outcome = await refreshWorkerTokenDetailed('rt', request as never, noWait);
    expect(outcome.kind).toBe('unavailable');
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('treats a 500 as transient, not as a decision', async () => {
    const request = vi.fn().mockRejectedValue(new ApiError('boom', { status: 500 }));
    const outcome = await refreshWorkerTokenDetailed('rt', request as never, noWait);
    expect(outcome.kind).toBe('unavailable');
  });
});
