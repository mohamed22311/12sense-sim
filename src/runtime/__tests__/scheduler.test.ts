import { describe, expect, it, vi } from 'vitest';
import { createStaggeredScheduler } from '@/runtime/scheduler';

describe('createStaggeredScheduler', () => {
  it('ticks every member once per interval', () => {
    vi.useFakeTimers();
    const ticked: number[] = [];
    const s = createStaggeredScheduler({
      count: 4, intervalMs: 2000, onTick: (i) => ticked.push(i),
    });

    s.start();
    vi.advanceTimersByTime(2000);

    expect([...ticked].sort()).toEqual([0, 1, 2, 3]);
    s.stop();
    vi.useRealTimers();
  });

  it('spreads ticks across the interval rather than bunching them', () => {
    vi.useFakeTimers();
    const at: Record<number, number> = {};
    let clock = 0;
    const s = createStaggeredScheduler({
      count: 4,
      intervalMs: 2000,
      onTick: (i) => { at[i] = clock; },
    });

    s.start();
    for (let step = 0; step < 4; step++) {
      clock += 500;
      vi.advanceTimersByTime(500);
    }

    expect(new Set(Object.values(at)).size).toBeGreaterThan(1);
    s.stop();
    vi.useRealTimers();
  });

  it('stops cleanly', () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const s = createStaggeredScheduler({ count: 2, intervalMs: 1000, onTick });

    s.start();
    s.stop();
    vi.advanceTimersByTime(5000);

    expect(onTick).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
