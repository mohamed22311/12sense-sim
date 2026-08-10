/* VENDORED — DO NOT EDIT.
 * Source: TwelveSense-TT-MobileApp/Thalamus/src/realtime/socket.ts @ 15b11d4
 * Sync check: `npm run check:vendor`. Fix drift by re-copying, never by editing.
 */
import type { WsMessage } from '@/api/types';

/**
 * Live-channel connection policy — pure logic with injected dependencies so it
 * is unit-testable (Constitution III). The React shell (WsProvider) supplies
 * the real WebSocket, timers, and the auth refresh gate. Policy:
 *
 *  - connect to `url?token=<access_jwt>` (contract: GET /api/v1/ws);
 *  - the token is re-read on every reconnect, so a REST-side refresh is
 *    picked up for free;
 *  - any unintentional close → reconnect after exponential backoff
 *    min(30s, 1s·2ⁿ) with uniform jitter in [½·delay, delay]; the attempt
 *    counter resets only after a connection stays open STABLE_OPEN_MS, so a
 *    rapid open/close flap cannot hammer the server at the base delay;
 *  - close code 4401 (bad/expired token) → single-flight refresh, then an
 *    IMMEDIATE reconnect with the fresh token — unless the previous close was
 *    also a 4401 without a stable open in between (guard against a refresh
 *    that yields tokens the server still rejects), which falls back to the
 *    backoff schedule; a failed refresh stops the controller (the gate's
 *    onSignedOut already ends the session);
 *  - server `ping` frames are answered with `{"type":"pong"}` here, so the
 *    keep-alive works even if no UI consumes messages;
 *  - malformed frames (bad JSON, non-objects, unknown `type`) are dropped
 *    silently — never thrown, never forwarded.
 */

export type WsStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'stopped';

/** Minimal surface of a WebSocket the controller drives (prod: the RN global). */
export type WsLike = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e?: unknown) => void) | null;
  onclose: ((e: { code?: number }) => void) | null;
};

export type SocketDeps = {
  /** WS endpoint without a query string (see api/config.ts WS_URL) */
  url: string;
  createSocket: (url: string) => WsLike;
  getAccessToken: () => string | null;
  /** the auth refresh gate — resolves the fresh token, or null when signed out */
  refreshAccessToken: () => Promise<string | null>;
  /** valid, parsed server messages only (shapes from api/types.ts) */
  onMessage: (msg: WsMessage) => void;
  onStatus: (status: WsStatus) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  /** jitter source in [0, 1) — injected for determinism in tests */
  random: () => number;
};

export type WsController = {
  /** begins the connect loop; idempotent */
  start(): void;
  /** closes the socket and cancels every timer; idempotent */
  stop(): void;
  /** foreground nudge: a pending backoff wait retries NOW; otherwise no-op */
  kick(): void;
};

export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_CAP_MS = 30_000;
/** a connection open this long counts as stable and resets the backoff */
export const STABLE_OPEN_MS = 10_000;

/** Exponential backoff with uniform jitter in [½·raw, raw]. */
export function backoffDelayMs(attempt: number, random: () => number): number {
  const raw = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return raw / 2 + random() * (raw / 2);
}

/** Parse a wire frame into a WsMessage, or null for anything malformed. */
export function parseWsMessage(data: unknown): WsMessage | null {
  if (typeof data !== 'string') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object') return null;
  const msg = raw as { type?: unknown; event?: unknown };
  if (msg.type === 'event' || msg.type === 'event_reminder') {
    return msg.event !== null && typeof msg.event === 'object' ? (raw as WsMessage) : null;
  }
  if (msg.type === 'event_resolved' || msg.type === 'ping') return raw as WsMessage;
  return null;
}

export function createWsController(deps: SocketDeps): WsController {
  let status: WsStatus = 'idle';
  let running = false;
  let gen = 0; // bumped by stop() to void in-flight async continuations
  let sock: WsLike | null = null;
  let attempt = 0;
  let backoffTimer: unknown = null;
  let stableTimer: unknown = null;
  /** the previous close was a 4401 and no stable open happened since */
  let unstable4401 = false;

  const setStatus = (s: WsStatus) => {
    status = s;
    deps.onStatus(s);
  };

  const clearStableTimer = () => {
    if (stableTimer != null) {
      deps.clearTimeout(stableTimer);
      stableTimer = null;
    }
  };

  const clearBackoffTimer = () => {
    if (backoffTimer != null) {
      deps.clearTimeout(backoffTimer);
      backoffTimer = null;
    }
  };

  const detach = (s: WsLike) => {
    s.onopen = s.onmessage = s.onerror = s.onclose = null;
  };

  const openSocket = (token: string) => {
    const s = deps.createSocket(`${deps.url}?token=${encodeURIComponent(token)}`);
    sock = s;

    s.onopen = () => {
      setStatus('open');
      stableTimer = deps.setTimeout(() => {
        stableTimer = null;
        attempt = 0;
        unstable4401 = false;
      }, STABLE_OPEN_MS);
    };

    s.onmessage = (e) => {
      const msg = parseWsMessage(e.data);
      if (!msg) return;
      if (msg.type === 'ping') s.send(JSON.stringify({ type: 'pong' }));
      deps.onMessage(msg);
    };

    // RN follows every error with a close event — the close handler reconnects.
    s.onerror = () => {};

    s.onclose = (e) => {
      detach(s);
      sock = null;
      clearStableTimer();
      if (e?.code === 4401) void handleAuthClose();
      else {
        unstable4401 = false;
        scheduleReconnect();
      }
    };
  };

  const connect = async () => {
    const myGen = gen;
    let token = deps.getAccessToken();
    if (!token) {
      token = await deps.refreshAccessToken();
      if (gen !== myGen || !running) return;
    }
    if (!token) {
      running = false;
      setStatus('stopped');
      return;
    }
    openSocket(token);
  };

  const scheduleReconnect = () => {
    setStatus('reconnecting');
    backoffTimer = deps.setTimeout(
      () => {
        backoffTimer = null;
        void connect();
      },
      backoffDelayMs(attempt, deps.random)
    );
    attempt += 1;
  };

  const handleAuthClose = async () => {
    const consecutive = unstable4401;
    unstable4401 = true;
    setStatus('reconnecting');
    const myGen = gen;
    const token = await deps.refreshAccessToken();
    if (gen !== myGen || !running) return;
    if (!token) {
      running = false;
      setStatus('stopped');
      return;
    }
    if (consecutive) scheduleReconnect();
    else openSocket(token);
  };

  return {
    start() {
      if (running) return;
      running = true;
      attempt = 0;
      unstable4401 = false;
      setStatus('connecting');
      void connect();
    },

    stop() {
      if (status === 'stopped') return;
      running = false;
      gen += 1;
      clearBackoffTimer();
      clearStableTimer();
      if (sock) {
        detach(sock);
        sock.close(1000);
        sock = null;
      }
      setStatus('stopped');
    },

    kick() {
      if (backoffTimer == null) return;
      clearBackoffTimer();
      void connect();
    },
  };
}
