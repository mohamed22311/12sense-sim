import {
  PROXIMITY_CONFIG,
  ProximityInput,
  decideProximity,
  haversineMeters,
  proximityContextSnapshot,
} from '../realtime/proximity';

/**
 * Proximity gate (design doc §5, S2-MB4): pop iff the floor axis passes AND
 * the GPS/radius axis passes. The safety bias runs per axis — an unknown on
 * one axis falls back to "pass" (never miss a real alert), but a *measured*
 * failure on the other axis still suppresses. Every fallback is recorded.
 *
 * Fixtures use the contract's example event (30.04412, 31.23571, radius 75 m).
 */

const EVENT_LAT = 30.04412;
const EVENT_LON = 31.23571;
const RADIUS_M = 75;

/** meters per degree of latitude (meridian arc on the mean sphere) */
const M_PER_DEG_LAT = (6_371_008.8 * Math.PI) / 180;

const nowMs = new Date('2026-07-18T12:00:00Z').getTime();

/** a fix `northM` meters due north of the event, `ageMs` old */
const fixAt = (northM: number, ageMs = 10_000) => ({
  latitude: EVENT_LAT + northM / M_PER_DEG_LAT,
  longitude: EVENT_LON,
  timestamp: nowMs - ageMs,
});

const input = (over: Partial<ProximityInput> = {}): ProximityInput => ({
  event: { floor: '2', latitude: EVENT_LAT, longitude: EVENT_LON, alertRadiusM: RADIUS_M },
  workerFloor: '2',
  gps: fixAt(10),
  nowMs,
  ...over,
});

describe('haversineMeters', () => {
  it('is zero for the same point', () => {
    expect(haversineMeters(EVENT_LAT, EVENT_LON, EVENT_LAT, EVENT_LON)).toBe(0);
  });

  it('matches the meridian arc: 1° of latitude ≈ 111 195 m', () => {
    expect(haversineMeters(0, 0, 1, 0)).toBeCloseTo(111_194.93, 0);
  });

  it('a 75 m northward offset near the contract example measures ~75 m', () => {
    const p = fixAt(75);
    expect(haversineMeters(EVENT_LAT, EVENT_LON, p.latitude, p.longitude)).toBeCloseTo(75, 3);
  });

  it('is symmetric', () => {
    const p = fixAt(50);
    expect(haversineMeters(EVENT_LAT, EVENT_LON, p.latitude, p.longitude)).toBeCloseTo(
      haversineMeters(p.latitude, p.longitude, EVENT_LAT, EVENT_LON),
      9,
    );
  });
});

describe('decideProximity — radius axis (floor matching throughout)', () => {
  it('pops inside the radius and reports the measured distance + fix age', () => {
    const v = decideProximity(input({ gps: fixAt(42, 12_000) }));
    expect(v.shouldPop).toBe(true);
    expect(v.gpsGate).toBe('in_range');
    expect(v.floorGate).toBe('match');
    expect(v.distanceM).toBeCloseTo(42, 3);
    expect(v.gpsAgeS).toBe(12);
    expect(v.fallbacksFired).toEqual([]);
  });

  it('suppresses outside the radius', () => {
    const v = decideProximity(input({ gps: fixAt(RADIUS_M + 5) }));
    expect(v.shouldPop).toBe(false);
    expect(v.gpsGate).toBe('out_of_range');
    expect(v.distanceM).toBeCloseTo(RADIUS_M + 5, 3);
  });

  it('the boundary is inclusive: distance exactly alert_radius_m pops', () => {
    const p = fixAt(RADIUS_M);
    const exact = haversineMeters(EVENT_LAT, EVENT_LON, p.latitude, p.longitude);
    const v = decideProximity(
      input({
        event: { floor: '2', latitude: EVENT_LAT, longitude: EVENT_LON, alertRadiusM: exact },
        gps: p,
      }),
    );
    expect(v.gpsGate).toBe('in_range');
    expect(v.shouldPop).toBe(true);
  });

  it('no fix at all ⇒ safe in-range fallback, recorded', () => {
    const v = decideProximity(input({ gps: null }));
    expect(v.shouldPop).toBe(true);
    expect(v.gpsGate).toBe('fallback_no_fix');
    expect(v.distanceM).toBeNull();
    expect(v.gpsAgeS).toBeNull();
    expect(v.fallbacksFired).toEqual(['gps_unavailable']);
  });

  it('a fix exactly gpsStaleAfterMs old still counts as fresh; 1 ms older is stale', () => {
    const fresh = decideProximity(input({ gps: fixAt(10, PROXIMITY_CONFIG.gpsStaleAfterMs) }));
    expect(fresh.gpsGate).toBe('in_range');
    expect(fresh.fallbacksFired).toEqual([]);

    const stale = decideProximity(
      input({ gps: fixAt(500, PROXIMITY_CONFIG.gpsStaleAfterMs + 1) }),
    );
    expect(stale.shouldPop).toBe(true); // even though the stale fix reads 500 m out
    expect(stale.gpsGate).toBe('fallback_stale_fix');
    expect(stale.distanceM).toBeNull(); // a stale distance is not a measurement
    expect(stale.gpsAgeS).toBe(Math.round((PROXIMITY_CONFIG.gpsStaleAfterMs + 1) / 1000));
    expect(stale.fallbacksFired).toEqual(['gps_stale']);
  });
});

describe('decideProximity — invalid event geo (deliver-biased safe fallback)', () => {
  const badGeos: { name: string; geo: Partial<ProximityInput['event']> }[] = [
    { name: 'NaN latitude', geo: { latitude: NaN } },
    { name: 'latitude out of range (200)', geo: { latitude: 200 } },
    { name: 'latitude below range (-91)', geo: { latitude: -91 } },
    { name: 'longitude out of range (181)', geo: { longitude: 181 } },
    { name: 'NaN longitude', geo: { longitude: NaN } },
    { name: 'zero radius', geo: { alertRadiusM: 0 } },
    { name: 'negative radius', geo: { alertRadiusM: -50 } },
    { name: 'NaN radius', geo: { alertRadiusM: NaN } },
  ];

  for (const b of badGeos) {
    it(`${b.name} ⇒ pops with the event_geo_invalid fallback, no distance`, () => {
      const base = input({ gps: fixAt(42) }); // a fix that would otherwise measure 42 m in-range
      const v = decideProximity({
        ...base,
        event: { ...base.event, ...b.geo },
      });
      expect(v.shouldPop).toBe(true);
      expect(v.gpsGate).toBe('fallback_invalid_event_geo');
      expect(v.distanceM).toBeNull();
      expect(v.fallbacksFired).toEqual(['event_geo_invalid']);
    });
  }

  it('bad geo never produces a false out-of-range suppression', () => {
    // A far fix (200 m out) with a zero radius would suppress if measured; the
    // guard must deliver instead.
    const base = input({ gps: fixAt(200) });
    const v = decideProximity({ ...base, event: { ...base.event, alertRadiusM: 0 } });
    expect(v.gpsGate).not.toBe('out_of_range');
    expect(v.shouldPop).toBe(true);
  });

  it('still records the age of the fix that could not be used', () => {
    const base = input({ gps: fixAt(42, 30_000) });
    const v = decideProximity({ ...base, event: { ...base.event, latitude: NaN } });
    expect(v.gpsAgeS).toBe(30);
  });
});

describe('decideProximity — GPS timestamp sanity (clock skew / future fix)', () => {
  it('a fix timestamped in the future is never recorded with a negative age', () => {
    const v = decideProximity(input({ gps: fixAt(10, -5_000) })); // 5 s in the future
    expect(v.gpsAgeS).toBe(0);
  });

  it('a small future skew (within the stale window) still measures in-range', () => {
    const v = decideProximity(input({ gps: fixAt(42, -10_000) }));
    expect(v.gpsGate).toBe('in_range');
    expect(v.distanceM).toBeCloseTo(42, 3);
    expect(v.gpsAgeS).toBe(0);
    expect(v.fallbacksFired).toEqual([]);
  });

  it('an extreme future timestamp (beyond the stale window) is treated as an unusable stale fix', () => {
    const v = decideProximity(
      input({ gps: fixAt(10, -(PROXIMITY_CONFIG.gpsStaleAfterMs + 1)) }),
    );
    expect(v.shouldPop).toBe(true); // deliver-biased, never miss a real alert
    expect(v.gpsGate).toBe('fallback_stale_fix');
    expect(v.distanceM).toBeNull();
    expect(v.gpsAgeS).toBe(0); // clamped, never negative
    expect(v.fallbacksFired).toEqual(['gps_stale']);
  });
});

describe('decideProximity — floor axis (in radius throughout)', () => {
  it('a same-radius event on a different floor does NOT pop', () => {
    const v = decideProximity(input({ workerFloor: '3' }));
    expect(v.shouldPop).toBe(false);
    expect(v.floorGate).toBe('mismatch');
    expect(v.gpsGate).toBe('in_range'); // radius alone would have popped
    expect(v.fallbacksFired).toEqual([]);
  });

  it('event floor null ⇒ the floor gate is skipped (pure radius check), no fallback', () => {
    const base = input({ workerFloor: '3' });
    const v = decideProximity({ ...base, event: { ...base.event, floor: null } });
    expect(v.shouldPop).toBe(true);
    expect(v.floorGate).toBe('skipped_null_event_floor');
    expect(v.fallbacksFired).toEqual([]);
  });

  it('unknown worker floor ⇒ safe-fallback match, recorded', () => {
    const v = decideProximity(input({ workerFloor: null }));
    expect(v.shouldPop).toBe(true);
    expect(v.floorGate).toBe('fallback_unknown_worker_floor');
    expect(v.fallbacksFired).toEqual(['unknown_worker_floor']);
  });

  it('floor comparison is trimmed and case-insensitive', () => {
    expect(decideProximity(input({ workerFloor: ' 2 ' })).floorGate).toBe('match');
    const base = input({ workerFloor: 'b1' });
    expect(
      decideProximity({ ...base, event: { ...base.event, floor: 'B1' } }).floorGate,
    ).toBe('match');
  });

  it('a whitespace-only worker floor counts as unknown, not a mismatch', () => {
    const v = decideProximity(input({ workerFloor: '   ' }));
    expect(v.floorGate).toBe('fallback_unknown_worker_floor');
    expect(v.shouldPop).toBe(true);
  });

  it('event floor null wins over unknown worker floor: gate skipped, no fallback fired', () => {
    const base = input({ workerFloor: null });
    const v = decideProximity({ ...base, event: { ...base.event, floor: null } });
    expect(v.floorGate).toBe('skipped_null_event_floor');
    expect(v.fallbacksFired).toEqual([]);
  });
});

describe('decideProximity — full truth table (floor axis × gps axis)', () => {
  // Axis outcomes: the floor axis passes unless it *measures* a mismatch; the
  // gps axis passes unless it *measures* out-of-range. shouldPop = both pass.
  const floors: {
    name: string;
    workerFloor: string | null;
    eventFloor: string | null;
    passes: boolean;
  }[] = [
    { name: 'floor match', workerFloor: '2', eventFloor: '2', passes: true },
    { name: 'floor mismatch', workerFloor: '3', eventFloor: '2', passes: false },
    { name: 'null event floor', workerFloor: '3', eventFloor: null, passes: true },
    { name: 'unknown worker floor', workerFloor: null, eventFloor: '2', passes: true },
  ];
  const gpses: { name: string; gps: ProximityInput['gps']; passes: boolean }[] = [
    { name: 'in range', gps: fixAt(40), passes: true },
    { name: 'out of range', gps: fixAt(200), passes: false },
    { name: 'stale fix', gps: fixAt(40, PROXIMITY_CONFIG.gpsStaleAfterMs + 60_000), passes: true },
    { name: 'no fix', gps: null, passes: true },
  ];

  for (const f of floors) {
    for (const g of gpses) {
      const expected = f.passes && g.passes;
      it(`${f.name} + ${g.name} ⇒ ${expected ? 'pop' : 'suppress'}`, () => {
        const v = decideProximity({
          event: { floor: f.eventFloor, latitude: EVENT_LAT, longitude: EVENT_LON, alertRadiusM: RADIUS_M },
          workerFloor: f.workerFloor,
          gps: g.gps,
          nowMs,
        });
        expect(v.shouldPop).toBe(expected);
      });
    }
  }

  it('both axes unknown ⇒ pop with both fallbacks recorded (never miss a real alert)', () => {
    const v = decideProximity(input({ workerFloor: null, gps: null }));
    expect(v.shouldPop).toBe(true);
    expect(v.fallbacksFired).toEqual(['unknown_worker_floor', 'gps_unavailable']);
  });
});

describe('proximityContextSnapshot', () => {
  it('carries the full decision record — exactly the documented keys', () => {
    const i = input({ gps: fixAt(42, 12_000) });
    const v = decideProximity(i);
    const snap = proximityContextSnapshot(i, v);
    expect(snap).toEqual({
      worker_floor: '2',
      event_floor: '2',
      floor_gate: 'match',
      gps_gate: 'in_range',
      gps_age_s: 12,
      fallbacks: [],
    });
  });

  it('records fallbacks and nulls verbatim on the safe paths', () => {
    const i = input({ workerFloor: null, gps: null });
    const snap = proximityContextSnapshot(i, decideProximity(i));
    expect(snap).toEqual({
      worker_floor: null,
      event_floor: '2',
      floor_gate: 'fallback_unknown_worker_floor',
      gps_gate: 'fallback_no_fix',
      gps_age_s: null,
      fallbacks: ['unknown_worker_floor', 'gps_unavailable'],
    });
  });
});

describe('PROXIMITY_CONFIG invariants', () => {
  it('is frozen and keeps the demo-tuned ordering: acquire wait < staleness window', () => {
    expect(Object.isFrozen(PROXIMITY_CONFIG)).toBe(true);
    expect(PROXIMITY_CONFIG.gpsAcquireTimeoutMs).toBeLessThan(PROXIMITY_CONFIG.gpsStaleAfterMs);
    expect(PROXIMITY_CONFIG.gpsStaleAfterMs).toBe(120_000);
    expect(PROXIMITY_CONFIG.gpsAcquireTimeoutMs).toBe(20_000);
  });
});
