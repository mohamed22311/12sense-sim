import { describe, expect, it } from 'vitest';
import { FACTORY } from '@/sites/factory';
import { ROLES, roleForIndex } from '@/sim/roles';
import { jobsForRole, pickJob } from '@/sim/jobs';

/** A deterministic stand-in for Math.random, so behaviour is reproducible. */
const seq = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe('roles', () => {
  it('spreads roles across the roster rather than giving everyone one', () => {
    const seen = new Set(Array.from({ length: 60 }, (_, i) => roleForIndex(i + 1)));
    expect(seen.size).toBe(ROLES.length);
  });

  it('is deterministic for a given index', () => {
    expect(roleForIndex(7)).toBe(roleForIndex(7));
  });

  it('gives every role at least two kinds of job', () => {
    for (const role of ROLES) {
      expect(jobsForRole(role).length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('pickJob', () => {
  it('always returns a job on a real floor, inside its bounds', () => {
    for (const role of ROLES) {
      for (let i = 0; i < 30; i++) {
        const job = pickJob(FACTORY, role, '3', seq([i / 30, ((i * 7) % 30) / 30, 0.5]));
        const floor = FACTORY.floors.find((f) => f.id === job.target.floorId);
        expect(floor).toBeDefined();
        expect(job.target.position.x).toBeGreaterThanOrEqual(floor!.bounds.minX);
        expect(job.target.position.x).toBeLessThanOrEqual(floor!.bounds.maxX);
        expect(job.target.position.z).toBeGreaterThanOrEqual(floor!.bounds.minZ);
        expect(job.target.position.z).toBeLessThanOrEqual(floor!.bounds.maxZ);
      }
    }
  });

  it('only ever gives a role a job kind its role permits', () => {
    for (const role of ROLES) {
      const permitted = new Set<string>(jobsForRole(role));
      for (let i = 0; i < 40; i++) {
        const job = pickJob(FACTORY, role, '2', seq([i / 40, ((i * 13) % 40) / 40, 0.3]));
        expect(permitted.has(job.kind)).toBe(true);
      }
    }
  });

  it('gives a positive dwell, so a worker is not teleporting between jobs', () => {
    for (const role of ROLES) {
      const job = pickJob(FACTORY, role, '1', seq([0.3, 0.7, 0.1]));
      expect(job.dwellMs).toBeGreaterThan(0);
    }
  });

  it('never sends a worker off their own floor', () => {
    /*
      The rule the demo rests on. A worker in transit is a worker whose floor
      is ambiguous — `floorId` only changes on arrival, so someone drawn
      halfway up a stairwell still reports the floor they left — and an
      operator checking who alarmed seconds after an alert cannot tell that
      from a bug. Every role, every floor, every draw.
    */
    for (const role of ['technician', 'materials', 'operator', 'supervisor'] as const) {
      for (const floorId of FACTORY.floors.map((f) => f.id)) {
        for (let i = 0; i < 40; i++) {
          const job = pickJob(FACTORY, role, floorId, seq([i / 40, ((i * 13) % 40) / 40, 0.9]));
          expect(job.target.floorId).toBe(floorId);
        }
      }
    }
  });

  it('leaves the floor only when it carries no work of the kind wanted', () => {
    // The one exception, and it is not a compromise: a worker with no work at
    // all is worse than a worker who travels. Real sites do not have this
    // problem, so this is a guard for a malformed one.
    const bare = {
      ...FACTORY,
      floors: FACTORY.floors.map((f) =>
        f.id === '2' ? { ...f, machines: [], anchors: [] } : f,
      ),
    };
    const job = pickJob(bare, 'operator', '2', seq([0.0, 0.0, 0.5]));
    expect(job.target.floorId).not.toBe('2');
  });

  it('is deterministic given the same random sequence', () => {
    const a = pickJob(FACTORY, 'technician', '4', seq([0.42, 0.17, 0.63]));
    const b = pickJob(FACTORY, 'technician', '4', seq([0.42, 0.17, 0.63]));
    expect(a).toEqual(b);
  });

  it('names a machine in the label when the job is machine work', () => {
    const job = pickJob(FACTORY, 'operator', '4', seq([0.0, 0.0, 0.5]));
    if (job.kind === 'operate' || job.kind === 'inspect') {
      expect(job.label.length).toBeGreaterThan(0);
      expect(job.id).toContain(':');
    }
  });

  it('never returns a job whose target is a floor the site does not have', () => {
    const ids = new Set(FACTORY.floors.map((f) => f.id));
    for (const role of ROLES) {
      for (let i = 0; i < 25; i++) {
        const job = pickJob(FACTORY, role, '6', seq([((i * 3) % 25) / 25, i / 25, 0.8]));
        expect(ids.has(job.target.floorId)).toBe(true);
      }
    }
  });
});

describe('pickJob on a malformed site', () => {
  // The site model's promise is that adding a site means adding data. A site
  // that omits an anchor kind must therefore fail by name at the point of use,
  // not return undefined and crash one frame later reading `.id` off nothing.
  const bare = {
    ...FACTORY,
    floors: FACTORY.floors.map((f) => ({ ...f, anchors: [], machines: [] })),
  };

  it('names the missing pool rather than throwing a TypeError', () => {
    let message = '';
    try {
      pickJob(bare, 'cleaner', '1', () => 0.5);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toMatch(/anchors/);
    expect(message).not.toMatch(/undefined/);
  });

  it('names machines when a machine job has no machines', () => {
    let message = '';
    try {
      pickJob(bare, 'operator', '1', () => 0);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toMatch(/machines|anchors/);
  });
});

/**
 * Ten people sent to the same press must not end up in the same half-metre.
 *
 * They did. Every worker on a floor draws from the same handful of anchors and
 * four machines, and a target inside a machine's footprint snaps to one
 * specific walkable cell — so the crowd converged on one spot and stood inside
 * one another, which looked like a rendering fault and made the worker you
 * meant to click unreachable behind two others.
 */
describe('where a job puts you', () => {
  /** A distinct generator per worker, as each agent has. */
  const forWorker = (n: number) => {
    let seed = n * 7919;
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  it('spreads ten workers doing the same job over distinct spots', () => {
    const spots = Array.from({ length: 10 }, (_, i) =>
      pickJob(FACTORY, 'operator', '3', forWorker(i + 1), i + 1).target.position,
    );

    // A navmesh cell is 0.5 m; anything closer than that rounds to one cell
    // and is two people in one place.
    for (let a = 0; a < spots.length; a++) {
      for (let b = a + 1; b < spots.length; b++) {
        const gap = Math.hypot(spots[a].x - spots[b].x, spots[a].z - spots[b].z);
        expect(gap).toBeGreaterThan(0.5);
      }
    }
  });

  it('keeps every spot inside the floor, off the walls', () => {
    // The scatter must never push a target through a wall: a target outside
    // the floor is a route that cannot be planned, which strands the worker
    // instead of moving them.
    const floor = FACTORY.floors[2];
    for (const role of ROLES) {
      for (let i = 0; i < 60; i++) {
        const { position } = pickJob(FACTORY, role, floor.id, forWorker(i + 1), i + 1).target;
        expect(position.x).toBeGreaterThanOrEqual(floor.bounds.minX);
        expect(position.x).toBeLessThanOrEqual(floor.bounds.maxX);
        expect(position.z).toBeGreaterThanOrEqual(floor.bounds.minZ);
        expect(position.z).toBeLessThanOrEqual(floor.bounds.maxZ);
      }
    }
  });

  it('still stands near the thing, not somewhere else entirely', () => {
    // The spread only earns its place if the worker is plainly *at* the
    // machine. Three metres away is attending it; ten is loitering.
    const machine = FACTORY.floors[2].machines[0];
    for (let i = 0; i < 40; i++) {
      const job = pickJob(FACTORY, 'operator', '3', forWorker(i + 1), i + 1);
      if (!job.id.includes(machine.id)) continue;
      const gap = Math.hypot(
        job.target.position.x - machine.position.x,
        job.target.position.z - machine.position.z,
      );
      expect(gap).toBeLessThan(4);
    }
  });
});
