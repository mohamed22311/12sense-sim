import {
  isKnown,
  isResolved,
  isSnoozed,
  LIFECYCLE_CONFIG,
  Lifecycle,
  lifecycleOf,
  packChunks,
  pruneLifecycle,
  recordLifecycle,
  snoozedUntil,
  unpackChunks,
} from '../realtime/eventLifecycle';

const T0 = Date.UTC(2026, 6, 31, 12, 0, 0);
const mins = (n: number) => n * 60_000;

/** the same UTF-8 measure the packer uses — `.length` would under-count */
const utf8Bytes = (s: string): number =>
  [...s].reduce((n, ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return n + (code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4);
  }, 0);

/** apply a sequence of transitions to an empty lifecycle */
const seq = (
  steps: [id: string, state: Parameters<typeof recordLifecycle>[2], atMs?: number, until?: number][],
): Lifecycle =>
  steps.reduce<Lifecycle>(
    (acc, [id, state, atMs, until]) => recordLifecycle(acc, id, state, atMs ?? T0, until),
    [],
  );

describe('recordLifecycle — precedence (a record must never erase a fact)', () => {
  it('records a first transition', () => {
    const l = seq([['e1', 'delivered']]);
    expect(lifecycleOf(l, 'e1')).toBe('delivered');
    expect(isKnown(l, 'e1')).toBe(true);
  });

  it('advances delivered → snoozed → answered', () => {
    const l = seq([
      ['e1', 'delivered'],
      ['e1', 'snoozed', T0 + 1, T0 + mins(5)],
      ['e1', 'answered', T0 + 2],
    ]);
    expect(lifecycleOf(l, 'e1')).toBe('answered');
  });

  it('resolved is terminal — nothing walks it back', () => {
    const l = seq([
      ['e1', 'resolved'],
      ['e1', 'delivered', T0 + 1],
      ['e1', 'snoozed', T0 + 2, T0 + mins(5)],
      ['e1', 'answered', T0 + 3],
    ]);
    expect(lifecycleOf(l, 'e1')).toBe('resolved');
    expect(isResolved(l, 'e1')).toBe(true);
  });

  it('answered is never downgraded to delivered (a redelivery is not an un-answer)', () => {
    const l = seq([
      ['e1', 'answered'],
      ['e1', 'delivered', T0 + 1],
    ]);
    expect(lifecycleOf(l, 'e1')).toBe('answered');
  });

  it('an ACK after a snooze wins — ACK beats SNOOZE (Constitution II)', () => {
    const l = seq([
      ['e1', 'snoozed', T0, T0 + mins(5)],
      ['e1', 'answered', T0 + 1],
    ]);
    expect(lifecycleOf(l, 'e1')).toBe('answered');
    expect(isSnoozed(l, 'e1')).toBe(false);
  });

  it('a resolution always lands, whatever the worker had answered', () => {
    const l = seq([
      ['e1', 'answered'],
      ['e1', 'resolved', T0 + 1],
    ]);
    expect(lifecycleOf(l, 'e1')).toBe('resolved');
  });

  it('a newer snooze replaces the pending one (latest wins)', () => {
    const l = seq([
      ['e1', 'snoozed', T0, T0 + mins(2)],
      ['e1', 'snoozed', T0 + mins(1), T0 + mins(9)],
    ]);
    expect(snoozedUntil(l, 'e1')).toBe(T0 + mins(9));
  });

  it('keeps unrelated events independent', () => {
    const l = seq([
      ['e1', 'resolved'],
      ['e2', 'delivered'],
    ]);
    expect(isResolved(l, 'e1')).toBe(true);
    expect(isResolved(l, 'e2')).toBe(false);
    expect(lifecycleOf(l, 'e2')).toBe('delivered');
  });

  /**
   * The regression that produced an alarm on every app open: `delivered` used to
   * rank BELOW `snoozed`, so the re-pop that answers a snooze was silently
   * discarded. The event stayed `snoozed`, and every reconnect resync saw
   * "snoozed, expired" again and re-alarmed — forever.
   */
  it('a re-pop CONSUMES the snooze it answers', () => {
    const l = seq([
      ['e1', 'snoozed', T0, T0 + mins(5)],
      ['e1', 'delivered', T0 + mins(5)],
    ]);
    expect(lifecycleOf(l, 'e1')).toBe('delivered');
    expect(isSnoozed(l, 'e1')).toBe(false);
    expect(snoozedUntil(l, 'e1')).toBeUndefined();
  });

  it('supports the full deliver → snooze → re-deliver → snooze cycle', () => {
    const l = seq([
      ['e1', 'delivered', T0],
      ['e1', 'snoozed', T0 + 1, T0 + mins(5)],
      ['e1', 'delivered', T0 + mins(5)],
      ['e1', 'snoozed', T0 + mins(5) + 1, T0 + mins(10)],
    ]);
    expect(lifecycleOf(l, 'e1')).toBe('snoozed');
    expect(snoozedUntil(l, 'e1')).toBe(T0 + mins(10));
  });

  it('a redelivery still never downgrades a terminal answer', () => {
    for (const terminal of ['answered', 'resolved'] as const) {
      const l = seq([
        ['e1', terminal, T0],
        ['e1', 'delivered', T0 + 1],
        ['e1', 'snoozed', T0 + 2, T0 + mins(5)],
      ]);
      expect(lifecycleOf(l, 'e1')).toBe(terminal);
    }
  });

  it('an unknown id reports nothing (never a guessed state)', () => {
    const l = seq([['e1', 'delivered']]);
    expect(lifecycleOf(l, 'nope')).toBeUndefined();
    expect(isKnown(l, 'nope')).toBe(false);
    expect(isResolved(l, 'nope')).toBe(false);
    expect(isSnoozed(l, 'nope')).toBe(false);
  });

  it('ignores an empty/whitespace id rather than storing a junk key', () => {
    expect(recordLifecycle([], '', 'resolved', T0)).toEqual([]);
    expect(recordLifecycle([], '   ', 'resolved', T0)).toEqual([]);
  });
});

describe('isSnoozed / snoozedUntil', () => {
  it('reports a live snooze and its expiry', () => {
    const l = seq([['e1', 'snoozed', T0, T0 + mins(5)]]);
    expect(isSnoozed(l, 'e1')).toBe(true);
    expect(snoozedUntil(l, 'e1')).toBe(T0 + mins(5));
  });

  it('a snooze whose expiry the server never sent still reads as snoozed', () => {
    const l = seq([['e1', 'snoozed', T0]]);
    expect(isSnoozed(l, 'e1')).toBe(true);
    expect(snoozedUntil(l, 'e1')).toBeUndefined();
  });
});

describe('pruning — bounded by count and by age', () => {
  it('keeps the newest maxRecords, drops the oldest', () => {
    let l: Lifecycle = [];
    for (let i = 0; i < LIFECYCLE_CONFIG.maxRecords + 10; i++) {
      l = recordLifecycle(l, `e${i}`, 'delivered', T0 + i);
    }
    expect(l).toHaveLength(LIFECYCLE_CONFIG.maxRecords);
    expect(isKnown(l, 'e0')).toBe(false); // oldest evicted
    expect(isKnown(l, `e${LIFECYCLE_CONFIG.maxRecords + 9}`)).toBe(true);
  });

  it('drops entries past maxAgeMs — a day-old resolution is not worth carrying', () => {
    const old = seq([['stale', 'resolved', T0]]);
    const pruned = pruneLifecycle(old, T0 + LIFECYCLE_CONFIG.maxAgeMs + 1);
    expect(pruned).toEqual([]);
  });

  it('keeps an entry that is exactly at the age bound', () => {
    const l = seq([['edge', 'resolved', T0]]);
    expect(pruneLifecycle(l, T0 + LIFECYCLE_CONFIG.maxAgeMs)).toHaveLength(1);
  });

  it('a transition refreshes the entry, so an active event does not age out mid-life', () => {
    let l = seq([['e1', 'delivered', T0]]);
    l = recordLifecycle(l, 'e1', 'snoozed', T0 + LIFECYCLE_CONFIG.maxAgeMs - 1, undefined);
    expect(pruneLifecycle(l, T0 + LIFECYCLE_CONFIG.maxAgeMs + 1)).toHaveLength(1);
  });
});

describe('pack / unpack — the SecureStore round trip', () => {
  it('round-trips a lifecycle unchanged', () => {
    const l = seq([
      ['e1', 'resolved', T0],
      ['e2', 'snoozed', T0 + 1, T0 + mins(5)],
      ['e3', 'delivered', T0 + 2],
    ]);
    expect(unpackChunks(packChunks(l))).toEqual(l);
  });

  it('stays inside the per-value byte budget and the chunk count', () => {
    let l: Lifecycle = [];
    for (let i = 0; i < LIFECYCLE_CONFIG.maxRecords; i++) {
      l = recordLifecycle(l, `event-uuid-${i}-aaaaaaaa-bbbb-cccc`, 'snoozed', T0 + i, T0 + mins(5));
    }
    const chunks = packChunks(l);
    expect(chunks.length).toBeLessThanOrEqual(LIFECYCLE_CONFIG.maxChunks);
    for (const c of chunks) {
      expect(utf8Bytes(c)).toBeLessThanOrEqual(LIFECYCLE_CONFIG.maxBytesPerChunk);
    }
  });

  it('survives an unreadable or absent chunk instead of throwing', () => {
    expect(unpackChunks([null, undefined, 'not json', '{"not":"an array"}'])).toEqual([]);
  });

  it('drops malformed records but keeps the good ones in the same chunk', () => {
    const raw = JSON.stringify([
      { id: 'good', s: 'resolved', at: T0 },
      { id: '', s: 'resolved', at: T0 },
      { id: 'bad-state', s: 'exploded', at: T0 },
      { id: 'bad-at', s: 'resolved', at: 'yesterday' },
    ]);
    const out = unpackChunks([raw]);
    expect(out.map((e) => e.id)).toEqual(['good']);
  });

  it('de-dupes an id that somehow appears in two chunks, newest winning', () => {
    const a = JSON.stringify([{ id: 'e1', s: 'delivered', at: T0 }]);
    const b = JSON.stringify([{ id: 'e1', s: 'resolved', at: T0 + 10 }]);
    expect(unpackChunks([a, b])).toEqual([{ id: 'e1', s: 'resolved', at: T0 + 10 }]);
  });
});
