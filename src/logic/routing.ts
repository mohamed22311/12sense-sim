import type { SensorData, RoutingDecision } from '../state/store';

/**
 * Deterministic alert-routing rules (the "chartered" rules from the Twelve Senses
 * concept note). Modality is chosen from the worker's MOTION and ambient NOISE only:
 *
 *   motion      | noise        | primary | channels           | suppressed
 *   ------------|--------------|---------|--------------------|-----------
 *   moving      | high (>70dB) | haptic  | haptic (¹)         | visual, audio
 *   moving      | low  (≤70dB) | haptic  | haptic, audio      | visual
 *   stationary  | high (>70dB) | haptic  | haptic, visual     | audio
 *   stationary  | low  (≤70dB) | visual  | visual, audio      | haptic
 *
 * (¹) Matches the charter: in motion + HIGH noise the alert is HAPTIC ONLY, because
 *     audio cannot be heard over high noise. This is controlled by
 *     `AUDIO_IN_HIGH_NOISE_MOTION` — set it back to `true` to also play audio here.
 *
 * Safe fallback (constitution: "safe fallback by default"): if noise is missing/NaN
 * it is treated as HIGH (assume the loud, unsafe case); if motion is unknown it is
 * treated as MOVING. Both bias toward the haptic wrist channel — never toward
 * assuming a glanceable screen is safe.
 */

export const NOISE_THRESHOLD_DB = 70;

/** Charter behaviour: haptic-only in motion + high noise. Set to `true` to also play audio. */
export const AUDIO_IN_HIGH_NOISE_MOTION = false;

/** Walking/Running are moving; Stationary/Resting are not. Unknown ⇒ safe fallback (moving). */
export function isMoving(motion: SensorData['motion_state'] | undefined): boolean {
  return motion !== 'Stationary' && motion !== 'Resting';
}

/** Above the dB threshold is "high noise". Missing/NaN ⇒ safe fallback (treated as high). */
export function isHighNoise(noiseLevel: number | undefined): boolean {
  if (typeof noiseLevel !== 'number' || Number.isNaN(noiseLevel)) return true;
  return noiseLevel > NOISE_THRESHOLD_DB;
}

export function routeWorker(sensors: SensorData): RoutingDecision {
  const moving = isMoving(sensors.motion_state);
  const highNoise = isHighNoise(sensors.noise_level);

  if (moving && highNoise) {
    return AUDIO_IN_HIGH_NOISE_MOTION
      ? { channels: ['haptic', 'audio'], primary: 'haptic', suppressed: ['visual'] }
      : { channels: ['haptic'], primary: 'haptic', suppressed: ['visual', 'audio'] };
  }
  if (moving && !highNoise) return { channels: ['haptic', 'audio'],  primary: 'haptic', suppressed: ['visual'] };
  if (!moving && highNoise) return { channels: ['haptic', 'visual'], primary: 'haptic', suppressed: ['audio']  };
  return                           { channels: ['visual', 'audio'],  primary: 'visual', suppressed: ['haptic'] };
}

/** Human-readable explanation for a routing decision (used by the alert console). */
export function buildReason(moving: boolean, highNoise: boolean): string {
  if (moving && highNoise)  return 'In motion + high noise — haptic only (audio suppressed)';
  if (moving && !highNoise) return 'In motion + low noise — haptic primary, audio secondary';
  if (!moving && highNoise) return 'Stationary + high noise — haptic + visual (audio suppressed)';
  return 'Stationary + low noise — visual primary, audio secondary';
}

/** At-risk flags surfaced on the worker panel / dashboard. */
export function buildFlags(sensors: SensorData): string[] {
  const flags: string[] = [];
  if (sensors.stress_index > 70)        flags.push('High Stress');
  if (sensors.heart_rate > 100)         flags.push('Elevated HR');
  if (sensors.spo2 < 95)                flags.push('Low SpO₂');
  if (sensors.battery < 15)             flags.push('Low Battery');
  if (sensors.noise_level > NOISE_THRESHOLD_DB) flags.push(`${Math.round(sensors.noise_level)} dB`);
  return flags;
}
