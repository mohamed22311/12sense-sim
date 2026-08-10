import { describe, expect, it } from 'vitest';
import { FACTORY, allMachines, floorOf } from '@/sites/factory';

/**
 * Structural invariants rather than snapshots. Each one exists because
 * breaking it produces a specific, plausible-looking failure downstream:
 * a duplicate machine id makes two assets indistinguishable to a dispatcher,
 * a machine outside its floor bounds cannot be pathed to, and a floor no
 * portal reaches strands every worker who takes a job there.
 */
describe('the factory site', () => {
  it('has six floors labelled 1..6', () => {
    expect(FACTORY.floors.map((f) => f.id)).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('gives every floor a distinct elevation, increasing with its id', () => {
    const ys = FACTORY.floors.map((f) => f.elevation);
    expect(new Set(ys).size).toBe(ys.length);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });

  it('places three or four alertable machines on every floor', () => {
    for (const f of FACTORY.floors) {
      expect(f.machines.length).toBeGreaterThanOrEqual(3);
      expect(f.machines.length).toBeLessThanOrEqual(4);
    }
  });

  it('gives every machine a unique id — asset_id reaches the server', () => {
    const ids = allMachines(FACTORY).map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares each machine on the floor that actually contains it', () => {
    for (const f of FACTORY.floors) {
      for (const m of f.machines) expect(m.floor).toBe(f.id);
    }
  });

  it('keeps every machine and anchor inside its floor bounds', () => {
    for (const f of FACTORY.floors) {
      for (const p of [...f.machines, ...f.anchors]) {
        expect(p.position.x).toBeGreaterThanOrEqual(f.bounds.minX);
        expect(p.position.x).toBeLessThanOrEqual(f.bounds.maxX);
        expect(p.position.z).toBeGreaterThanOrEqual(f.bounds.minZ);
        expect(p.position.z).toBeLessThanOrEqual(f.bounds.maxZ);
      }
    }
  });

  it('gives every floor the anchors the job pool needs', () => {
    for (const f of FACTORY.floors) {
      const kinds = new Set(f.anchors.map((a) => a.kind));
      for (const required of ['stores', 'terminal', 'break'] as const) {
        expect(kinds.has(required)).toBe(true);
      }
    }
  });

  it('connects every floor to at least one other by a portal', () => {
    for (const f of FACTORY.floors) {
      const touching = FACTORY.portals.filter(
        (p) => p.fromFloor === f.id || p.toFloor === f.id,
      );
      expect(touching.length).toBeGreaterThan(0);
    }
  });

  it('names only real floors in portals', () => {
    const ids = new Set(FACTORY.floors.map((f) => f.id));
    for (const p of FACTORY.portals) {
      expect(ids.has(p.fromFloor)).toBe(true);
      expect(ids.has(p.toFloor)).toBe(true);
    }
  });

  it('throws on an unknown floor rather than returning undefined', () => {
    expect(() => floorOf(FACTORY, '99')).toThrow();
  });
});
