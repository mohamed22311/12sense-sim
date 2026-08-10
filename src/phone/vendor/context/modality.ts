/* VENDORED — DO NOT EDIT.
 * Source: TwelveSense-TT-MobileApp/Thalamus/src/context/modality.ts @ 15b11d4
 * Sync check: `npm run check:vendor`. Fix drift by re-copying, never by editing.
 */
/**
 * Context-aware modality selector — pure decision module (S3-MB1).
 *
 * The differentiator: an alert reaches the worker through the channel they can
 * actually perceive *right now*, and channels that won't land are suppressed
 * instead of blasting all three every time. THIS module is the decision
 * (Constitution III) — no I/O, no React; callers gather {motion, noise} (via
 * ambientContext.ts) and read the {visual, haptic, sound} verdict, which drives
 * both the response POST's `modality` field and the concrete channel-variant
 * delivery.
 *
 * Charter truth table (design doc §5 — the decision of record; the original
 * `12sense-sim/src/logic/routing.ts` is not vendored here, so the table was
 * reconstructed from the design doc wording + the S3-MB1 ticket's two named
 * cases and written back into the design doc):
 *
 *   motion  × noise  → visual haptic sound   lead
 *   ────────────────────────────────────────────────
 *   still   · quiet  →   ✓      ✓      ✓     visual
 *   still   · loud   →   ✓      ✓      ✗     visual
 *   moving  · quiet  →   ✗      ✓      ✓     sound
 *   moving  · loud   →   ✗      ✓      ✗     haptic
 *   any axis unknown →   ✓      ✓      ✓     (safe fallback)
 *
 * Suppression rules (why a channel "won't land"):
 *   - visual  suppressed when MOVING  — the worker isn't looking at the screen;
 *   - sound   suppressed when LOUD    — an alert tone is masked by ambient noise;
 *   - haptic  NEVER suppressed        — on-body vibration always lands (safety
 *                                       floor).
 *
 * Safe fallback (Constitution V): a missing/unknown axis biases toward
 * DELIVERING — fire every channel rather than silently drop one. Because haptic
 * is always on, an unknown axis only ever *adds* the channels the other axis
 * might have suppressed.
 */

import type { Modality } from '@/api/types';

/** derived from the ambient step signal (Health Connect, S2-MB1) */
export type Motion = 'still' | 'moving';
/** derived from the rolling ambient-noise monitor (dBFS threshold) */
export type Noise = 'quiet' | 'loud';

export type ModalityContext = {
  /** null = motion unknown (steps not readable / vitals pipeline down) */
  motion: Motion | null;
  /** null = noise unknown (no fresh mic sample / mic unavailable) */
  noise: Noise | null;
};

/** every channel fires — the missing-context safe fallback (Constitution V) */
const ALL_CHANNELS: Modality = Object.freeze({ visual: true, haptic: true, sound: true });

/**
 * Pick the channels to fire from the sensed context. Pure and total: any
 * unknown axis collapses to the all-channels fallback; otherwise the four-row
 * truth table decides. Haptic is `true` in every branch by construction.
 */
export function decideModality(ctx: ModalityContext): Modality {
  // Unknown on either axis ⇒ can't judge what will land ⇒ fire everything.
  if (ctx.motion === null || ctx.noise === null) return { ...ALL_CHANNELS };

  return {
    // the worker looks at the screen only when still
    visual: ctx.motion === 'still',
    // always — the safety floor
    haptic: true,
    // a tone is only worth playing when it isn't masked
    sound: ctx.noise === 'quiet',
  };
}
