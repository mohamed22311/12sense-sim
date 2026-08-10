/* VENDORED — DO NOT EDIT.
 * Source: TwelveSense-TT-MobileApp/Thalamus/src/realtime/alertDedup.ts @ 15b11d4
 * Sync check: `npm run check:vendor`. Fix drift by re-copying, never by editing.
 */
/**
 * WS ↔ FCM de-duplication (S2-MB6) — the shared claim registry that keeps one
 * event from being handled twice when it arrives over BOTH transports.
 *
 * An event reaches the phone two ways: the foreground WebSocket (WsProvider)
 * and the background FCM push (backgroundAlertHandler). When the app is
 * backgrounded-but-alive the socket is still open AND the FCM background
 * handler fires — same JS runtime, same module scope — so both would run the
 * gate for the same `event.id`. `claim(id)` lets exactly the FIRST caller
 * proceed; every later caller (this runtime) drops.
 *
 * Scope by runtime:
 *  - foreground: WS is authoritative (FCM foreground `onMessage` is ignored);
 *  - background, app alive: WS and the FCM handler race — first `claim` wins;
 *  - app killed: only the headless FCM handler runs (fresh module scope, empty
 *    set) → it claims and handles once, no competitor.
 *
 * Claims are keyed by **delivery kind + event id** (S3-MB5). The contract says
 * phones dedupe an `event_reminder` on `event_id` + `type`, and rightly so: a
 * snooze re-alert is a second, deliberate delivery of an event whose original
 * broadcast this phone already claimed, and a bare-id key would swallow it.
 * `claimKey('reminder', id)` and `claimKey('event', id)` are therefore distinct
 * claims that dedupe only against their own transport race.
 *
 * Pure and self-contained (Constitution III): an in-memory, insertion-order
 * evicted set — no timers, no I/O. The bound mirrors the gate/responder
 * (TRACKED_MAX = 50): ample for a demo site. This registry is deliberately
 * SESSION-scoped; the cross-restart half of the duplicate guard is the persisted
 * `eventLifecycle` record, which the reconnect resync consults alongside it.
 */

/** how many recent event ids to remember; oldest evicted past this */
export const CLAIM_MAX = 50;

/** which delivery a claim is for — a reminder is not a repeat of the broadcast */
export type ClaimKind = 'event' | 'reminder';

/**
 * The registry key for one delivery of one event (contract: event_id + type).
 * An unusable id yields the empty key, which `claim` never dedupes — a
 * malformed payload must not be silently swallowed (Constitution V).
 *
 * `nonce` distinguishes repeat deliveries that are genuinely distinct. A
 * reminder passes its `snoozed_until`: a worker may snooze the same event more
 * than once, and each cycle earns its own re-alert. Without it, the first
 * reminder's claim would suppress every later one for the life of the process —
 * a re-alert that silently stops happening, which is the failure this whole
 * ticket exists to prevent. Both transports derive it from the same server
 * field, so the WS and FCM copies of ONE reminder still collapse to one alarm.
 */
export const claimKey = (kind: ClaimKind, eventId: string, nonce?: string | null): string => {
  const id = eventId?.trim();
  if (!id) return '';
  const suffix = nonce?.trim();
  return suffix ? `${kind}:${id}:${suffix}` : `${kind}:${id}`;
};

const claimed = new Set<string>();

/**
 * Claim one delivery for handling — pass a `claimKey(kind, id)`. Returns `true`
 * the first time a key is seen (caller should handle it) and `false` on every
 * repeat (caller should drop). Empty/whitespace keys are never deduped: they
 * always return `true` so a malformed payload is not silently swallowed
 * (safe-fallback, Constitution V).
 */
export function claim(eventId: string): boolean {
  if (!eventId || !eventId.trim()) return true;
  if (claimed.has(eventId)) return false;
  claimed.add(eventId);
  if (claimed.size > CLAIM_MAX) {
    const oldest = claimed.values().next().value;
    if (oldest !== undefined) claimed.delete(oldest);
  }
  return true;
}

/** Whether an id has already been claimed (without claiming it). */
export function isClaimed(eventId: string): boolean {
  return claimed.has(eventId);
}

/** Test seam — drop all remembered ids. Not used in app code. */
export function resetClaims(): void {
  claimed.clear();
}
