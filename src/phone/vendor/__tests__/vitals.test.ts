import {
  accessSummary,
  formatAge,
  hrSeries,
  latestHr,
  latestSpo2,
  readingAgeMs,
  spo2Series,
  stepBuckets,
} from '../health/vitals';

/**
 * Latest-reading selection, freshness labels, and the access truth table.
 * Graceful degradation is the point: malformed records and missing grants
 * narrow the result — they never throw.
 */

describe('latestHr', () => {
  it('picks the newest sample across records, regardless of order', () => {
    const records = [
      {
        samples: [
          { time: '2026-07-09T10:00:00Z', beatsPerMinute: 71 },
          { time: '2026-07-09T10:05:00Z', beatsPerMinute: 78 },
        ],
      },
      { samples: [{ time: '2026-07-09T09:50:00Z', beatsPerMinute: 90 }] },
    ];
    expect(latestHr(records)).toEqual({ value: 78, observedAt: '2026-07-09T10:05:00Z' });
  });

  it('returns null when there are no records or no samples', () => {
    expect(latestHr([])).toBeNull();
    expect(latestHr([{ samples: [] }])).toBeNull();
  });

  it('skips malformed samples instead of throwing', () => {
    const records = [
      {
        samples: [
          { time: 'not-a-date', beatsPerMinute: 80 },
          { time: '2026-07-09T10:00:00Z', beatsPerMinute: NaN },
          { time: '2026-07-09T10:00:00Z', beatsPerMinute: 0 },
          { time: '2026-07-09T09:00:00Z', beatsPerMinute: 66 },
        ],
      },
    ];
    expect(latestHr(records)).toEqual({ value: 66, observedAt: '2026-07-09T09:00:00Z' });
  });
});

describe('latestSpo2', () => {
  it('picks the newest valid percentage', () => {
    const records = [
      { time: '2026-07-09T02:00:00Z', percentage: 97 },
      { time: '2026-07-09T03:00:00Z', percentage: 95 },
    ];
    expect(latestSpo2(records)).toEqual({ value: 95, observedAt: '2026-07-09T03:00:00Z' });
  });

  it('rejects out-of-range or malformed values', () => {
    expect(latestSpo2([{ time: '2026-07-09T02:00:00Z', percentage: 0 }])).toBeNull();
    expect(latestSpo2([{ time: '2026-07-09T02:00:00Z', percentage: 130 }])).toBeNull();
    expect(latestSpo2([{ time: 'bogus', percentage: 97 }])).toBeNull();
    expect(latestSpo2([])).toBeNull();
  });
});

describe('hrSeries', () => {
  const now = '2026-07-09T12:00:00Z';

  it('collects valid samples inside the window, ascending by time', () => {
    const records = [
      {
        samples: [
          { time: '2026-07-09T11:50:00Z', beatsPerMinute: 80 },
          { time: '2026-07-09T11:30:00Z', beatsPerMinute: 75 },
        ],
      },
      { samples: [{ time: '2026-07-09T11:40:00Z', beatsPerMinute: 78 }] },
    ];
    expect(hrSeries(records, 60 * 60_000, now)).toEqual([
      { value: 75, observedAt: '2026-07-09T11:30:00Z' },
      { value: 78, observedAt: '2026-07-09T11:40:00Z' },
      { value: 80, observedAt: '2026-07-09T11:50:00Z' },
    ]);
  });

  it('drops samples older than the window and malformed samples', () => {
    const records = [
      {
        samples: [
          { time: '2026-07-09T10:00:00Z', beatsPerMinute: 70 }, // outside 1 h window
          { time: 'bogus', beatsPerMinute: 80 },
          { time: '2026-07-09T11:45:00Z', beatsPerMinute: 0 },
          { time: '2026-07-09T11:50:00Z', beatsPerMinute: 82 },
        ],
      },
    ];
    expect(hrSeries(records, 60 * 60_000, now)).toEqual([
      { value: 82, observedAt: '2026-07-09T11:50:00Z' },
    ]);
  });
});

describe('spo2Series (S3-MB3 — the detail sheet trend)', () => {
  const now = '2026-07-09T12:00:00Z';

  it('keeps in-window readings, ascending by time', () => {
    const records = [
      { time: '2026-07-09T11:50:00Z', percentage: 96 },
      { time: '2026-07-09T11:20:00Z', percentage: 98 },
    ];
    expect(spo2Series(records, 60 * 60_000, now)).toEqual([
      { value: 98, observedAt: '2026-07-09T11:20:00Z' },
      { value: 96, observedAt: '2026-07-09T11:50:00Z' },
    ]);
  });

  it('drops readings older than the window', () => {
    const records = [
      { time: '2026-07-09T09:00:00Z', percentage: 97 },
      { time: '2026-07-09T11:50:00Z', percentage: 96 },
    ];
    expect(spo2Series(records, 60 * 60_000, now)).toEqual([
      { value: 96, observedAt: '2026-07-09T11:50:00Z' },
    ]);
  });

  it('applies the same validity rules as latestSpo2 (0 < pct ≤ 100, real time)', () => {
    const records = [
      { time: '2026-07-09T11:50:00Z', percentage: 0 },
      { time: '2026-07-09T11:51:00Z', percentage: 101 },
      { time: 'not-a-date', percentage: 97 },
      { time: '2026-07-09T11:52:00Z', percentage: 97 },
    ];
    expect(spo2Series(records, 60 * 60_000, now)).toEqual([
      { value: 97, observedAt: '2026-07-09T11:52:00Z' },
    ]);
  });

  it('a bad nowIso yields an empty series rather than throwing', () => {
    expect(spo2Series([{ time: '2026-07-09T11:50:00Z', percentage: 96 }], 60_000, 'x')).toEqual([]);
  });
});

describe('stepBuckets', () => {
  it('keeps valid buckets, ascending by start time', () => {
    const records = [
      { startTime: '2026-07-09T11:30:00Z', endTime: '2026-07-09T11:40:00Z', count: 120 },
      { startTime: '2026-07-09T11:00:00Z', endTime: '2026-07-09T11:10:00Z', count: 0 },
    ];
    expect(stepBuckets(records)).toEqual([
      { startTime: '2026-07-09T11:00:00Z', endTime: '2026-07-09T11:10:00Z', count: 0 },
      { startTime: '2026-07-09T11:30:00Z', endTime: '2026-07-09T11:40:00Z', count: 120 },
    ]);
  });

  it('skips malformed buckets instead of throwing', () => {
    expect(
      stepBuckets([
        { startTime: 'bogus', endTime: '2026-07-09T11:40:00Z', count: 120 },
        { startTime: '2026-07-09T11:30:00Z', endTime: '2026-07-09T11:40:00Z', count: NaN },
        { startTime: '2026-07-09T11:30:00Z', endTime: '2026-07-09T11:40:00Z', count: -5 },
        { startTime: '2026-07-09T11:40:00Z', endTime: '2026-07-09T11:30:00Z', count: 10 }, // end < start
      ]),
    ).toEqual([]);
  });
});

describe('readingAgeMs / formatAge', () => {
  const now = '2026-07-09T12:00:00Z';

  it('measures the age of a reading, floored at zero for clock skew', () => {
    expect(readingAgeMs({ value: 78, observedAt: '2026-07-09T11:56:00Z' }, now)).toBe(240_000);
    expect(readingAgeMs({ value: 78, observedAt: '2026-07-09T12:01:00Z' }, now)).toBe(0);
  });

  it('returns null for unparseable timestamps', () => {
    expect(readingAgeMs({ value: 78, observedAt: 'bogus' }, now)).toBeNull();
  });

  it('formats ages for the Home cards', () => {
    expect(formatAge(0)).toBe('just now');
    expect(formatAge(59_000)).toBe('just now');
    expect(formatAge(240_000)).toBe('4 min ago');
    expect(formatAge(3 * 3_600_000)).toBe('3 hr ago');
    expect(formatAge(null)).toBe('');
  });
});

describe('accessSummary', () => {
  const read = (recordType: string) => ({ accessType: 'read', recordType });
  const allGrants = [
    read('HeartRate'),
    read('OxygenSaturation'),
    read('Steps'),
    read('BackgroundAccessPermission'),
  ];

  it('marks everything unavailable when Health Connect is missing or outdated', () => {
    for (const availability of ['unavailable', 'needs-update'] as const) {
      expect(accessSummary(availability, allGrants)).toEqual({
        availability,
        hr: 'unavailable',
        spo2: 'unavailable',
        steps: 'unavailable',
        background: false,
        anyReadable: false,
      });
    }
  });

  it('grants each signal independently', () => {
    expect(accessSummary('available', allGrants)).toEqual({
      availability: 'available',
      hr: 'ok',
      spo2: 'ok',
      steps: 'ok',
      background: true,
      anyReadable: true,
    });
    expect(accessSummary('available', [read('HeartRate')])).toMatchObject({
      hr: 'ok',
      spo2: 'denied',
      steps: 'denied',
      background: false,
      anyReadable: true,
    });
    expect(accessSummary('available', [read('OxygenSaturation')])).toMatchObject({
      hr: 'denied',
      spo2: 'ok',
      anyReadable: true,
    });
    expect(accessSummary('available', [read('Steps')])).toMatchObject({
      hr: 'denied',
      spo2: 'denied',
      steps: 'ok',
      anyReadable: true,
    });
  });

  it('treats a full denial as denied (not a crash), with nothing readable', () => {
    expect(accessSummary('available', [])).toEqual({
      availability: 'available',
      hr: 'denied',
      spo2: 'denied',
      steps: 'denied',
      background: false,
      anyReadable: false,
    });
  });

  it('ignores write-only grants', () => {
    expect(
      accessSummary('available', [{ accessType: 'write', recordType: 'HeartRate' }]),
    ).toMatchObject({ hr: 'denied', anyReadable: false });
  });
});
