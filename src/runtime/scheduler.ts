/**
 * Ticks the fleet without bunching.
 *
 * Sixty risk assessments in one frame is a visible hitch; sixty spread across
 * the interval is invisible. Each member gets its own slot, so the work per
 * frame is one assessment rather than sixty.
 *
 * The tick callback is deliberately fire-and-forget: a phone's POST must never
 * hold up the next phone's assessment.
 */
export type StaggeredScheduler = { start(): void; stop(): void };

export function createStaggeredScheduler(opts: {
  count: number;
  intervalMs: number;
  onTick: (index: number) => void;
}): StaggeredScheduler {
  const { count, intervalMs, onTick } = opts;
  let timer: ReturnType<typeof setInterval> | null = null;
  let cursor = 0;

  // One slot per member: with 60 members on a 2 s interval, a slot every ~33 ms.
  const slotMs = Math.max(1, Math.floor(intervalMs / Math.max(1, count)));

  return {
    start() {
      if (timer !== null || count === 0) return;
      timer = setInterval(() => {
        onTick(cursor % count);
        cursor++;
      }, slotMs);
    },
    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
      cursor = 0;
    },
  };
}
