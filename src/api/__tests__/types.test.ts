import { describe, expect, it } from 'vitest';
import type { Modality, RiskBand, ContextSnapshot } from '@/api/types';

describe('vendored wire types', () => {
  it('models Modality as three independent channels', () => {
    const m: Modality = { visual: true, haptic: true, sound: false };
    expect(Object.keys(m).sort()).toEqual(['haptic', 'sound', 'visual']);
  });

  it('admits every risk band the engine can return', () => {
    const bands: RiskBand[] = ['normal', 'caution', 'danger'];
    expect(bands).toHaveLength(3);
  });

  it('lets a context snapshot carry the proximity decision record', () => {
    const snap: ContextSnapshot = {
      worker_floor: '4',
      event_floor: '4',
      floor_gate: 'match',
      gps_gate: 'in_range',
      gps_age_s: 9,
      fallbacks: [],
    };
    expect(snap.floor_gate).toBe('match');
  });
});
