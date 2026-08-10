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

  it('sometimes sends a worker to another floor', () => {
    const floors = new Set<string>();
    for (let i = 0; i < 60; i++) {
      floors.add(
        pickJob(FACTORY, 'materials', '1', seq([i / 60, ((i * 13) % 60) / 60, 0.9])).target.floorId,
      );
    }
    expect(floors.size).toBeGreaterThan(1);
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
