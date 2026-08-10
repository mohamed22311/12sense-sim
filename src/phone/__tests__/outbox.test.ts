import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/net/apiClient';
import { postResponse } from '@/phone/outbox';

const body = {
  action: 'ack' as const,
  occurred_at: '2026-08-09T12:00:00.000Z',
  modality: { visual: true, haptic: true, sound: false },
  context_snapshot: {},
};

describe('postResponse', () => {
  it('attaches a client_event_id for idempotency', async () => {
    const send = vi.fn(async (_t: string, _e: string, _b: { client_event_id: string }) => ({
      event_id: 'e1',
      worker_state: 'acknowledged',
    }));
    await postResponse('tok', 'e1', body, send);
    expect(send.mock.calls[0][2].client_event_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reuses the same client_event_id across retries of one action', async () => {
    const ids: string[] = [];
    const send = vi.fn(async (_t: string, _e: string, b: { client_event_id: string }) => {
      ids.push(b.client_event_id);
      if (ids.length === 1) throw new ApiError('network', { status: 0 });
      return { event_id: 'e1', worker_state: 'acknowledged' };
    });

    await postResponse('tok', 'e1', body, send, 2);

    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it('reports a 409 as a lost race rather than throwing', async () => {
    const send = vi.fn(async () => {
      throw new ApiError('resolved', {
        status: 409,
        code: 'event_already_resolved',
        details: { resolved_by: 'w-2' },
      });
    });

    await expect(postResponse('tok', 'e1', body, send)).resolves.toBe('lost_race');
  });

  it('does not retry a 422 — a rejected body will be rejected again', async () => {
    const send = vi.fn(async () => {
      throw new ApiError('bad', { status: 422 });
    });

    await expect(postResponse('tok', 'e1', body, send, 3)).rejects.toBeInstanceOf(ApiError);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('backs off between attempts, in order, with no delay before the first or after the last', async () => {
    const delays: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      delays.push(ms);
    });
    const send = vi.fn(async () => {
      throw new ApiError('network', { status: 0 });
    });

    await expect(postResponse('tok', 'e1', body, send, 3, sleep)).rejects.toBeInstanceOf(ApiError);

    expect(send).toHaveBeenCalledTimes(3);
    // Exactly two delays — between attempt 1→2 and 2→3 — never before the
    // first attempt and never after the final (failed) one.
    expect(delays).toEqual([200, 500]);
  });

  it('does not sleep at all when the first attempt succeeds', async () => {
    const sleep = vi.fn(async () => {});
    const send = vi.fn(async (_t: string, _e: string, _b: { client_event_id: string }) => ({
      event_id: 'e1',
      worker_state: 'acknowledged',
    }));

    await postResponse('tok', 'e1', body, send, 3, sleep);

    expect(sleep).not.toHaveBeenCalled();
  });
});
