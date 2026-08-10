import type { WsMessage } from '@/api/types';
import {
  BACKOFF_BASE_MS,
  BACKOFF_CAP_MS,
  STABLE_OPEN_MS,
  backoffDelayMs,
  createWsController,
  SocketDeps,
  WsLike,
  WsStatus,
} from '../realtime/socket';

/**
 * The WS controller is the pure policy behind "the app maintains a live
 * connection": authenticated connect, exponential backoff with jitter on
 * drops, refresh-then-reconnect on 4401, pong replies, and silent drops of
 * malformed frames. Everything is injected, so time and sockets are fake.
 */

class FakeSocket implements WsLike {
  sent: string[] = [];
  closeCalls: (number | undefined)[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  onclose: ((e: { code?: number }) => void) | null = null;

  constructor(public url: string) {}

  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.closeCalls.push(code);
  }
  emitOpen() {
    this.onopen?.();
  }
  emitMessage(data: unknown) {
    this.onmessage?.({ data });
  }
  emitClose(code?: number) {
    this.onclose?.({ code });
  }
}

/** Deterministic replacement for the injected setTimeout/clearTimeout pair. */
function makeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimeout: (fn: () => void, ms: number): unknown => {
      const id = nextId++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id: unknown): void => {
      pending.delete(id as number);
    },
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...pending.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at > now) continue;
        pending.delete(id);
        t.fn();
      }
    },
    pendingCount: () => pending.size,
  };
}

function makeHarness(overrides: Partial<SocketDeps> = {}) {
  const timers = makeTimers();
  const sockets: FakeSocket[] = [];
  const statuses: WsStatus[] = [];
  const messages: WsMessage[] = [];
  const deps: SocketDeps = {
    url: 'ws://host/api/v1/ws',
    createSocket: (url: string) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    getAccessToken: jest.fn().mockReturnValue('access-jwt'),
    refreshAccessToken: jest.fn().mockResolvedValue('fresh-jwt'),
    onMessage: (m) => messages.push(m),
    onStatus: (s) => statuses.push(s),
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    random: () => 1, // upper jitter bound -> delays equal the raw schedule
    ...overrides,
  };
  return { deps, timers, sockets, statuses, messages, ctrl: createWsController(deps) };
}

/** Settle the promise chain of a refresh-then-reconnect path. */
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('backoffDelayMs', () => {
  it('doubles from base to the cap (upper jitter bound)', () => {
    const one = () => 1;
    expect([0, 1, 2, 3, 4, 5, 6].map((a) => backoffDelayMs(a, one))).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ]);
    expect(backoffDelayMs(0, one)).toBe(BACKOFF_BASE_MS);
    expect(backoffDelayMs(99, one)).toBe(BACKOFF_CAP_MS);
  });

  it('jitters uniformly down to half the raw delay', () => {
    expect(backoffDelayMs(0, () => 0)).toBe(500);
    expect(backoffDelayMs(2, () => 0)).toBe(2_000);
    expect(backoffDelayMs(2, () => 0.5)).toBe(3_000);
  });
});

describe('createWsController — connect', () => {
  it('connects with the encoded token in the URL and reports connecting -> open', () => {
    const h = makeHarness({ getAccessToken: jest.fn().mockReturnValue('a c/c+e$s') });
    h.ctrl.start();

    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0].url).toBe('ws://host/api/v1/ws?token=a%20c%2Fc%2Be%24s');
    expect(h.statuses).toEqual(['connecting']);

    h.sockets[0].emitOpen();
    expect(h.statuses).toEqual(['connecting', 'open']);
  });

  it('start() is idempotent', () => {
    const h = makeHarness();
    h.ctrl.start();
    h.ctrl.start();
    expect(h.sockets).toHaveLength(1);
  });

  it('with no stored token it refreshes first, then connects', async () => {
    const h = makeHarness({ getAccessToken: jest.fn().mockReturnValue(null) });
    h.ctrl.start();
    await flush();

    expect(h.deps.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(h.sockets).toHaveLength(1);
    expect(h.sockets[0].url).toContain('token=fresh-jwt');
  });

  it('stops when there is no token and the refresh yields none', async () => {
    const h = makeHarness({
      getAccessToken: jest.fn().mockReturnValue(null),
      refreshAccessToken: jest.fn().mockResolvedValue(null),
    });
    h.ctrl.start();
    await flush();

    expect(h.sockets).toHaveLength(0);
    expect(h.statuses).toEqual(['connecting', 'stopped']);
  });
});

describe('createWsController — messages', () => {
  it('replies pong to ping and still forwards the ping', () => {
    const h = makeHarness();
    h.ctrl.start();
    h.sockets[0].emitOpen();
    h.sockets[0].emitMessage(JSON.stringify({ type: 'ping', at: '2026-07-03T10:00:00Z' }));

    expect(h.sockets[0].sent).toEqual([JSON.stringify({ type: 'pong' })]);
    expect(h.messages).toEqual([{ type: 'ping', at: '2026-07-03T10:00:00Z' }]);
  });

  it('forwards event and event_resolved messages parsed', () => {
    const h = makeHarness();
    h.ctrl.start();
    h.sockets[0].emitOpen();

    const event = { type: 'event', event: { id: 'e1', severity: 'high', message: 'x' } };
    const resolved = {
      type: 'event_resolved',
      event_id: 'e1',
      resolved_by: 'w2',
      resolved_at: '2026-07-03T10:00:05Z',
    };
    h.sockets[0].emitMessage(JSON.stringify(event));
    h.sockets[0].emitMessage(JSON.stringify(resolved));

    expect(h.messages).toEqual([event, resolved]);
    expect(h.sockets[0].sent).toEqual([]); // nothing but pong is ever sent
  });

  it('forwards event_reminder (snooze re-alert) parsed, requiring the event payload', () => {
    const h = makeHarness();
    h.ctrl.start();
    h.sockets[0].emitOpen();

    const reminder = {
      type: 'event_reminder',
      event_id: 'e1',
      reason: 'snooze_expired',
      snoozed_until: '2026-07-03T10:05:00Z',
      event: { id: 'e1', severity: 'high', message: 'x' },
    };
    h.sockets[0].emitMessage(JSON.stringify(reminder));
    h.sockets[0].emitMessage(JSON.stringify({ type: 'event_reminder', event_id: 'e1' })); // no event

    expect(h.messages).toEqual([reminder]);
  });

  it('silently drops malformed frames: bad JSON, non-objects, unknown types, event without payload', () => {
    const h = makeHarness();
    h.ctrl.start();
    h.sockets[0].emitOpen();

    for (const frame of [
      'not json {',
      '"just a string"',
      '42',
      'null',
      JSON.stringify({ no: 'type' }),
      JSON.stringify({ type: 'presence_ack' }),
      JSON.stringify({ type: 'event' }), // event missing
      12345, // non-string data
    ]) {
      expect(() => h.sockets[0].emitMessage(frame)).not.toThrow();
    }
    expect(h.messages).toEqual([]);
  });
});

describe('createWsController — reconnect & backoff', () => {
  it('reconnects after a drop with a freshly-read token', () => {
    const tokens = ['first-jwt', 'second-jwt'];
    const h = makeHarness({ getAccessToken: jest.fn(() => tokens.shift() ?? 'x') });
    h.ctrl.start();
    h.sockets[0].emitOpen();
    h.sockets[0].emitClose(1006);

    expect(h.statuses).toEqual(['connecting', 'open', 'reconnecting']);
    expect(h.sockets).toHaveLength(1);

    h.timers.advance(BACKOFF_BASE_MS);
    expect(h.sockets).toHaveLength(2);
    expect(h.sockets[1].url).toContain('token=second-jwt');
  });

  it('doubles the delay on repeated failed attempts', () => {
    const h = makeHarness();
    h.ctrl.start();
    h.sockets[0].emitClose(1006); // never opened

    h.timers.advance(999);
    expect(h.sockets).toHaveLength(1);
    h.timers.advance(1); // 1s -> attempt 2
    expect(h.sockets).toHaveLength(2);

    h.sockets[1].emitClose(1006);
    h.timers.advance(1_999);
    expect(h.sockets).toHaveLength(2);
    h.timers.advance(1); // 2s -> attempt 3
    expect(h.sockets).toHaveLength(3);

    h.sockets[2].emitClose(1006);
    h.timers.advance(4_000); // 4s -> attempt 4
    expect(h.sockets).toHaveLength(4);
  });

  it('a stable open (10s) resets the backoff to base', () => {
    const h = makeHarness();
    h.ctrl.start();
    h.sockets[0].emitClose(1006);
    h.timers.advance(1_000);
    h.sockets[1].emitClose(1006);
    h.timers.advance(2_000); // attempt counter now at 4s territory

    h.sockets[2].emitOpen();
    h.timers.advance(STABLE_OPEN_MS); // stable -> reset
    h.sockets[2].emitClose(1006);

    h.timers.advance(BACKOFF_BASE_MS); // base again, not 4s
    expect(h.sockets).toHaveLength(4);
  });

  it('a short-lived open does NOT reset the backoff', () => {
    const h = makeHarness();
    h.ctrl.start();
    h.sockets[0].emitClose(1006);
    h.timers.advance(1_000);

    h.sockets[1].emitOpen();
    h.timers.advance(STABLE_OPEN_MS - 1); // flap: closes just before stable
    h.sockets[1].emitClose(1006);

    h.timers.advance(1_999); // base delay would have fired a new socket by now
    expect(h.sockets).toHaveLength(2);
    h.timers.advance(1); // 2s -> the schedule continued instead
    expect(h.sockets).toHaveLength(3);
  });

  it('ignores onerror (RN always follows with onclose)', () => {
    const h = makeHarness();
    h.ctrl.start();
    h.sockets[0].emitOpen();
    h.sockets[0].onerror?.(new Error('boom'));

    expect(h.statuses).toEqual(['connecting', 'open']);
    expect(h.timers.pendingCount()).toBe(1); // just the stable-open timer
  });
});

describe('createWsController — 4401 (auth)', () => {
  it('refreshes and reconnects immediately with the new token', async () => {
    const h = makeHarness();
    h.ctrl.start();
    h.sockets[0].emitOpen();
    h.sockets[0].emitClose(4401);
    await flush();

    expect(h.deps.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(h.sockets).toHaveLength(2); // no timer advance needed
    expect(h.sockets[1].url).toContain('token=fresh-jwt');
  });

  it('stops when the refresh fails (session over)', async () => {
    const h = makeHarness({ refreshAccessToken: jest.fn().mockResolvedValue(null) });
    h.ctrl.start();
    h.sockets[0].emitOpen();
    h.sockets[0].emitClose(4401);
    await flush();

    expect(h.sockets).toHaveLength(1);
    expect(h.statuses[h.statuses.length - 1]).toBe('stopped');
  });

  it('a second consecutive 4401 without a stable open falls back to backoff', async () => {
    const h = makeHarness();
    h.ctrl.start();
    h.sockets[0].emitClose(4401);
    await flush();
    expect(h.sockets).toHaveLength(2); // first 4401: immediate

    h.sockets[1].emitClose(4401);
    await flush();
    expect(h.sockets).toHaveLength(2); // second: not immediate

    h.timers.advance(BACKOFF_BASE_MS);
    expect(h.sockets).toHaveLength(3);
  });

  it('a stable open clears the consecutive-4401 guard', async () => {
    const h = makeHarness();
    h.ctrl.start();
    h.sockets[0].emitClose(4401);
    await flush();

    h.sockets[1].emitOpen();
    h.timers.advance(STABLE_OPEN_MS);
    h.sockets[1].emitClose(4401);
    await flush();

    expect(h.sockets).toHaveLength(3); // immediate again
  });
});

describe('createWsController — stop & kick', () => {
  it('stop() closes the socket, cancels timers, and ignores the late close', () => {
    const h = makeHarness();
    h.ctrl.start();
    h.sockets[0].emitOpen();
    h.ctrl.stop();

    expect(h.sockets[0].closeCalls).toEqual([1000]);
    expect(h.timers.pendingCount()).toBe(0);
    expect(h.statuses[h.statuses.length - 1]).toBe('stopped');

    h.sockets[0].emitClose(1000); // the real socket still fires onclose later
    h.timers.advance(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('stop() cancels a pending reconnect', () => {
    const h = makeHarness();
    h.ctrl.start();
    h.sockets[0].emitClose(1006);
    h.ctrl.stop();

    h.timers.advance(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('stop() is idempotent', () => {
    const h = makeHarness();
    h.ctrl.start();
    h.ctrl.stop();
    h.ctrl.stop();
    expect(h.statuses.filter((s) => s === 'stopped')).toHaveLength(1);
  });

  it('kick() during a pending backoff connects immediately', () => {
    const h = makeHarness();
    h.ctrl.start();
    h.sockets[0].emitClose(1006);

    h.ctrl.kick();
    expect(h.sockets).toHaveLength(2);
    h.timers.advance(60_000); // the cancelled timer must not double-connect
    expect(h.sockets).toHaveLength(2);
  });

  it('kick() is a no-op while open or stopped', () => {
    const h = makeHarness();
    h.ctrl.start();
    h.sockets[0].emitOpen();
    h.ctrl.kick();
    expect(h.sockets).toHaveLength(1);

    h.ctrl.stop();
    h.ctrl.kick();
    expect(h.sockets).toHaveLength(1);
  });
});
