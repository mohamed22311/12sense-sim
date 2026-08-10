import { describe, expect, it } from 'vitest';
import { createQualitySampler, tierForFrameTime } from '@/quality/detect';

describe('tierForFrameTime', () => {
  it('keeps a comfortable machine on high', () => {
    expect(tierForFrameTime(1000 / 60)).toBe('high');
  });

  it('steps to medium when frames slip below ~50fps', () => {
    expect(tierForFrameTime(1000 / 45)).toBe('medium');
  });

  it('steps to low when frames slip below ~32fps', () => {
    expect(tierForFrameTime(1000 / 24)).toBe('low');
  });
});

describe('createQualitySampler', () => {
  const feed = (sampler: ReturnType<typeof createQualitySampler>, ms: number, count: number) => {
    let decided: string | null = null;
    for (let i = 0; i < count; i++) decided = sampler.sample(ms) ?? decided;
    return decided;
  };

  it('decides nothing during warm-up', () => {
    const sampler = createQualitySampler();
    expect(feed(sampler, 100, 20)).toBeNull();
    expect(sampler.done).toBe(false);
  });

  it('ignores the warm-up frames when judging', () => {
    // 30 catastrophic frames (shader compilation) then 60 good ones must still
    // decide `high` — otherwise every machine is demoted by its own startup.
    const sampler = createQualitySampler();
    feed(sampler, 400, 30);
    expect(feed(sampler, 1000 / 60, 60)).toBe('high');
  });

  it('decides once and then stays quiet', () => {
    const sampler = createQualitySampler();
    feed(sampler, 1000 / 60, 30);
    expect(feed(sampler, 1000 / 60, 60)).toBe('high');
    expect(sampler.done).toBe(true);
    expect(feed(sampler, 1000 / 10, 200)).toBeNull();
  });

  it('is not swayed by a single hitch', () => {
    const sampler = createQualitySampler();
    feed(sampler, 1000 / 60, 30);
    let decided: string | null = null;
    for (let i = 0; i < 59; i++) decided = sampler.sample(1000 / 60) ?? decided;
    decided = sampler.sample(400) ?? decided; // one garbage-collection spike
    expect(decided).toBe('high');
  });

  it('demotes a machine that is genuinely slow', () => {
    const sampler = createQualitySampler();
    feed(sampler, 1000 / 20, 30);
    expect(feed(sampler, 1000 / 20, 60)).toBe('low');
  });
});
