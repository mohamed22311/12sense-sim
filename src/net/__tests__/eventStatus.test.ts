import { describe, expect, it } from 'vitest';
import { isEventOpen, type EventStatus } from '@/net/alerts';

/**
 * These exist because the shape was wrong once and nothing caught it.
 *
 * `GET /events/{id}` returns the event inside an envelope, so the status lives
 * at `event.status`. Typed flat, `status.status` compiled fine and read
 * `undefined` forever — every alert looked open, and the panel that was
 * supposed to clear itself never did. A live call found it; a test keeps it
 * found.
 */

const envelope = (status: string): EventStatus => ({
  event: { id: 'evt-1', status },
  tracked: 60,
  counts: { received: 60, ack: 0, snooze: 0, reject: 0 },
});

describe('isEventOpen', () => {
  it('reads the status from inside the envelope, not the top level', () => {
    expect(isEventOpen(envelope('open'))).toBe(true);
    expect(isEventOpen(envelope('resolved'))).toBe(false);
  });

  it('treats an unfamiliar status as still open', () => {
    // Not knowing is not the same as resolved. Dropping a live alarm because
    // the server introduced a status this build has not heard of is the worst
    // available failure, so anything that is not explicitly resolved stays.
    expect(isEventOpen(envelope('acknowledged_partially'))).toBe(true);
    expect(isEventOpen(envelope(''))).toBe(true);
  });
});
