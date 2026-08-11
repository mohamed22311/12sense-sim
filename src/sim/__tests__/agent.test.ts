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

  it('never leaves the floor it started on', () => {
    /*
      Was the opposite assertion. Workers used to take jobs anywhere on the
      site, which put a steady fraction of them on a staircase — and a worker
      on a staircase reports the floor they *left*, because `floorId` only
      changes on arrival. So the screen showed someone between levels while
      their phone gated on the floor below, and an operator checking who
      alarmed had no way to tell that from a broken gate.
    */
    for (const [index, role] of [
      [2, 'materials'], [3, 'technician'], [4, 'operator'], [5, 'cleaner'],
    ] as const) {
      const a = spawn({ index, role, rand: seeded(index * 7) });
      const floors = new Set<string>();
      for (let i = 0; i < 20_000; i++) {
        a.tick(50);
        floors.add(a.state.floorId);
      }
      expect([...floors]).toEqual(['1']);
    }
  });

  it('never reports climbing, because nobody uses the stairs', () => {
    const a = spawn({ index: 3, role: 'materials', rand: seeded(11) });
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) {
      a.tick(50);
      seen.add(a.state.activity);
    }
    expect(seen.has('climbing')).toBe(false);
  });

  it('still traverses a portal when a floor carries no work at all', () => {
    // The machinery is intact and one flag away — this exercises it through
    // the only path that still reaches it, a floor with nothing to do on it.
    const bare = {
      ...FACTORY,
      floors: FACTORY.floors.map((f) =>
        f.id === '1' ? { ...f, machines: [], anchors: [] } : f,
      ),
    };
    const a = spawn({ index: 6, role: 'operator', site: bare, rand: seeded(3) });
    const seen = new Set<string>();
    const floors = new Set<string>();
    for (let i = 0; i < 20_000; i++) {
      a.tick(50);
      seen.add(a.state.activity);
      floors.add(a.state.floorId);
    }
    expect(seen.has('climbing')).toBe(true);
    expect(floors.size).toBeGreaterThan(1);
  });

  it('takes a new job after finishing one', () => {
    /*
      Seeded, not `cycling`. A five-value cycle is a poor fixture for anything
      that consumes a variable number of `rand()` calls — and picking *where to
      stand* near a target now consumes two more per job, which re-aligned the
      cycle so the same anchor came up forever. The job really did change; the
      fixture could no longer express it. Same trap as the two cross-floor
      tests above, and the same fix.
    */
    const a = spawn({ rand: seeded(23) });
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
