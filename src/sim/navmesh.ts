/**
 * A floor's walkability grid.
 *
 * Deliberately a uniform grid rather than a polygon navmesh: a floor here is a
 * rectangle with axis-aligned box obstacles, so a grid is *exact* for this
 * geometry, trivially inspectable when a worker walks somewhere strange, and
 * cheap to rebuild when a floor's contents change. At 0.5 m over a 16 x 16 m
 * floor it is 32 x 32 = 1024 cells.
 *
 * `clearance` inflates every obstacle by roughly a worker's half-width, so a
 * path that hugs a corner still leaves the body clear of the geometry. Pathing
 * therefore never has to know how wide a worker is — the grid has already
 * accounted for it.
 */
import type { FloorDef, ObstacleRect, Vec2 } from '@/sites/types';

export const CELL_SIZE = 0.5;

/** Half a worker's shoulder width; the default inflation for every obstacle. */
export const DEFAULT_CLEARANCE = 0.35;

export type Grid = {
  floorId: string;
  minX: number;
  minZ: number;
  cols: number;
  rows: number;
  /** row-major, 1 = walkable */
  walkable: Uint8Array;
};

const indexOf = (grid: Grid, col: number, row: number) => row * grid.cols + col;

const inflate = (r: ObstacleRect, by: number): ObstacleRect => ({
  x: r.x - by,
  z: r.z - by,
  w: r.w + by * 2,
  d: r.d + by * 2,
});

export function buildGrid(floor: FloorDef, clearance = DEFAULT_CLEARANCE): Grid {
  const { minX, maxX, minZ, maxZ } = floor.bounds;
  const cols = Math.ceil((maxX - minX) / CELL_SIZE);
  const rows = Math.ceil((maxZ - minZ) / CELL_SIZE);

  const grid: Grid = {
    floorId: floor.id,
    minX,
    minZ,
    cols,
    rows,
    walkable: new Uint8Array(cols * rows).fill(1),
  };

  const blocks = floor.obstacles.map((o) => inflate(o, clearance));
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = minX + (col + 0.5) * CELL_SIZE;
      const cz = minZ + (row + 0.5) * CELL_SIZE;
      const blocked = blocks.some(
        (b) => cx >= b.x && cx <= b.x + b.w && cz >= b.z && cz <= b.z + b.d,
      );
      if (blocked) grid.walkable[indexOf(grid, col, row)] = 0;
    }
  }
  return grid;
}

export function cellOf(grid: Grid, p: Vec2): { col: number; row: number } {
  return {
    col: Math.floor((p.x - grid.minX) / CELL_SIZE),
    row: Math.floor((p.z - grid.minZ) / CELL_SIZE),
  };
}

export function centreOf(grid: Grid, col: number, row: number): Vec2 {
  return {
    x: grid.minX + (col + 0.5) * CELL_SIZE,
    z: grid.minZ + (row + 0.5) * CELL_SIZE,
  };
}

export function isWalkable(grid: Grid, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false;
  return grid.walkable[indexOf(grid, col, row)] === 1;
}

/**
 * The nearest open cell to `p`, found by expanding rings.
 *
 * Exists because authored data legitimately puts targets inside geometry — a
 * machine's own position is the middle of its footprint, and that is the
 * natural thing to write in the site file. Rather than making every caller
 * offset by hand, a target inside an obstacle degrades to "stand beside it".
 * Returns null only when the floor has no open cell at all.
 */
export function nearestWalkable(grid: Grid, p: Vec2): Vec2 | null {
  const start = cellOf(grid, p);
  const maxRing = Math.max(grid.cols, grid.rows);

  for (let ring = 0; ring <= maxRing; ring++) {
    for (let dc = -ring; dc <= ring; dc++) {
      for (let dr = -ring; dr <= ring; dr++) {
        // Only the ring's perimeter; the interior was covered by earlier rings.
        if (ring > 0 && Math.abs(dc) !== ring && Math.abs(dr) !== ring) continue;
        const col = start.col + dc;
        const row = start.row + dr;
        if (isWalkable(grid, col, row)) return centreOf(grid, col, row);
      }
    }
  }
  return null;
}
