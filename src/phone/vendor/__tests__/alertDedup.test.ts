import { claim, claimKey, CLAIM_MAX, isClaimed, resetClaims } from '../realtime/alertDedup';

describe('alertDedup.claim (WS ↔ FCM de-dup)', () => {
  beforeEach(() => resetClaims());

  it('claims a fresh id once, drops the repeat (the double-fire guard)', () => {
    expect(claim('event-1')).toBe(true); // first transport (e.g. WS) handles it
    expect(claim('event-1')).toBe(false); // second transport (FCM) drops
    expect(claim('event-1')).toBe(false);
  });

  it('tracks unrelated ids independently', () => {
    expect(claim('event-a')).toBe(true);
    expect(claim('event-b')).toBe(true); // a different event is not blocked by a
    expect(claim('event-a')).toBe(false);
    expect(claim('event-b')).toBe(false);
  });

  it('isClaimed reports state without claiming', () => {
    expect(isClaimed('event-x')).toBe(false);
    expect(claim('event-x')).toBe(true);
    expect(isClaimed('event-x')).toBe(true);
  });

  it('evicts the oldest id past CLAIM_MAX — an evicted id can be claimed again', () => {
    expect(claim('oldest')).toBe(true);
    // fill past the bound so 'oldest' is evicted
    for (let i = 0; i < CLAIM_MAX; i++) claim(`filler-${i}`);
    // evicted → treated as fresh again (acceptable: old ids never re-broadcast
    // within a session, so this is a bound, not a correctness hole)
    expect(claim('oldest')).toBe(true);
  });

  it('never dedupes an empty/whitespace id (safe fallback — a malformed push is not swallowed)', () => {
    expect(claim('')).toBe(true);
    expect(claim('')).toBe(true);
    expect(claim('   ')).toBe(true);
  });
});

/**
 * Claims are keyed by delivery kind + event id (S3-MB5). The contract says
 * phones dedupe an `event_reminder` on `event_id` + `type`: a snooze re-alert is
 * a second, deliberate delivery of an event whose broadcast this phone already
 * claimed, and a bare-id key would swallow it.
 */
describe('claimKey — dedupe on event_id + type', () => {
  beforeEach(() => resetClaims());

  it('a reminder is not swallowed by the original broadcast’s claim', () => {
    expect(claim(claimKey('event', 'e1'))).toBe(true);
    expect(claim(claimKey('reminder', 'e1'))).toBe(true); // a different delivery
  });

  it('still collapses two copies of the SAME delivery (the WS/FCM race)', () => {
    expect(claim(claimKey('reminder', 'e1'))).toBe(true);
    expect(claim(claimKey('reminder', 'e1'))).toBe(false);
  });

  it('trims the id so a padded payload is still the same delivery', () => {
    expect(claim(claimKey('event', ' e1 '))).toBe(true);
    expect(claim(claimKey('event', 'e1'))).toBe(false);
  });

  it('yields the empty key for an unusable id, which is never deduped', () => {
    expect(claimKey('event', '')).toBe('');
    expect(claimKey('event', '   ')).toBe('');
    expect(claim(claimKey('event', ''))).toBe(true);
    expect(claim(claimKey('event', ''))).toBe(true);
  });
});

describe('claimKey nonce — a second snooze earns a second re-alert', () => {
  beforeEach(() => resetClaims());

  it('does not let the first reminder suppress a later snooze cycle', () => {
    expect(claim(claimKey('reminder', 'e1', '2026-07-31T12:05:00Z'))).toBe(true);
    // the worker snoozed again; the server fires a NEW reminder
    expect(claim(claimKey('reminder', 'e1', '2026-07-31T12:12:00Z'))).toBe(true);
  });

  it('still collapses the WS and FCM copies of ONE reminder', () => {
    const until = '2026-07-31T12:05:00Z';
    expect(claim(claimKey('reminder', 'e1', until))).toBe(true);
    expect(claim(claimKey('reminder', 'e1', until))).toBe(false);
  });

  it('degrades to the bare key when no snoozed_until is carried', () => {
    expect(claimKey('reminder', 'e1', undefined)).toBe('reminder:e1');
    expect(claimKey('reminder', 'e1', '  ')).toBe('reminder:e1');
    expect(claimKey('reminder', 'e1', null)).toBe('reminder:e1');
  });

  it('an unusable id is still never deduped, nonce or not', () => {
    expect(claimKey('reminder', '', '2026-07-31T12:05:00Z')).toBe('');
  });
});
