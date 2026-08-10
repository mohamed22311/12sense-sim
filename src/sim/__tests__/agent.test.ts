import { describe, expect, it } from 'vitest';
import { FACTORY } from '@/sites/factory';
import { buildGrid } from '@/sim/navmesh';
import { createAgent, type Agent } from '@/sim/agent';

const grids = new Map(FACTORY.floors.map((f) => [f.id, buildGrid(f)]));

/** A cycling sequence, so a run is varied but reproducible. */
const cycling = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

/**
 * A seeded generator, for the tests that exercise a *probabilistic* branch.
 *
 * `cycling` has a period of four or five, which makes it a poor fixture for a
 * decision taken with some probability: change how many times the code calls
 * `rand()` and a short cycle can systematically land on the same side of the
 * comparison forever. That is exactly what happened when the local-floor bias
 * started applying to anchor jobs — two cross-floor tests began failing not
 * because cross-floor travel had broken, but because the fixture could no
 * longer produce it. This is deterministic across runs and still distributed.
 */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const spawn = (overrides: Partial<Parameters<typeof createAgent>[0]> = {}): Agent =>
  createAgent({
    index: 1,
    role: 'technician',
    site: FACTORY,
    grids,
    start: { floorId: '1', position: { x: 0, z: -2 } },
    rand: cycling([0.2, 0.6, 0.4, 0.8, 0.1]),
    ...overrides,
  });

const run = (a: Agent, ms: number, stepMs = 100) => {
  for (let t = 0; t < ms; t += stepMs) a.tick(stepMs);
};

describe('agent', () => {
  it('takes a job immediately rather than idling forever', () => {
    const a = spawn();
    a.tick(16);
    expect(a.state.job).not.toBeNull();
  });

  it('moves toward its target', () => {
    const a = spawn();
    a.tick(16);
    const start = { ...a.state.position };
    run(a, 4_000);
    const moved = Math.hypot(
      a.state.position.x - start.x,
      a.state.position.z - start.z,
    );
    expect(moved).toBeGreaterThan(0.5);
  });

  it('reports the distance walked each tick, which physiology reads', () => {
    const a = spawn();
    a.tick(16);
    a.tick(100);
    expect(a.state.movedThisTick).toBeGreaterThan(0);
  });

  it('reports zero movement on a tick spent entirely dwelling', () => {
    // The arrival tick legitimately carries both: the worker walks the last
    // few centimetres and *then* starts the job. What must be zero is the
    // NEXT tick — a non-zero value there means movedThisTick went stale.
    const a = spawn();
    const isDwelling = () =>
      a.state.job !== null &&
      a.state.activity !== 'walking' &&
      a.state.activity !== 'climbing';

    let checked = false;
    for (let i = 0; i < 4_000 && !checked; i++) {
      a.tick(100);
      if (!isDwelling()) continue;
      a.tick(100);
      if (isDwelling()) {
        expect(a.state.movedThisTick).toBe(0);
        checked = true;
      }
    }
    expect(checked).toBe(true);
  });

  it('always holds a position inside its current floor', () => {
    const a = spawn();
    for (let i = 0; i < 3_000; i++) {
      a.tick(50);
      const f = FACTORY.floors.find((x) => x.id === a.state.floorId)!;
      expect(a.state.position.x).toBeGreaterThanOrEqual(f.bounds.minX - 0.01);
      expect(a.state.position.x).toBeLessThanOrEqual(f.bounds.maxX + 0.01);
      expect(a.state.position.z).toBeGreaterThanOrEqual(f.bounds.minZ - 0.01);
      expect(a.state.position.z).toBeLessThanOrEqual(f.bounds.maxZ + 0.01);
    }
  });

  it('eventually changes floor when a job sends it elsewhere', () => {
    const a = spawn({ index: 2, role: 'materials', rand: seeded(7) });
    const floors = new Set<string>();
    for (let i = 0; i < 20_000; i++) {
      a.tick(50);
      floors.add(a.state.floorId);
    }
    expect(floors.size).toBeGreaterThan(1);
  });

  it('reports climbing while traversing a portal', () => {
    const a = spawn({ index: 3, role: 'materials', rand: seeded(11) });
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) {
      a.tick(50);
      seen.add(a.state.activity);
    }
    expect(seen.has('climbing')).toBe(true);
  });

  it('takes a new job after finishing one', () => {
    const a = spawn();
    a.tick(16);
    const first = a.state.job!.id;
    let changed = false;
    for (let i = 0; i < 20_000 && !changed; i++) {
      a.tick(50);
      if (a.state.job && a.state.job.id !== first) changed = true;
    }
    expect(changed).toBe(true);
  });

  it('faces the direction it is walking', () => {
    const a = spawn();
    a.tick(16);
    let sawFacingChange = false;
    let previous = a.state.facing;
    for (let i = 0; i < 2_000 && !sawFacingChange; i++) {
      a.tick(50);
      if (a.state.activity === 'walking' && a.state.facing !== previous) sawFacingChange = true;
      previous = a.state.facing;
    }
    expect(sawFacingChange).toBe(true);
  });
});
