import { describe, expect, it } from 'vitest';
import type { FloorDef } from '@/sites/types';
import {
  CELL_SIZE,
  buildGrid,
  cellOf,
  centreOf,
  isWalkable,
  nearestWalkable,
} from '@/sim/navmesh';

const floor: FloorDef = {
  id: '1',
  label: 'test',
  elevation: 0,
  bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
  obstacles: [{ x: -1, z: -1, w: 2, d: 2 }], // a 2x2 block at the centre
  machines: [],
  anchors: [],
};

describe('buildGrid', () => {
  it('covers the floor bounds at CELL_SIZE resolution', () => {
    const g = buildGrid(floor, 0);
    expect(g.cols).toBe(Math.ceil(10 / CELL_SIZE));
    expect(g.rows).toBe(Math.ceil(10 / CELL_SIZE));
    expect(g.walkable.length).toBe(g.cols * g.rows);
  });

  it('marks obstacle cells unwalkable and open cells walkable', () => {
    const g = buildGrid(floor, 0);
    const inside = cellOf(g, { x: 0, z: 0 });
    expect(isWalkable(g, inside.col, inside.row)).toBe(false);
    const outside = cellOf(g, { x: 4, z: 4 });
    expect(isWalkable(g, outside.col, outside.row)).toBe(true);
  });

  it('applies clearance so a worker cannot clip an obstacle corner', () => {
    const blocked = (clearance: number) =>
      buildGrid(floor, clearance).walkable.reduce((n, v) => n + (v ? 0 : 1), 0);
    expect(blocked(0.5)).toBeGreaterThan(blocked(0));
  });

  it('round-trips a point through cellOf and centreOf to within half a cell', () => {
    const g = buildGrid(floor, 0);
    const p = { x: 2.3, z: -3.1 };
    const c = cellOf(g, p);
    const back = centreOf(g, c.col, c.row);
    expect(Math.abs(back.x - p.x)).toBeLessThanOrEqual(CELL_SIZE);
    expect(Math.abs(back.z - p.z)).toBeLessThanOrEqual(CELL_SIZE);
  });

  it('treats anything outside the bounds as unwalkable', () => {
    const g = buildGrid(floor, 0);
    const c = cellOf(g, { x: 99, z: 99 });
    expect(isWalkable(g, c.col, c.row)).toBe(false);
  });

  it('nudges a point inside an obstacle to the nearest open cell', () => {
    const g = buildGrid(floor, 0);
    const fixed = nearestWalkable(g, { x: 0, z: 0 });
    expect(fixed).not.toBeNull();
    const c = cellOf(g, fixed!);
    expect(isWalkable(g, c.col, c.row)).toBe(true);
  });

  it('returns null when no cell is walkable at all', () => {
    const sealed = { ...floor, obstacles: [{ x: -5, z: -5, w: 10, d: 10 }] };
    expect(nearestWalkable(buildGrid(sealed, 0), { x: 0, z: 0 })).toBeNull();
  });
});
