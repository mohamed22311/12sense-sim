/**
 * JSON client for the Twelve Senses server.
 *
 * The one structural difference from the app's `api/client.ts`: the phone has a
 * single session and reads its token from a global provider, while the
 * simulator holds sixty and must pass one per call. Everything else — the error
 * envelope, the 422 array flattening, the non-JSON guard — mirrors the app,
 * because the failures it learned to handle are the failures this will meet.
 */
import { API_BASE_URL } from './config';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    opts: { code?: string; status: number; details?: Record<string, unknown> },
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = opts.code ?? 'unknown';
    this.status = opts.status;
    this.details = opts.details;
  }
}

export type RequestOptions = {
  body?: unknown;
  token?: string | null;
  /** abort after this long; `fetch` has no timeout of its own */
  timeoutMs?: number;
  signal?: AbortSignal;
};

export const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * FastAPI answers a 422 with `detail` as an ARRAY of validation errors, which
 * is neither a string nor the object a 409 carries. Left unhandled the message
 * collapses to an empty statusText and the caller learns nothing — the exact
 * failure that made the app report a missing `code` field as "can't reach the
 * server". The leading `body`/`query` scope of `loc` is dropped.
 */
function validationMessage(detail: unknown): string | undefined {
  if (!Array.isArray(detail) || detail.length === 0) return undefined;
  const parts = detail
    .map((item) => {
      if (item === null || typeof item !== 'object') return null;
      const { loc, msg } = item as { loc?: unknown; msg?: unknown };
      if (typeof msg !== 'string') return null;
      const field = Array.isArray(loc) ? loc.slice(1).filter((p) => typeof p === 'string') : [];
      return field.length > 0 ? `${field.join('.')}: ${msg}` : msg;
    })
    .filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join('; ') : undefined;
}

export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  { body, token, timeoutMs = DEFAULT_TIMEOUT_MS, signal }: RequestOptions = {},
): Promise<T> {
  const controller = new AbortController();
  /*
    Distinguish our own timeout from a caller's cancellation.

    `AbortController.abort()` produces "signal is aborted without reason",
    which is what an operator saw when a slow server ate a raise: a message
    that names no cause, no consequence and no next step. Recording which of
    the two fired lets the catch below say something true instead.
  */
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  if (signal?.aborted) controller.abort();

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();

    // Not everything on the wire is JSON: the AWS edge answers an unhealthy
    // backend with an HTML 502/503. An unguarded parse throws a SyntaxError and
    // erases the status, which every caller branches on.
    let data: unknown;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new ApiError(res.statusText || `HTTP ${res.status}`, {
          code: 'non_json_response',
          status: res.status,
        });
      }
    }

    if (!res.ok) {
      const detail = (data as { detail?: unknown } | undefined)?.detail;
      const structured =
        detail !== null && typeof detail === 'object' && !Array.isArray(detail)
          ? (detail as Record<string, unknown>)
          : undefined;
      const code = typeof structured?.code === 'string' ? structured.code : undefined;

      throw new ApiError(
        validationMessage(detail) ??
          code ??
          (typeof detail === 'string' ? detail : res.statusText) ??
          `HTTP ${res.status}`,
        { code, status: res.status, details: structured },
      );
    }

    return data as T;
  } catch (error) {
    if (timedOut) {
      /*
        A timeout is not a failure — it is an unknown.

        The request may well have been served: the alert raised, the sixty
        rows written, and only the answer lost. Reporting it as "failed" leads
        an operator to raise it again, and the second one is a second real
        alert rather than a retry. Say what is actually known.
      */
      throw new ApiError(
        `No answer from the server within ${Math.round(timeoutMs / 1000)}s. ` +
          'It may still have gone through — check before trying again.',
        { code: 'timeout', status: 0 },
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Client-generated idempotency key for response and analytics POSTs. */
export function newClientEventId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
