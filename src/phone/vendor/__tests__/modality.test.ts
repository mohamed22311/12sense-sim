import type { Modality } from '@/api/types';
import { decideModality, Motion, ModalityContext, Noise } from '../context/modality';

/**
 * Context-aware modality selector (S3-MB1) — the charter truth table.
 *
 * This is the acceptance-criteria evidence: the full motion × noise table,
 * the missing-context safe fallback (fires all channels), and the two cases
 * the ticket names verbatim ("loud + moving → haptic-led, on-screen
 * suppressed"; "stationary + quiet → visual-led").
 */

const ctx = (motion: Motion | null, noise: Noise | null): ModalityContext => ({ motion, noise });
const m = (visual: boolean, haptic: boolean, sound: boolean): Modality => ({ visual, haptic, sound });

describe('decideModality — charter truth table', () => {
  it('still + quiet → visual + haptic + sound (visual-led)', () => {
    expect(decideModality(ctx('still', 'quiet'))).toEqual(m(true, true, true));
  });

  it('still + loud → visual + haptic, sound suppressed (masked)', () => {
    expect(decideModality(ctx('still', 'loud'))).toEqual(m(true, true, false));
  });

  it('moving + quiet → haptic + sound, visual suppressed (not looking)', () => {
    expect(decideModality(ctx('moving', 'quiet'))).toEqual(m(false, true, true));
  });

  it('moving + loud → haptic only (visual + sound both suppressed)', () => {
    expect(decideModality(ctx('moving', 'loud'))).toEqual(m(false, true, false));
  });
});

describe('decideModality — ticket-named cases', () => {
  it('loud + moving is haptic-led with on-screen suppressed', () => {
    const modality = decideModality(ctx('moving', 'loud'));
    expect(modality.visual).toBe(false); // on-screen suppressed
    expect(modality.haptic).toBe(true); // haptic-led
    expect(modality.sound).toBe(false); // masked by the loud environment
  });

  it('stationary + quiet is visual-led', () => {
    const modality = decideModality(ctx('still', 'quiet'));
    expect(modality.visual).toBe(true); // visual-led
    expect(modality.haptic).toBe(true);
    expect(modality.sound).toBe(true);
  });
});

describe('decideModality — haptic is the never-suppressed safety floor', () => {
  it.each<[Motion | null, Noise | null]>([
    ['still', 'quiet'],
    ['still', 'loud'],
    ['moving', 'quiet'],
    ['moving', 'loud'],
    ['moving', null],
    [null, 'loud'],
    [null, null],
  ])('haptic stays on for motion=%s noise=%s', (motion, noise) => {
    expect(decideModality(ctx(motion, noise)).haptic).toBe(true);
  });
});

describe('decideModality — missing context fires all channels (safe fallback)', () => {
  it('unknown motion → all channels', () => {
    expect(decideModality(ctx(null, 'quiet'))).toEqual(m(true, true, true));
    expect(decideModality(ctx(null, 'loud'))).toEqual(m(true, true, true));
  });

  it('unknown noise → all channels', () => {
    expect(decideModality(ctx('still', null))).toEqual(m(true, true, true));
    expect(decideModality(ctx('moving', null))).toEqual(m(true, true, true));
  });

  it('both axes unknown → all channels', () => {
    expect(decideModality(ctx(null, null))).toEqual(m(true, true, true));
  });

  it('a suppressed channel is never left off when the other axis is unknown', () => {
    // moving would suppress visual, but unknown noise means we cannot trust the
    // pairing — deliver everything rather than risk a dropped channel.
    expect(decideModality(ctx('moving', null)).visual).toBe(true);
    // loud would suppress sound, but unknown motion collapses to all-channels.
    expect(decideModality(ctx(null, 'loud')).sound).toBe(true);
  });
});

describe('decideModality — returns a fresh object (no shared mutable fallback)', () => {
  it('mutating one result does not affect the next', () => {
    const a = decideModality(ctx(null, null));
    a.sound = false;
    expect(decideModality(ctx(null, null)).sound).toBe(true);
  });
});
