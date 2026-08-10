import { afterEach, describe, expect, it } from 'vitest';
import { createHealthWatch, type HealthWatch } from '@/phone/healthWatch';
import { BACKFILL_MS, VitalsBuffer } from '@/phone/vitalsBuffer';

/**
 * The point of these is that the standalone engine and the phone's engine must
 * not drift. Both call the same vendored pair; if one ever starts disagreeing
 * with the other about whether a worker is in danger, that is a bug rather
 * than a difference of intent.
 */

const RESTING = 62;
const DOB = '1990-05-14';

let watch: HealthWatch | null = null;

afterEach(() => {
  watch?.stop();
  watch = null;
});

function withBuffer(seedAt: number) {
  const buffer = new VitalsBuffer();
  buffer.seed(RESTING, seedAt);
  buffer.setSpo2(98, seedAt);
  const buffers = new Map([[1, buffer]]);
  watch = createHealthWatch({
    buffers,
    restingHrFor: () => RESTING,
    dateOfBirthFor: () => DOB,
    // Long enough that the interval never fires during a test; every poll
    // here is driven explicitly by `tick`.
    intervalMs: 1_000_000,
  });
  return { buffer, watch: watch! };
}

describe('the standalone health engine', () => {
  it('reports normal for a resting worker', () => {
    const now = Date.now();
    const { watch } = withBuffer(now);
    watch.tick(now);
    expect(watch.stateFor(1).band).toBe('normal');
    expect(watch.stateFor(1).raised).toBeNull();
  });

  it('raises once a sustained elevation is in the buffer', () => {
    const now = Date.now();
    const { buffer, watch } = withBuffer(now);
    buffer.backfillHr(150, BACKFILL_MS, now);

    // Danger enters on the first qualifying poll; caution needs two. Polling
    // twice covers whichever this crosses into.
    watch.tick(now);
    watch.tick(now + 2_000);

    const state = watch.stateFor(1);
    expect(state.band).not.toBe('normal');
    expect(state.raised).not.toBeNull();
    // The reason is the vendored engine's own words, not ours.
    expect(state.raised?.reason.length ?? 0).toBeGreaterThan(0);
  });

  it('keeps the raise on record after the band settles', () => {
    // The panel shows what was raised, which is not the same question as what
    // the band is right now — a worker who has recovered still generated an
    // alert somebody has to answer for.
    const now = Date.now();
    const { buffer, watch } = withBuffer(now);
    buffer.backfillHr(150, BACKFILL_MS, now);
    watch.tick(now);
    watch.tick(now + 2_000);
    expect(watch.stateFor(1).raised).not.toBeNull();

    buffer.backfillHr(RESTING, BACKFILL_MS, now + 4_000);
    watch.tick(now + 4_000);
    expect(watch.stateFor(1).band).toBe('normal');
    expect(watch.stateFor(1).raised).not.toBeNull();
  });

  it('answers for a worker it has never seen without throwing', () => {
    const now = Date.now();
    const { watch } = withBuffer(now);
    expect(watch.stateFor(999)).toEqual({ band: 'normal', raised: null });
  });
});

describe('the watch surface a health alert carries', () => {
  it('uses the app’s own titles, not our words', () => {
    // These strings are the ones a real handset puts in the notification. If
    // the simulator invents its own, a viewer sees copy the product does not
    // have — which is the specific failure vendoring exists to prevent.
    const now = Date.now();
    const { buffer, watch } = withBuffer(now);
    buffer.backfillHr(150, BACKFILL_MS, now);
    watch.tick(now);
    watch.tick(now + 2_000);

    const raised = watch.stateFor(1).raised;
    expect(raised).not.toBeNull();
    expect(['Caution — elevated strain', 'Danger — stop and rest now']).toContain(raised!.title);
  });

  it('never drops haptic, whatever the context', () => {
    // The app calls vibration the safety floor: every channel variant
    // vibrates, so a masked sound or a suppressed heads-up must never leave a
    // worker with no channel at all.
    const now = Date.now();
    const { buffer, watch } = withBuffer(now);
    buffer.backfillHr(150, BACKFILL_MS, now);
    watch.tick(now);
    watch.tick(now + 2_000);

    expect(watch.stateFor(1).raised!.delivery.vibrate).toBe(true);
  });

  it('starts unanswered and stays answered once acknowledged', () => {
    const now = Date.now();
    const { buffer, watch } = withBuffer(now);
    buffer.backfillHr(150, BACKFILL_MS, now);
    watch.tick(now);
    watch.tick(now + 2_000);
    expect(watch.stateFor(1).raised!.acknowledged).toBe(false);

    watch.acknowledge(1);
    expect(watch.stateFor(1).raised!.acknowledged).toBe(true);

    // A later poll that does not raise must not resurrect the alert as
    // unanswered — the worker already answered this episode.
    watch.tick(now + 4_000);
    expect(watch.stateFor(1).raised!.acknowledged).toBe(true);
  });
});
