import { describe, expect, it } from 'vitest';
import type { FloorDef, SiteDef } from '@/sites/types';
import { buildGrid, cellOf, isWalkable } from '@/sim/navmesh';
import { findPath, routeAcrossFloors } from '@/sim/pathing';

const openFloor = (id: string, obstacles: FloorDef['obstacles'] = []): FloorDef => ({
  id,
  label: `floor ${id}`,
  elevation: 0,
  bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
  obstacles,
  machines: [],
  anchors: [],
});

describe('findPath', () => {
  it('finds a route across an empty floor', () => {
    const g = buildGrid(openFloor('1'), 0);
    const path = findPath(g, { x: -4, z: 0 }, { x: 4, z: 0 });
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);
  });

  it('routes around a wall instead of through it', () => {
    // a wall spanning most of the floor, with a gap at the +z end
    const g = buildGrid(openFloor('1', [{ x: -0.5, z: -5, w: 1, d: 8 }]), 0);
    const path = findPath(g, { x: -4, z: -4 }, { x: 4, z: -4 });
    expect(path).not.toBeNull();
    for (const p of path!) {
      const c = cellOf(g, p);
      expect(isWalkable(g, c.col, c.row)).toBe(true);
    }
    // it had to detour, so it is longer than the straight-line cell count
    expect(path!.length).toBeGreaterThan(16);
  });

  it('returns null when the destination is genuinely sealed off', () => {
    // a full-height wall with no gap, destination on the far side
    const g = buildGrid(openFloor('1', [{ x: 1, z: -5, w: 0.5, d: 10 }]), 0);
    expect(findPath(g, { x: -4, z: 0 }, { x: 4.5, z: 0 })).toBeNull();
  });

  it('returns a single point when start and end share a cell', () => {
    const g = buildGrid(openFloor('1'), 0);
    const path = findPath(g, { x: 1.1, z: 1.1 }, { x: 1.2, z: 1.2 });
    expect(path).not.toBeNull();
    expect(path!.length).toBe(1);
  });

  it('never returns a waypoint in an unwalkable cell', () => {
    const g = buildGrid(openFloor('1', [{ x: -2, z: -2, w: 4, d: 4 }]), 0);
    const path = findPath(g, { x: -4.5, z: -4.5 }, { x: 4.5, z: 4.5 });
    expect(path).not.toBeNull();
    for (const p of path!) {
      const c = cellOf(g, p);
      expect(isWalkable(g, c.col, c.row)).toBe(true);
    }
  });
});

describe('routeAcrossFloors', () => {
  const site: SiteDef = {
    id: 'factory',
    style: 'enclosed',
    label: 'test',
    floorHeight: 4,
    floors: [openFloor('1'), openFloor('2'), openFloor('3')],
    portals: [
      {
        id: 's12', kind: 'stairs', fromFloor: '1', toFloor: '2',
        fromPosition: { x: -4, z: 0 }, toPosition: { x: -4, z: 0 }, travelSeconds: 6,
      },
      {
        id: 's23', kind: 'stairs', fromFloor: '2', toFloor: '3',
        fromPosition: { x: -4, z: 0 }, toPosition: { x: -4, z: 0 }, travelSeconds: 6,
      },
    ],
  };
  const grids = new Map(site.floors.map((f) => [f.id, buildGrid(f, 0)]));

  it('walks only, when both ends are on one floor', () => {
    const legs = routeAcrossFloors(
      site, grids,
      { floorId: '1', position: { x: -3, z: -3 } },
      { floorId: '1', position: { x: 3, z: 3 } },
    );
    expect(legs).not.toBeNull();
    expect(legs!.every((l) => l.kind === 'walk')).toBe(true);
  });

  it('walk then portal then walk, for an adjacent floor', () => {
    const legs = routeAcrossFloors(
      site, grids,
      { floorId: '1', position: { x: 3, z: 3 } },
      { floorId: '2', position: { x: 2, z: -2 } },
    );
    expect(legs!.map((l) => l.kind)).toEqual(['walk', 'portal', 'walk']);
  });

  it('chains two portals to reach a floor two levels away', () => {
    const legs = routeAcrossFloors(
      site, grids,
      { floorId: '1', position: { x: 3, z: 3 } },
      { floorId: '3', position: { x: 0, z: 0 } },
    );
    expect(legs!.filter((l) => l.kind === 'portal')).toHaveLength(2);
  });

  it('returns null for a floor no portal reaches', () => {
    const isolated: SiteDef = { ...site, floors: [...site.floors, openFloor('9')] };
    const withNine = new Map([...grids, ['9', buildGrid(openFloor('9'), 0)]]);
    expect(
      routeAcrossFloors(
        isolated, withNine,
        { floorId: '1', position: { x: 0, z: 0 } },
        { floorId: '9', position: { x: 0, z: 0 } },
      ),
    ).toBeNull();
  });

  it('every walk leg stays on the floor it claims', () => {
    const legs = routeAcrossFloors(
      site, grids,
      { floorId: '1', position: { x: 3, z: 3 } },
      { floorId: '3', position: { x: -2, z: 2 } },
    )!;
    for (const leg of legs) {
      if (leg.kind !== 'walk') continue;
      const grid = grids.get(leg.floorId)!;
      for (const p of leg.points) {
        const c = cellOf(grid, p);
        expect(isWalkable(grid, c.col, c.row)).toBe(true);
      }
    }
  });
});
