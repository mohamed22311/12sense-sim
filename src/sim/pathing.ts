/**
 * A* within a floor, and a breadth-first portal search between floors.
 *
 * Two separate problems, deliberately kept separate. Inside a floor the cost is
 * distance. Between floors the cost is "how many stairwells" — a worker does
 * not weigh three metres of walking against a lift ride, they just go. Folding
 * both into one weighted search would need a made-up exchange rate between
 * metres and flights of stairs, and would make each search harder to test.
 */
import type { PortalDef, SiteDef, Vec2 } from '@/sites/types';
import {
  cellOf,
  centreOf,
  isWalkable,
  nearestWalkable,
  type Grid,
} from '@/sim/navmesh';

export type Waypoint = { floorId: string; position: Vec2 };

export type Leg =
  | { kind: 'walk'; floorId: string; points: Vec2[] }
  | { kind: 'portal'; portal: PortalDef };

/** 8-way movement. Diagonals cost √2, so cutting a corner is not free. */
const NEIGHBOURS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/** Grids are far narrower than this, so col and row never collide. */
const KEY_STRIDE = 100_000;
const keyOf = (col: number, row: number) => row * KEY_STRIDE + col;
const colOfKey = (key: number) => key % KEY_STRIDE;
const rowOfKey = (key: number) => (key - (key % KEY_STRIDE)) / KEY_STRIDE;

export function findPath(grid: Grid, from: Vec2, to: Vec2): Vec2[] | null {
  const goalPoint = nearestWalkable(grid, to);
  if (goalPoint === null) return null;
  const startPoint = nearestWalkable(grid, from);
  if (startPoint === null) return null;

  const start = cellOf(grid, startPoint);
  const goal = cellOf(grid, goalPoint);
  if (start.col === goal.col && start.row === goal.row) {
    return [centreOf(grid, goal.col, goal.row)];
  }

  const heuristic = (col: number, row: number) =>
    Math.hypot(col - goal.col, row - goal.row);

  const open: { col: number; row: number; f: number }[] = [
    { col: start.col, row: start.row, f: heuristic(start.col, start.row) },
  ];
  const cameFrom = new Map<number, number>();
  const best = new Map<number, number>([[keyOf(start.col, start.row), 0]]);
  const closed = new Set<number>();

  while (open.length > 0) {
    // ~1k cells per floor: a linear scan beats a binary heap's constant factor,
    // and keeps this readable enough to debug when a worker paths oddly.
    let bestAt = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bestAt].f) bestAt = i;
    const current = open.splice(bestAt, 1)[0];
    const currentKey = keyOf(current.col, current.row);
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);

    if (current.col === goal.col && current.row === goal.row) {
      const points: Vec2[] = [];
      let key: number | undefined = currentKey;
      while (key !== undefined) {
        points.push(centreOf(grid, colOfKey(key), rowOfKey(key)));
        key = cameFrom.get(key);
      }
      return points.reverse();
    }

    for (const [dc, dr, cost] of NEIGHBOURS) {
      const col = current.col + dc;
      const row = current.row + dr;
      if (!isWalkable(grid, col, row)) continue;

      // No corner-cutting: a diagonal needs both orthogonal neighbours open, or
      // a worker clips the corner of a machine — which reads on screen as
      // walking through it.
      if (dc !== 0 && dr !== 0) {
        if (!isWalkable(grid, current.col + dc, current.row)) continue;
        if (!isWalkable(grid, current.col, current.row + dr)) continue;
      }

      const neighbourKey = keyOf(col, row);
      if (closed.has(neighbourKey)) continue;
      const tentative = (best.get(currentKey) ?? Infinity) + cost;
      if (tentative < (best.get(neighbourKey) ?? Infinity)) {
        cameFrom.set(neighbourKey, currentKey);
        best.set(neighbourKey, tentative);
        open.push({ col, row, f: tentative + heuristic(col, row) });
      }
    }
  }
  return null;
}

/** Portals usable from `floorId`, in either declared direction. */
function portalsFrom(site: SiteDef, floorId: string): { portal: PortalDef; to: string }[] {
  const out: { portal: PortalDef; to: string }[] = [];
  for (const p of site.portals) {
    if (p.fromFloor === floorId) out.push({ portal: p, to: p.toFloor });
    else if (p.toFloor === floorId) out.push({ portal: p, to: p.fromFloor });
  }
  return out;
}

/** Where a portal is entered or left, on whichever floor you are standing on. */
function pointOn(portal: PortalDef, floorId: string): Vec2 {
  return portal.fromFloor === floorId ? portal.fromPosition : portal.toPosition;
}

const otherFloor = (portal: PortalDef, floorId: string) =>
  portal.fromFloor === floorId ? portal.toFloor : portal.fromFloor;

export function routeAcrossFloors(
  site: SiteDef,
  grids: Map<string, Grid>,
  from: Waypoint,
  to: Waypoint,
): Leg[] | null {
  if (from.floorId === to.floorId) {
    const grid = grids.get(from.floorId);
    if (!grid) return null;
    const points = findPath(grid, from.position, to.position);
    return points === null ? null : [{ kind: 'walk', floorId: from.floorId, points }];
  }

  // Fewest portals wins. Breadth-first is exactly that, and it terminates on a
  // handful of floors — no need for anything cleverer.
  const previous = new Map<string, { floorId: string; portal: PortalDef }>();
  const seen = new Set<string>([from.floorId]);
  const queue: string[] = [from.floorId];
  while (queue.length > 0) {
    const floorId = queue.shift()!;
    if (floorId === to.floorId) break;
    for (const { portal, to: next } of portalsFrom(site, floorId)) {
      if (seen.has(next)) continue;
      seen.add(next);
      previous.set(next, { floorId, portal });
      queue.push(next);
    }
  }
  if (!seen.has(to.floorId)) return null;

  const chain: { floorId: string; portal: PortalDef }[] = [];
  let cursor = to.floorId;
  while (cursor !== from.floorId) {
    const step = previous.get(cursor);
    if (!step) return null;
    chain.unshift(step);
    cursor = step.floorId;
  }

  const legs: Leg[] = [];
  let position = from.position;
  let floorId = from.floorId;
  for (const step of chain) {
    const grid = grids.get(floorId);
    if (!grid) return null;
    const points = findPath(grid, position, pointOn(step.portal, floorId));
    if (points === null) return null;
    legs.push({ kind: 'walk', floorId, points });
    legs.push({ kind: 'portal', portal: step.portal });
    floorId = otherFloor(step.portal, floorId);
    position = pointOn(step.portal, floorId);
  }

  const lastGrid = grids.get(to.floorId);
  if (!lastGrid) return null;
  const finalPoints = findPath(lastGrid, position, to.position);
  if (finalPoints === null) return null;
  legs.push({ kind: 'walk', floorId: to.floorId, points: finalPoints });
  return legs;
}
