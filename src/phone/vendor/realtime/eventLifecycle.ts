/* VENDORED — DO NOT EDIT.
 * Source: TwelveSense-TT-MobileApp/Thalamus/src/realtime/eventLifecycle.ts @ 15b11d4
 * Sync check: `npm run check:vendor`. Fix drift by re-copying, never by editing.
 */
/**
 * What this phone knows about each group event — pure, and the fact that
 * survives a process death (S3-MB5).
 *
 * Every guard the group-alert lifecycle relied on used to be in-memory only:
 * `alertDedup`'s claim set, the gate's `resolvedIds`, the responder's `entries`
 * and `resolvedIds`. All three are empty in a fresh process, so a phone that was
 * killed and re-launched had forgotten which events it already delivered,
 * already answered, and already saw resolved. The consequence the ticket names:
 * an `event_resolved` that arrives while the app is dead is lost, and the
 * server's later `event_reminder` re-alarms the worker for an event a teammate
 * already handled.
 *
 * This module is the record that closes that gap. It holds one small entry per
 * event id and nothing else — no payloads, no context, no worker data (the
 * alert's content lives in `history/records.ts`, its analytics in the outbox).
 *
 * **The precedence rules are the point** (mirroring `analytics/reconcile.ts`):
 * a record must never erase a fact. `answered` and `resolved` are the facts —
 * neither is downgraded by a later redelivery, and an ACK after a snooze wins
 * because ACK beats SNOOZE (Constitution II). `delivered` and `snoozed` are not
 * facts about the worker, they are where the event currently stands, and they
 * alternate freely: deliver → snooze → re-deliver → snooze. A newer snooze
 * replaces the pending one (latest wins, as the server's reminder scheduler
 * treats it), and a re-pop **consumes** the snooze it answers.
 *
 * Pure and I/O-free (Constitution III); `eventLifecycleStore.ts` is the
 * SecureStore shell around it.
 */

/**
 * What the phone last knew about an event.
 *
 *  - `delivered` — an alert was shown for it (WS pop, FCM pop, or a reminder
 *    re-pop). This is the cross-restart half of the duplicate guard.
 *  - `snoozed`   — the worker snoozed; the SERVER holds the re-alert (the phone
 *    arms no timer — design doc §5). `until` is the reported `snoozed_until`.
 *  - `answered`  — the worker acknowledged or rejected: terminal, theirs.
 *  - `resolved`  — the event is over (a teammate's ACK, our own, or a 409).
 *    Terminal and absolute: it voids a showing alert AND a pending snooze.
 */
export type LifecycleState = 'delivered' | 'snoozed' | 'answered' | 'resolved';

/** Short keys: this is packed into ~2 KB encrypted values (see packChunks). */
export type LifecycleEntry = {
  id: string;
  s: LifecycleState;
  /** epoch ms of the last transition — the recency key for eviction */
  at: number;
  /** epoch ms of `snoozed_until`, when the state is `snoozed` and we know it */
  until?: number;
};

/** Newest-first by `at`. */
export type Lifecycle = LifecycleEntry[];

export const LIFECYCLE_CONFIG = {
  /** SecureStore documents ~2048 bytes per value; stay under it with headroom */
  maxBytesPerChunk: 1_800,
  /** two encrypted values is ample — an entry is ~60 bytes */
  maxChunks: 2,
  /** how many events this phone remembers; matches the outbox/history bound */
  maxRecords: 60,
  /**
   * How long an entry is worth carrying. A day covers any realistic shift plus
   * the outbox's own 24 h give-up window, after which a resolution can no longer
   * cancel anything that is still live and a stale entry would only suppress a
   * legitimate re-broadcast of a recycled id.
   */
  maxAgeMs: 24 * 60 * 60_000,
} as const;

const STATES: LifecycleState[] = ['delivered', 'snoozed', 'answered', 'resolved'];

/**
 * Which states are **facts that must never be walked back**, and which are just
 * where the event currently stands.
 *
 * `answered` (the worker acknowledged or rejected) and `resolved` (the event is
 * over) are terminal: nothing may downgrade them, and only a resolution may
 * supersede an answer. `delivered` and `snoozed` are **transient** and
 * legitimately alternate — deliver → snooze → re-deliver → snooze → … — which
 * is the whole shape of a snooze re-alert.
 *
 * This started life as a 4-level monotonic rank (`delivered:0 < snoozed:1 <
 * answered:2 < resolved:3`), which conflated *progress* with *terminality* and
 * had one badly wrong consequence: `markEventDelivered` after a snooze ranked
 * LOWER and was silently discarded, so a re-popped event stayed `snoozed`
 * forever. Every subsequent reconnect resync then saw "snoozed, expired" again
 * and re-alarmed — an alert on every single app open, for the life of the
 * record. A re-pop consumes the snooze; the model has to say so.
 */
const TERMINAL: LifecycleState[] = ['answered', 'resolved'];

const isTerminal = (state: LifecycleState): boolean => TERMINAL.includes(state);

/**
 * May `next` be written over `existing`? Terminal states hold, except that a
 * resolution always lands (our own ACK ends the event too, and a teammate's
 * beats whatever this worker had answered).
 */
const supersedes = (next: LifecycleState, existing: LifecycleState): boolean => {
  if (!isTerminal(existing)) return true;
  return next === 'resolved';
};

const usableId = (id: string): boolean => typeof id === 'string' && id.trim().length > 0;

const find = (entries: Lifecycle, id: string): LifecycleEntry | undefined =>
  usableId(id) ? entries.find((e) => e.id === id) : undefined;

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

/** The recorded state, or undefined for an event this phone has never seen. */
export function lifecycleOf(entries: Lifecycle, id: string): LifecycleState | undefined {
  return find(entries, id)?.s;
}

/**
 * Is this event over? The reminder guard: a reminder for a resolved event is
 * dropped even in a process that was not running when the resolution arrived.
 */
export function isResolved(entries: Lifecycle, id: string): boolean {
  return lifecycleOf(entries, id) === 'resolved';
}

/** Is a snooze pending? (The re-alert itself is the server's; see design §5.) */
export function isSnoozed(entries: Lifecycle, id: string): boolean {
  return lifecycleOf(entries, id) === 'snoozed';
}

/** The reported `snoozed_until` in epoch ms, when one was recorded. */
export function snoozedUntil(entries: Lifecycle, id: string): number | undefined {
  const entry = find(entries, id);
  return entry?.s === 'snoozed' ? entry.until : undefined;
}

/**
 * Has this phone handled this event at all? The cross-restart duplicate guard
 * the resync consults, alongside the in-memory `alertDedup` claims.
 */
export function isKnown(entries: Lifecycle, id: string): boolean {
  return find(entries, id) !== undefined;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Record a transition, returning the next lifecycle (never mutating the input).
 *
 * The transition is dropped when it would walk the record backwards — a
 * `delivered` after an `answered`, anything after a `resolved`. A same-rank
 * `snoozed` is allowed through so a newer snooze replaces the pending one.
 *
 * An unusable id is ignored rather than stored: a malformed payload must not
 * take up one of the bounded slots (and `alertDedup` deliberately never dedupes
 * one either — safe fallback, Constitution V).
 */
export function recordLifecycle(
  entries: Lifecycle,
  id: string,
  state: LifecycleState,
  nowMs: number,
  untilMs?: number,
): Lifecycle {
  if (!usableId(id)) return entries;

  const existing = find(entries, id);
  if (existing && !supersedes(state, existing.s)) return entries;
  // an identical terminal repeat carries no new information; a repeated
  // transient one does (a re-delivery, or a new snooze with a new expiry)
  if (existing && existing.s === state && isTerminal(state)) return entries;

  const next: LifecycleEntry = { id, s: state, at: nowMs };
  if (state === 'snoozed' && typeof untilMs === 'number' && Number.isFinite(untilMs)) {
    next.until = untilMs;
  }

  return prune([next, ...entries.filter((e) => e.id !== id)], nowMs);
}

/**
 * Drop what is too old or over the count bound. Newest-first, so the cap is a
 * slice. Exported for the store, which prunes on load: a phone that sat idle
 * for a week should not read back a week-old record it would then re-persist.
 */
export function pruneLifecycle(
  entries: Lifecycle,
  nowMs: number,
  cfg: { maxRecords: number; maxAgeMs: number } = LIFECYCLE_CONFIG,
): Lifecycle {
  return prune(entries, nowMs, cfg);
}

function prune(
  entries: Lifecycle,
  nowMs: number,
  cfg: { maxRecords: number; maxAgeMs: number } = LIFECYCLE_CONFIG,
): Lifecycle {
  return [...entries]
    .filter((e) => nowMs - e.at <= cfg.maxAgeMs)
    .sort((a, b) => b.at - a.at)
    .slice(0, cfg.maxRecords);
}

// ---------------------------------------------------------------------------
// Persistence format (same shape as history/records.ts — one budget, one idiom)
// ---------------------------------------------------------------------------

/** UTF-8 byte length: `.length` under-counts anything outside ASCII. */
function byteLength(s: string): number {
  let bytes = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/**
 * Pack newest-first into at most `maxChunks` values, each under the per-value
 * byte budget. Anything that does not fit is dropped **oldest first**, so the
 * store self-limits rather than failing a write on a worker's phone.
 */
export function packChunks(
  entries: Lifecycle,
  cfg: {
    maxBytesPerChunk: number;
    maxChunks: number;
    maxRecords: number;
  } = LIFECYCLE_CONFIG,
): string[] {
  const sorted = [...entries]
    .filter((e) => e && usableId(e.id) && Number.isFinite(e.at))
    .sort((a, b) => b.at - a.at)
    .slice(0, cfg.maxRecords);

  const chunks: string[] = [];
  let current: LifecycleEntry[] = [];
  let currentJson = '';

  for (const entry of sorted) {
    if (chunks.length >= cfg.maxChunks) break;
    const candidate = [...current, entry];
    const candidateJson = JSON.stringify(candidate);
    if (byteLength(candidateJson) <= cfg.maxBytesPerChunk) {
      current = candidate;
      currentJson = candidateJson;
      continue;
    }
    if (current.length === 0) continue; // one record too large for a whole chunk
    chunks.push(currentJson);
    current = [];
    currentJson = '';
    if (chunks.length >= cfg.maxChunks) break;
    const solo = JSON.stringify([entry]);
    if (byteLength(solo) > cfg.maxBytesPerChunk) continue;
    current = [entry];
    currentJson = solo;
  }
  if (current.length > 0 && chunks.length < cfg.maxChunks) chunks.push(currentJson);
  return chunks;
}

/**
 * Read chunks back. Never throws: an unreadable value is skipped, a malformed
 * record dropped, and a duplicate id resolved in favour of the newer entry —
 * losing the record must degrade to "this phone doesn't remember", never to a
 * crash on the delivery path.
 */
export function unpackChunks(raws: (string | null | undefined)[]): Lifecycle {
  const out: Lifecycle = [];
  for (const raw of raws) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed) if (isEntry(item)) out.push(item);
    } catch {
      // unreadable chunk — skip it
    }
  }
  const byId = new Map<string, LifecycleEntry>();
  for (const entry of out) {
    const seen = byId.get(entry.id);
    if (!seen || entry.at > seen.at) byId.set(entry.id, entry);
  }
  return [...byId.values()].sort((a, b) => b.at - a.at);
}

function isEntry(value: unknown): value is LifecycleEntry {
  if (value === null || typeof value !== 'object') return false;
  const e = value as Partial<LifecycleEntry>;
  return (
    typeof e.id === 'string' &&
    e.id.trim().length > 0 &&
    STATES.includes(e.s as LifecycleState) &&
    typeof e.at === 'number' &&
    Number.isFinite(e.at) &&
    (e.until === undefined || (typeof e.until === 'number' && Number.isFinite(e.until)))
  );
}
