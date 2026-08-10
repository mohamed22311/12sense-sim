/* VENDORED — DO NOT EDIT.
 * Source: TwelveSense-TT-MobileApp/Thalamus/src/context/modalityDelivery.ts @ 15b11d4
 * Sync check: `npm run check:vendor`. Fix drift by re-copying, never by editing.
 */
/**
 * Modality → concrete Android delivery plan — pure module (S3-MB1).
 *
 * decideModality (modality.ts) says WHICH channels should fire; this maps that
 * {visual, haptic, sound} verdict to the delivery a notification must actually
 * use. It exists because Android channel properties — importance (heads-up),
 * sound, and vibration — are IMMUTABLE after channel creation, so "suppress
 * sound" or "suppress the heads-up" can't be a per-notification flag: it must
 * select a different channel *variant*. This function is where that selection
 * lives (Constitution III — the delivery rules are decision logic), consumed by
 * groupAlertNotification.ts and alertNotification.ts.
 *
 * Mapping (group alerts + individual caution take the full selection):
 *
 *   visual sound → variant  headsUp fullScreen insistent  (haptic/vibrate always)
 *   ───────────────────────────────────────────────────────────────────────────
 *     ✓     ✓   → alarm       yes      yes*       yes      maximal alarm-grade
 *     ✓     ✗   → high        yes      yes*       no       silent heads-up + FSI
 *     ✗     ✓   → default     no       no         no       audible, no screen grab
 *     ✗     ✗   → default     no       no         no       vibrate-only, shade+watch
 *
 *   *fullScreen only where the surface supports it (group + danger; caution never).
 *
 * The DANGER individual alert carries a safety FLOOR: visual is never fully
 * dropped (its locked-screen full-screen wake + heavy vibration are the alarm
 * posture), so danger only ever chooses between `alarm` (sound lands) and
 * `high` (sound masked → lead with haptic + full-screen). That is the *correct*
 * perceptibility behavior in a loud plant, not a softening. Caution takes the
 * full selection but is notification-only, so it never reaches `alarm`/full
 * screen.
 *
 * Safe fallback: decideModality already returns all-channels on missing
 * context, which maps here to `alarm` — the maximal, hard-to-miss delivery that
 * S2-MB5/MB3 shipped as the pre-modality default (Constitution V).
 */

import type { Modality } from '@/api/types';

export type ChannelVariant = 'alarm' | 'high' | 'default';

export type DeliveryPlan = {
  /** which channel family variant to post on */
  variant: ChannelVariant;
  /** the channel plays a sound */
  sound: boolean;
  /** the channel vibrates — always true (haptic is the safety floor) */
  vibrate: boolean;
  /** channel importance HIGH (heads-up peek) vs DEFAULT (shade only) */
  headsUp: boolean;
  /** launch the lock-screen full-screen surface */
  fullScreen: boolean;
  /** loop the sound (FLAG_INSISTENT) — only the alarm-grade variant */
  insistent: boolean;
  /** auto-navigate the in-app screen at raise time */
  inAppOpen: boolean;
};

export type DeliveryOptions = {
  /**
   * this surface can use the native alarm-grade channel (USAGE_ALARM) + the
   * lock-screen full-screen intent. True for group alerts and the danger
   * individual alert; false for the caution individual alert (notification-only).
   */
  alarmGrade: boolean;
  /**
   * safety floor: visual is forced on regardless of the selector (the danger
   * individual alert's locked-screen wake must never be suppressed).
   */
  forceVisual?: boolean;
};

/** Map a selected modality to the concrete channel-variant delivery plan. */
export function planDelivery(modality: Modality, opts: DeliveryOptions): DeliveryPlan {
  const visual = modality.visual || opts.forceVisual === true;
  const sound = modality.sound;

  let variant: ChannelVariant;
  if (!visual) {
    // moving worker, not looking — never grab the screen; shade + watch + haptic
    variant = 'default';
  } else if (sound && opts.alarmGrade) {
    // the maximal case: alarm stream, insistent, full-screen
    variant = 'alarm';
  } else {
    // visible but either sound-suppressed or not alarm-grade (caution)
    variant = 'high';
  }

  return {
    variant,
    sound,
    vibrate: true, // haptic never suppressed
    headsUp: visual,
    fullScreen: visual && opts.alarmGrade,
    insistent: variant === 'alarm',
    inAppOpen: visual,
  };
}
