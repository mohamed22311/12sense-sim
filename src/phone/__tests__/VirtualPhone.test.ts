import { describe, expect, it, vi } from 'vitest';
import type { ApiEvent } from '@/api/types';
import { sceneToLatLon } from '@/runtime/geo';
import { VitalsBuffer } from '@/phone/vitalsBuffer';
import { VirtualPhone } from '@/phone/VirtualPhone';
import type { IndividualAlertBody } from '@/phone/outbox';

const ANCHOR = { latitude: 30.04412, longitude: 31.23571 };
/** The default frame: the scene's own origin sits at the anchor. */
const FRAME = () => ({ anchor: ANCHOR, origin: { x: 0, z: 0 } });
const NOW = Date.parse('2026-08-09T12:00:00Z');

const worker = {
  index: 1, userId: 'u-1', username: 'sim-x-w01', email: 'w01@x.io',
  password: 'p', firstName: 'A', lastName: 'B', dateOfBirth: '1992-01-11',
  accessToken: 'tok', refreshToken: 'ref',
};

/**
 * An event 10 m from the scene origin on floor 4, radius 75 m.
 *
 * Typed explicitly as the vendored `ApiEvent` (rather than left to inference)
 * so the object literal's `source` / `severity` / `status` string fields are
 * checked against their real union types under strict mode instead of
 * widening to `string`.
 */
const eventAt = (x: number, z: number, floor: string | null): ApiEvent => ({
  id: 'e-1', source: 'sim', asset_id: 'CHILLER-07', asset_label: 'Chiller 07',
  ...sceneToLatLon(ANCHOR, x, z),
  alert_radius_m: 75, floor, zone_id: null, severity: 'high',
  type: 'ammonia_threshold', message: 'Ammonia threshold exceeded',
  status: 'open', created_at: '2026-08-09T12:00:00Z',
});

const build = (ctx: Partial<{ x: number; z: number; floor: string | null; moving: boolean; noiseDbFs: number , noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true}>) => {
  const posted: { action: string; body: unknown }[] = [];
  const buffer = new VitalsBuffer();
  buffer.seed(62, NOW);
  const phone = new VirtualPhone({
    worker,
    frame: FRAME,
    buffer,
    getContext: () => ({
      position: { x: ctx.x ?? 0, z: ctx.z ?? 0 },
      floor: ctx.floor === undefined ? '4' : ctx.floor,
      moving: ctx.moving ?? false,
      noiseDbFs: ctx.noiseDbFs ?? -40,
      noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true,
    }),
    postResponse: async (_t, _e, b) => {
      posted.push({ action: b.action, body: b });
      return { event_id: 'e-1', worker_state: 'received' };
    },
    postIndividualAlert: async () => ({ id: 'ia-1' }),
  });
  return { phone, posted, buffer };
};

describe('VirtualPhone — group alerts', () => {
  it('pops for a worker on the same floor and inside the radius', async () => {
    const { phone, posted } = build({ x: 5, z: 5, floor: '4' });
    await phone.handleEvent(eventAt(0, 0, '4'), NOW);

    expect(phone.activeAlert).not.toBeNull();
    expect(posted.map((p) => p.action)).toContain('popped');
  });

  it('ignores a worker on a different floor and reports it', async () => {
    const { phone, posted } = build({ x: 5, z: 5, floor: '2' });
    await phone.handleEvent(eventAt(0, 0, '4'), NOW);

    expect(phone.activeAlert).toBeNull();
    expect(posted.map((p) => p.action)).toContain('ignored_out_of_range');
  });

  it('ignores a worker beyond the radius', async () => {
    const { phone, posted } = build({ x: 400, z: 0, floor: '4' });
    await phone.handleEvent(eventAt(0, 0, '4'), NOW);

    expect(phone.activeAlert).toBeNull();
    expect(posted.map((p) => p.action)).toContain('ignored_out_of_range');
  });

  it('suppresses sound in loud noise and visual while moving', async () => {
    const { phone } = build({ x: 1, z: 1, floor: '4', moving: true, noiseDbFs: -10 , noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true});
    await phone.handleEvent(eventAt(0, 0, '4'), NOW);

    expect(phone.activeAlert?.modality).toEqual({ visual: false, haptic: true, sound: false });
  });

  it('fires all three channels when still and quiet — haptic is never suppressed', async () => {
    const { phone } = build({ x: 1, z: 1, floor: '4', moving: false, noiseDbFs: -60 , noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true});
    await phone.handleEvent(eventAt(0, 0, '4'), NOW);

    expect(phone.activeAlert?.modality).toEqual({ visual: true, haptic: true, sound: true });
  });

  it('shows visual and haptic but suppresses sound when still and loud', async () => {
    const { phone } = build({ x: 1, z: 1, floor: '4', moving: false, noiseDbFs: -10 , noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true});
    await phone.handleEvent(eventAt(0, 0, '4'), NOW);

    expect(phone.activeAlert?.modality).toEqual({ visual: true, haptic: true, sound: false });
  });

  it('fires haptic and sound but suppresses visual when moving and quiet', async () => {
    const { phone } = build({ x: 1, z: 1, floor: '4', moving: true, noiseDbFs: -60 , noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true});
    await phone.handleEvent(eventAt(0, 0, '4'), NOW);

    expect(phone.activeAlert?.modality).toEqual({ visual: false, haptic: true, sound: true });
  });

  it('clears the alert when the server resolves the event', async () => {
    const { phone } = build({ x: 1, z: 1, floor: '4' });
    await phone.handleEvent(eventAt(0, 0, '4'), NOW);
    phone.handleResolved('e-1');

    expect(phone.activeAlert).toBeNull();
  });

  it('ignores a duplicate delivery of the same event', async () => {
    const { phone, posted } = build({ x: 1, z: 1, floor: '4' });
    await phone.handleEvent(eventAt(0, 0, '4'), NOW);
    await phone.handleEvent(eventAt(0, 0, '4'), NOW + 500);

    expect(posted.filter((p) => p.action === 'popped')).toHaveLength(1);
  });

  it('posts an ack and clears', async () => {
    const { phone, posted } = build({ x: 1, z: 1, floor: '4' });
    await phone.handleEvent(eventAt(0, 0, '4'), NOW);
    await phone.ack(NOW + 4_000);

    expect(posted.map((p) => p.action)).toContain('ack');
    expect(phone.activeAlert).toBeNull();
  });
});

describe('VirtualPhone — received is posted on receipt, before the gate decides', () => {
  it('posts received then popped, in that order, for an in-range delivery', async () => {
    const { phone, posted } = build({ x: 1, z: 1, floor: '4' });
    await phone.handleEvent(eventAt(0, 0, '4'), NOW);

    expect(posted.map((p) => p.action)).toEqual(['received', 'popped']);
  });

  it('posts received then ignored_out_of_range, in that order, for an out-of-range delivery', async () => {
    const { phone, posted } = build({ x: 400, z: 0, floor: '4' });
    await phone.handleEvent(eventAt(0, 0, '4'), NOW);

    expect(posted.map((p) => p.action)).toEqual(['received', 'ignored_out_of_range']);
  });

  it('posts exactly one received in total for a duplicate delivery of the same event', async () => {
    const { phone, posted } = build({ x: 1, z: 1, floor: '4' });
    await phone.handleEvent(eventAt(0, 0, '4'), NOW);
    await phone.handleEvent(eventAt(0, 0, '4'), NOW + 500);

    expect(posted.filter((p) => p.action === 'received')).toHaveLength(1);
  });

  it('a failing received report does not prevent the alert from popping, and does not escape as a rejection', async () => {
    const posted: { action: string }[] = [];
    const buffer = new VitalsBuffer();
    buffer.seed(62, NOW);
    const phone = new VirtualPhone({
      worker,
      frame: FRAME,
      buffer,
      getContext: () => ({ position: { x: 1, z: 1 }, floor: '4', moving: false, noiseDbFs: -40 , noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true}),
      // Only the 'received' report fails — 'popped' still succeeds — so the
      // test isolates that a received failure specifically cannot block the
      // gate decision or the report that follows it.
      postResponse: async (_t, _e, b) => {
        if (b.action === 'received') throw new Error('received post failed');
        posted.push({ action: b.action });
        return { event_id: 'e-1', worker_state: 'received' };
      },
      postIndividualAlert: async () => ({ id: 'ia-1' }),
    });

    await expect(phone.handleEvent(eventAt(0, 0, '4'), NOW)).resolves.toBeUndefined();

    expect(phone.activeAlert).not.toBeNull();
    expect(posted.map((p) => p.action)).toEqual(['popped']);
  });
});

describe('VirtualPhone — reporting failures never poison state', () => {
  it('does not mark an event seen if a step before the decision throws', async () => {
    let calls = 0;
    const buffer = new VitalsBuffer();
    buffer.seed(62, NOW);
    const phone = new VirtualPhone({
      worker,
      frame: FRAME,
      buffer,
      // Fails only on the first read (e.g. a sensor glitch) — the decision is
      // never committed, so the event must not become undeliverable.
      getContext: () => {
        calls += 1;
        if (calls === 1) throw new Error('sensor read failed');
        return { position: { x: 1, z: 1 }, floor: '4', moving: false, noiseDbFs: -40 , noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true};
      },
      postResponse: async () => ({ event_id: 'e-1', worker_state: 'received' }),
      postIndividualAlert: async () => ({ id: 'ia-1' }),
    });

    await expect(phone.handleEvent(eventAt(0, 0, '4'), NOW)).rejects.toThrow('sensor read failed');
    expect(phone.activeAlert).toBeNull();

    // Redelivery of the SAME event id must still run the gate — it was never
    // marked seen, because no decision was ever committed for it.
    await phone.handleEvent(eventAt(0, 0, '4'), NOW + 500);
    expect(phone.activeAlert).not.toBeNull();
  });

  it('a throwing postResponse does not escape handleEvent and is recorded, not swallowed', async () => {
    const buffer = new VitalsBuffer();
    buffer.seed(62, NOW);
    const phone = new VirtualPhone({
      worker,
      frame: FRAME,
      buffer,
      getContext: () => ({ position: { x: 1, z: 1 }, floor: '4', moving: false, noiseDbFs: -40 , noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true}),
      postResponse: async () => {
        throw new Error('network down');
      },
      postIndividualAlert: async () => ({ id: 'ia-1' }),
    });

    await expect(phone.handleEvent(eventAt(0, 0, '4'), NOW)).resolves.toBeUndefined();

    // The decision already made locally survives the reporting failure.
    expect(phone.activeAlert).not.toBeNull();
    expect(phone.lastReportError).toBeInstanceOf(Error);
    expect(phone.reportFailureCount).toBeGreaterThan(0);

    // ack still clears locally even though every report has failed.
    await expect(phone.ack(NOW + 1_000)).resolves.toBeUndefined();
    expect(phone.activeAlert).toBeNull();
  });

  it('a failure stays visible even after a later report succeeds (received/popped can race)', async () => {
    const buffer = new VitalsBuffer();
    buffer.seed(62, NOW);
    let call = 0;
    const phone = new VirtualPhone({
      worker,
      frame: FRAME,
      buffer,
      getContext: () => ({ position: { x: 1, z: 1 }, floor: '4', moving: false, noiseDbFs: -40 , noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true}),
      // First report ('received') fails; every report after it ('popped',
      // then 'ack') succeeds. If success cleared lastReportError, the earlier
      // failure would be invisible by the time this test looks at it.
      postResponse: async () => {
        call += 1;
        if (call === 1) throw new Error('received post failed');
        return { event_id: 'e-1', worker_state: 'received' };
      },
      postIndividualAlert: async () => ({ id: 'ia-1' }),
    });

    await phone.handleEvent(eventAt(0, 0, '4'), NOW);
    expect(phone.lastReportError).toBeInstanceOf(Error);
    expect(phone.reportFailureCount).toBe(1);

    // A later, successful report must not erase the earlier failure.
    await phone.ack(NOW + 1_000);
    expect(phone.lastReportError).toBeInstanceOf(Error);
    expect(phone.reportFailureCount).toBe(1);
  });
});

describe('VirtualPhone — health alerts', () => {
  it('raises a danger alert on the first tick after a backfill', async () => {
    const raised = vi.fn(async () => ({ id: 'ia-1' }));
    const buffer = new VitalsBuffer();
    buffer.seed(62, NOW);
    const phone = new VirtualPhone({
      worker,
      frame: FRAME,
      buffer,
      getContext: () => ({
        position: { x: 0, z: 0 }, floor: '4', moving: false, noiseDbFs: -40,
        noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true,
      }),
      postResponse: async () => ({ event_id: 'e', worker_state: 'received' }),
      postIndividualAlert: raised,
    });

    buffer.backfillHr(175, 20 * 60_000, NOW);
    await phone.tickVitals(NOW);

    expect(phone.riskBand).toBe('danger');
    expect(raised).toHaveBeenCalledTimes(1);
  });

  it('does not raise twice for one episode', async () => {
    const raised = vi.fn(async () => ({ id: 'ia-1' }));
    const buffer = new VitalsBuffer();
    buffer.seed(62, NOW);
    const phone = new VirtualPhone({
      worker, frame: FRAME, buffer,
      getContext: () => ({
        position: { x: 0, z: 0 }, floor: '4', moving: false, noiseDbFs: -40,
        noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true,
      }),
      postResponse: async () => ({ event_id: 'e', worker_state: 'received' }),
      postIndividualAlert: raised,
    });

    buffer.backfillHr(175, 20 * 60_000, NOW);
    await phone.tickVitals(NOW);
    await phone.tickVitals(NOW + 2_000);

    expect(raised).toHaveBeenCalledTimes(1);
  });

  it('reports the real qualifying-poll streak for a caution raise, not a hardcoded constant', async () => {
    let capturedTrace: unknown;
    const raised = vi.fn(async (_token: string, body: IndividualAlertBody) => {
      capturedTrace = body.decision_trace;
      return { id: 'ia-1' };
    });
    const buffer = new VitalsBuffer();
    buffer.seed(62, NOW);
    const phone = new VirtualPhone({
      worker, frame: FRAME, buffer,
      getContext: () => ({
        position: { x: 0, z: 0 }, floor: '4', moving: false, noiseDbFs: -40,
        noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true,
      }),
      postResponse: async () => ({ event_id: 'e', worker_state: 'received' }),
      postIndividualAlert: raised,
    });

    // 140 bpm against this worker's ~184 hrMax sits at ~76% — inside the
    // caution band (70-85%) and never crosses into danger. ALERT_CONFIG's
    // enterTicks.caution is 2, so the raise should land on the SECOND poll,
    // not the first — unlike the danger case, whose enterTicks is 1.
    buffer.backfillHr(140, 20 * 60_000, NOW);

    await phone.tickVitals(NOW);
    expect(raised).not.toHaveBeenCalled();

    await phone.tickVitals(NOW + 2_000);
    expect(phone.riskBand).toBe('caution');
    expect(raised).toHaveBeenCalledTimes(1);

    const trace = capturedTrace as { debounce: { qualifying_polls: number; required_polls: number } };
    expect(trace.debounce.qualifying_polls).toBe(2);
    expect(trace.debounce.required_polls).toBe(2);
  });
});
