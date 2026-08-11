import { describe, expect, it, vi } from 'vitest';
import { Fleet } from '@/runtime/fleet';
import { VirtualPhone } from '@/phone/VirtualPhone';
import { estimateRestingHr } from '@/phone/vendor/health/baseline';
import { readBaselineSeries } from '@/phone/vendor/health/healthConnect';

const ANCHOR = { latitude: 30.04412, longitude: 31.23571 };
/** The default frame: the scene's own origin sits at the anchor. */
const FRAME = () => ({ anchor: ANCHOR, origin: { x: 0, z: 0 } });

const worker = (index: number) => ({
  index, userId: `u-${index}`, username: `w${index}`, email: `w${index}@x.io`,
  password: 'p', firstName: 'A', lastName: 'B', dateOfBirth: '1992-01-11',
  accessToken: `tok-${index}`, refreshToken: 'ref',
});

const session = {
  slug: 's', companyId: 'c', companyName: 'Demo', adminUserId: 'a',
  adminAccessToken: 'admin', adminRefreshToken: 'ar', joinCode: 'X',
};

describe('Fleet', () => {
  it('creates one phone per provisioned worker', () => {
    const fleet = new Fleet({
      frame: FRAME,
      getContext: () => ({
        position: { x: 0, z: 0 }, floor: '1', moving: false, noiseDbFs: -40,
        noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true,
      }),
      connect: () => ({ start() {}, stop() {}, kick() {} }),
    });

    fleet.start(session, [worker(1), worker(2), worker(3)]);

    expect(fleet.phones).toHaveLength(3);
    expect(fleet.phoneFor(2)?.workerId).toBe('u-2');
    fleet.stop();
  });

  it('opens one socket per worker and closes them all on stop', () => {
    let opened = 0;
    let stopped = 0;
    const fleet = new Fleet({
      frame: FRAME,
      getContext: () => ({
        position: { x: 0, z: 0 }, floor: '1', moving: false, noiseDbFs: -40,
        noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true,
      }),
      connect: () => {
        opened++;
        return { start() {}, stop() { stopped++; }, kick() {} };
      },
    });

    fleet.start(session, [worker(1), worker(2)]);
    expect(opened).toBe(2);

    fleet.stop();
    expect(stopped).toBe(2);
    expect(fleet.phones).toHaveLength(0);
  });

  it('routes an event to every phone', async () => {
    const fleet = new Fleet({
      frame: FRAME,
      getContext: () => ({
        position: { x: 0, z: 0 }, floor: '1', moving: false, noiseDbFs: -40,
        noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true,
      }),
      connect: () => ({ start() {}, stop() {}, kick() {} }),
      postResponse: async () => ({ event_id: 'e', worker_state: 'received' }),
    });

    fleet.start(session, [worker(1), worker(2)]);
    await fleet.deliverToAll(
      {
        id: 'e-1', source: 'sim', asset_id: 'A', asset_label: 'A',
        latitude: ANCHOR.latitude, longitude: ANCHOR.longitude, alert_radius_m: 75,
        floor: null, zone_id: null, severity: 'high', type: 't', message: 'm',
        status: 'open', created_at: '2026-08-09T12:00:00Z',
      },
      Date.now(),
    );

    expect(fleet.phones.every((p) => p.activeAlert !== null)).toBe(true);
    fleet.stop();
  });

  it('refreshes a worker whose socket reports 4401, and reporting uses the new token — not the old one', async () => {
    let capturedRefresh: (() => Promise<string | null>) | null = null;
    const reports: { token: string; action: string }[] = [];

    const fleet = new Fleet({
      frame: FRAME,
      getContext: () => ({
        position: { x: 0, z: 0 }, floor: '1', moving: false, noiseDbFs: -40,
        noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true,
      }),
      // Stands in for the vendored socket controller: captures the refresh
      // accessor Fleet wires up, so the test can simulate the controller's own
      // 4401 handling without a real socket or a real network call.
      connect: (_worker, _onMessage, token) => {
        capturedRefresh = token.refresh;
        return { start() {}, stop() {}, kick() {} };
      },
      // Stands in for POST /auth/refresh — proves the fleet calls it with the
      // worker's refresh token, never touching the network in a test.
      refreshToken: async (refreshToken) => {
        expect(refreshToken).toBe('ref');
        return 'tok-1-fresh';
      },
      postResponse: async (token, _eventId, body) => {
        reports.push({ token, action: body.action });
        return { event_id: 'e', worker_state: 'received' };
      },
    });

    fleet.start(session, [worker(1)]);
    expect(capturedRefresh).not.toBeNull();

    // Simulate the socket controller closing with 4401 and running its
    // single-flight refresh.
    const fresh = await capturedRefresh!();
    expect(fresh).toBe('tok-1-fresh');

    await fleet.deliverToAll(
      {
        id: 'e-2', source: 'sim', asset_id: 'A', asset_label: 'A',
        latitude: ANCHOR.latitude, longitude: ANCHOR.longitude, alert_radius_m: 75,
        floor: null, zone_id: null, severity: 'high', type: 't', message: 'm',
        status: 'open', created_at: '2026-08-09T12:00:00Z',
      },
      Date.now(),
    );

    // One delivery now produces two reports — 'received' the instant the
    // alert arrives (mirroring the app's groupAlertGate.ts, independent of
    // what the gate decides), then the gate's own verdict. 'received' must
    // come first: it is the record that the alert reached the device at all.
    expect(reports).toEqual([
      { token: 'tok-1-fresh', action: 'received' },
      { token: 'tok-1-fresh', action: 'popped' },
    ]);
    // The security assertion this test exists for: the refreshed token is
    // what both reports use, and the stale pre-refresh token never leaks in.
    expect(reports.some((r) => r.token === 'tok-1')).toBe(false);
    fleet.stop();
  });

  it('passes the estimated resting HR (not the raw seed value) to the phone when the estimator can produce one', () => {
    const setRestingHrSpy = vi.spyOn(VirtualPhone.prototype, 'setRestingHr');
    const fleet = new Fleet({
      frame: FRAME,
      getContext: () => ({
        position: { x: 0, z: 0 }, floor: '1', moving: false, noiseDbFs: -40,
        noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true,
      }),
      connect: () => ({ start() {}, stop() {}, kick() {} }),
    });

    fleet.start(session, [worker(1)]);

    const buffer = fleet.buffer(1)!;
    const estimated = estimateRestingHr(buffer.hrSeries(), buffer.steps());

    // Sanity check on the fixture: a freshly seeded buffer must actually be
    // estimable, or this test would trivially pass via the seed-value fallback.
    expect(estimated).not.toBeNull();
    expect(setRestingHrSpy).toHaveBeenCalledTimes(1);
    expect(setRestingHrSpy).toHaveBeenCalledWith(estimated);

    fleet.stop();
    setRestingHrSpy.mockRestore();
  });

  it('prefers an attached context source over the fallback getContext', async () => {
    const fallback = vi.fn(() => ({
      position: { x: 0, z: 0 }, floor: '1', moving: false, noiseDbFs: -40,
      noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true,
    }));
    const fleet = new Fleet({
      frame: FRAME,
      getContext: fallback,
      connect: () => ({ start() {}, stop() {}, kick() {} }),
      postResponse: async () => ({ event_id: 'e', worker_state: 'received' }),
    });
    fleet.start(session, [worker(1)]);

    fleet.attachContextSource({
      contextFor: () => ({
        position: { x: 5, z: 5 }, floor: '4', moving: true, noiseDbFs: -12,
        noiseAgeMs: 1_000, gpsAgeMs: 2_000, stepsReadable: true,
      }),
    });
    fallback.mockClear();

    await fleet.deliverToAll(
      {
        id: 'e-ctx', source: 'sim', asset_id: 'A', asset_label: 'A',
        latitude: ANCHOR.latitude, longitude: ANCHOR.longitude, alert_radius_m: 75,
        floor: null, zone_id: null, severity: 'high', type: 't', message: 'm',
        status: 'open', created_at: '2026-08-10T09:00:00Z',
      },
      Date.now(),
    );

    // moving + loud ⇒ haptic only, which only the attached source reports.
    expect(fleet.phoneFor(1)?.activeAlert?.modality)
      .toEqual({ visual: false, haptic: true, sound: false });
    expect(fallback).not.toHaveBeenCalled();

    fleet.stop();
  });

  it('a second start replaces the first fleet rather than appending to it', () => {
    let opened = 0;
    let stopped = 0;
    const fleet = new Fleet({
      frame: FRAME,
      getContext: () => ({
        position: { x: 0, z: 0 }, floor: '1', moving: false, noiseDbFs: -40,
        noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true,
      }),
      connect: () => {
        opened++;
        return { start() {}, stop() { stopped++; }, kick() {} };
      },
    });

    fleet.start(session, [worker(1), worker(2)]);
    fleet.start(session, [worker(3)]);

    // Not 3: the Reset flow calls start again, and appending would leave the
    // first two workers' sockets live and their phones still in the fan-out.
    expect(fleet.phones).toHaveLength(1);
    expect(fleet.phoneFor(1)).toBeUndefined();
    expect(fleet.phoneFor(3)).toBeDefined();
    expect(opened).toBe(3);
    expect(stopped).toBe(2);

    fleet.stop();
    expect(stopped).toBe(3);
  });

  it('wires the vendored Health-Connect seam to real fleet data instead of leaving it dead', async () => {
    const fleet = new Fleet({
      frame: FRAME,
      getContext: () => ({
        position: { x: 0, z: 0 }, floor: '1', moving: false, noiseDbFs: -40,
        noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true,
      }),
      connect: () => ({ start() {}, stop() {}, kick() {} }),
    });

    fleet.start(session, [worker(1), worker(2)]);

    const series = await readBaselineSeries();
    expect(series).not.toBeNull();
    // Two workers' worth of seeded HR history, concatenated — proof the
    // installed reader is actually backed by the fleet's own buffers.
    const expectedLength =
      (fleet.buffer(1)?.hrSeries().length ?? 0) + (fleet.buffer(2)?.hrSeries().length ?? 0);
    expect(series!.hr).toHaveLength(expectedLength);

    fleet.stop();
  });
});

describe('Fleet — health alert acknowledgement', () => {
  /**
   * `POST /individual-alerts/{id}/events` shipped in S3-BE7. The simulator had
   * carried an optional hook for it that nothing ever provided, so a worker's
   * answer never left the browser and the dashboard's health ack-latency
   * stayed empty. These pin the wiring, because the failure was silent: no
   * error, no rejected promise, just a report that never happened.
   */
  const base = () => ({
    frame: FRAME,
    getContext: () => ({
      position: { x: 0, z: 0 }, floor: '1', moving: false, noiseDbFs: -40,
      noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true,
    }),
    connect: () => ({ start() {}, stop() {}, kick() {} }),
  });

  it('reports an acknowledgement against the alert the server issued', async () => {
    const sent: unknown[] = [];
    const fleet = new Fleet({
      ...base(),
      postIndividualAlert: async () => ({ id: 'server-alert-1' }),
      postHealthAlertEvent: async (token, alertId, action, occurredAt, surface) => {
        sent.push({ token, alertId, action, occurredAt, surface });
        return { id: 'evt-1' };
      },
    });
    fleet.start(session, [worker(1)]);

    const phone = fleet.phoneFor(1)!;
    // Stand in for a raise, so the test exercises the reporting path rather
    // than the risk engine, which has its own tests.
    phone.lastHealthAlert = {
      band: 'danger',
      title: 'Danger — stop and rest now',
      reason: 'because',
      hr: 150,
      spo2: 96,
      at: 1,
      raisedAt: '2026-08-11T09:00:00.000Z',
      delivery: {
        variant: 'alarm', sound: true, vibrate: true,
        headsUp: true, fullScreen: true, insistent: true, inAppOpen: true,
      },
      alertId: 'server-alert-1',
      acknowledged: false,
    };

    await phone.acknowledgeHealth(Date.parse('2026-08-11T09:02:00.000Z'));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      alertId: 'server-alert-1',
      action: 'acknowledged',
      occurredAt: '2026-08-11T09:02:00.000Z',
      // The worker answered on the watch face, which is the in-app screen.
      surface: 'app_screen',
    });
    expect(phone.lastHealthAlert?.acknowledged).toBe(true);
    fleet.stop();
  });

  it('drops the report when the raise never got an id, rather than guessing one', async () => {
    // The server resolves the alert from the path id. With no id there is
    // nothing safe to put there, and inventing one would post against another
    // worker's alert or 404 — so the local answer stands alone.
    const sent: unknown[] = [];
    const fleet = new Fleet({
      ...base(),
      postIndividualAlert: async () => null,
      postHealthAlertEvent: async (...args) => {
        sent.push(args);
        return null;
      },
    });
    fleet.start(session, [worker(1)]);

    const phone = fleet.phoneFor(1)!;
    phone.lastHealthAlert = {
      band: 'caution',
      title: 'Caution — elevated strain',
      reason: 'because',
      hr: 130, spo2: 97, at: 1,
      raisedAt: '2026-08-11T09:00:00.000Z',
      delivery: {
        variant: 'high', sound: false, vibrate: true,
        headsUp: true, fullScreen: false, insistent: false, inAppOpen: true,
      },
      alertId: null,
      acknowledged: false,
    };

    await phone.acknowledgeHealth(Date.now());

    expect(sent).toHaveLength(0);
    // The worker still sees their own answer, which is the point.
    expect(phone.lastHealthAlert?.acknowledged).toBe(true);
    fleet.stop();
  });
});

describe('Fleet — retiring an offboarded worker', () => {
  const base = () => ({
    frame: FRAME,
    getContext: () => ({
      position: { x: 0, z: 0 }, floor: '1', moving: false, noiseDbFs: -40,
      noiseAgeMs: 0, gpsAgeMs: 0, stepsReadable: true,
    }),
  });

  it('closes that worker’s socket and drops them from the fleet', () => {
    // The server has already closed the socket and will refuse every future
    // call from them. Leaving the record would have a client reconnecting to
    // an account that is gone, and still being counted in the roster.
    const stopped: number[] = [];
    let opened = 0;
    const fleet = new Fleet({
      ...base(),
      connect: () => {
        const id = ++opened;
        return { start() {}, stop() { stopped.push(id); }, kick() {} };
      },
    });
    fleet.start(session, [worker(1), worker(2), worker(3)]);
    expect(fleet.phones).toHaveLength(3);

    fleet.retire(2);

    expect(stopped).toEqual([2]);
    expect(fleet.phones).toHaveLength(2);
    expect(fleet.phoneFor(2)).toBeUndefined();
    // The others are untouched.
    expect(fleet.phoneFor(1)?.workerId).toBe('u-1');
    expect(fleet.phoneFor(3)?.workerId).toBe('u-3');
    fleet.stop();
  });

  it('is a no-op for a worker who is not in the fleet', () => {
    const fleet = new Fleet({ ...base(), connect: () => ({ start() {}, stop() {}, kick() {} }) });
    fleet.start(session, [worker(1)]);
    expect(() => fleet.retire(99)).not.toThrow();
    expect(fleet.phones).toHaveLength(1);
    fleet.stop();
  });
});
