/**
 * The live channel, using the app's own connection policy.
 *
 * `phone/vendor/realtime/socket.ts` takes its socket, timers and jitter source
 * as dependencies, so the whole of the reconnect behaviour — exponential
 * backoff with jitter, the stable-open reset, the 4401 single-flight refresh
 * and its consecutive-failure guard, answering `ping` with `pong` — is the
 * app's, unmodified. This module only supplies the browser's implementations.
 *
 * WebSockets are exempt from CORS, so this connects straight to the deployment
 * even while REST goes through the dev proxy.
 */
import type { WsMessage } from '@/api/types';
import {
  createWsController,
  type WsController,
  type WsLike,
  type WsStatus,
} from '@/phone/vendor/realtime/socket';
import { WS_URL } from './config';

/** The browser WebSocket already has the shape the controller drives. */
export function browserSocketFactory(url: string): WsLike {
  return new WebSocket(url) as unknown as WsLike;
}

export type PhoneSocketOptions = {
  getAccessToken: () => string | null;
  refreshAccessToken: () => Promise<string | null>;
  onMessage: (msg: WsMessage) => void;
  onStatus: (status: WsStatus) => void;
  /** overridable so tests can drive a fake */
  createSocket?: (url: string) => WsLike;
  url?: string;
};

export function connectPhoneSocket(opts: PhoneSocketOptions): WsController {
  return createWsController({
    url: opts.url ?? WS_URL,
    createSocket: opts.createSocket ?? browserSocketFactory,
    getAccessToken: opts.getAccessToken,
    refreshAccessToken: opts.refreshAccessToken,
    onMessage: opts.onMessage,
    onStatus: opts.onStatus,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    random: Math.random,
  });
}
