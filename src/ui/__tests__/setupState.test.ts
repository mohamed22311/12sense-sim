import { describe, expect, it } from 'vitest';
import {
  clampWorkerCount,
  MAX_WORKER_COUNT,
  MIN_WORKER_COUNT,
  missingWorkerIndices,
  nextPhaseAfterFailure,
  progressLabel,
} from '@/ui/setupState';

describe('clampWorkerCount', () => {
  it('clamps below the minimum up to 1', () => {
    expect(clampWorkerCount(0)).toBe(MIN_WORKER_COUNT);
    expect(clampWorkerCount(-5)).toBe(MIN_WORKER_COUNT);
  });

  it('treats an empty field (Number("") === 0) as the minimum, not zero workers', () => {
    expect(clampWorkerCount(Number(''))).toBe(MIN_WORKER_COUNT);
  });

  it('clamps a runaway value down to the maximum, never provisioning more than 120', () => {
    expect(clampWorkerCount(500)).toBe(MAX_WORKER_COUNT);
  });

  it('guards against NaN (a non-numeric field)', () => {
    expect(clampWorkerCount(NaN)).toBe(MIN_WORKER_COUNT);
    expect(clampWorkerCount(Number('abc'))).toBe(MIN_WORKER_COUNT);
  });

  it('passes a valid in-range value through unchanged', () => {
    expect(clampWorkerCount(60)).toBe(60);
    expect(clampWorkerCount(1)).toBe(1);
    expect(clampWorkerCount(120)).toBe(120);
  });
});

describe('setup state helpers', () => {
  it('labels progress readably', () => {
    expect(progressLabel('workers', { done: 24, total: 60 })).toBe('Registering workers 24 / 60');
    expect(progressLabel('company', { done: 0, total: 60 })).toBe('Creating the company');
    expect(progressLabel('connecting', { done: 60, total: 60 })).toBe('Connecting 60 phones');
  });

  it('a company-phase failure restarts from scratch, a worker-phase one resumes', () => {
    expect(nextPhaseAfterFailure('company')).toBe('idle');
    expect(nextPhaseAfterFailure('workers')).toBe('workers');
    expect(nextPhaseAfterFailure('connecting')).toBe('connecting');
  });
});

describe('missingWorkerIndices', () => {
  it('treats nothing provisioned as everything missing', () => {
    expect(missingWorkerIndices(3, [])).toEqual([1, 2, 3]);
  });

  it('is empty once every index up to total is present', () => {
    const provisioned = Array.from({ length: 5 }, (_, i) => ({ index: i + 1 }));
    expect(missingWorkerIndices(5, provisioned)).toEqual([]);
  });

  it('finds the exact gap left by a mid-batch failure, not a resumed count', () => {
    // 10 requested; workers 1-2 and 4-10 succeeded, worker 3 failed. A
    // "resume from count 9" model would re-attempt index 9 (already done,
    // 409s on a taken username) and skip index 3 (the one actually missing).
    const provisioned = [1, 2, 4, 5, 6, 7, 8, 9, 10].map((index) => ({ index }));
    expect(missingWorkerIndices(10, provisioned)).toEqual([3]);
  });

  it('is order-independent and ignores duplicates in the provisioned set', () => {
    const provisioned = [3, 1, 1, 2].map((index) => ({ index }));
    expect(missingWorkerIndices(4, provisioned)).toEqual([4]);
  });
});
