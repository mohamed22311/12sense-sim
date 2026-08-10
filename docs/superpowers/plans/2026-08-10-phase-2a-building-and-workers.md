# Phase 2A — The Building and Its Workers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-room factory into a six-floor building whose sixty workers live in it — pathing around real obstacles, taking role-appropriate jobs, riding stairs and lifts between floors — and feed every one of those positions, floors and activities into the phone fleet built in Phase 1.

**Architecture:** A declarative site data module describes six floors, their obstacles, machines, job anchors and portals. `sim/` turns that into a navmesh, a job pool and one agent per worker. `runtime/` widens the existing `getContext` seam so each `VirtualPhone` reads its own worker's real position, floor and activity instead of a fixed stub. The phone layer is not restructured — Phase 1 put the seam in the right place, and this phase only fills it.

**Tech Stack:** TypeScript, React 18, Vite 8, Vitest 4, Zustand 5, three.js 0.170 / @react-three/fiber 8 / drei 9 — all already present. No new runtime dependencies.

## Global Constraints

- **Working directory is `scene-3d/`.** Every path is relative to it.
- **Vendored files are never edited** — `src/phone/vendor/**` and `src/api/types.ts`. If something will not compile or behave, the fix goes in a caller, an adapter or config. `npm run check:vendor` enforces this and now also fails on an unlisted file under the vendor tree.
- **No threshold in the vendored configs is altered.** `RISK_CONFIG`, `ALERT_CONFIG`, `NOISE_CONFIG`, `PROXIMITY_CONFIG` ship exactly as the app has them.
- **No decision logic in the simulator.** Proximity, modality and risk belong to the vendored modules. Classification of *raw inputs* (is this worker moving, is this noisy) is the simulator's job; deciding what to do about them is not.
- **No new npm dependencies.**
- **No test may make a network call.** The target server is production and its accounts cannot be deleted except through the demo-tenant purge.
- Before every commit: `npx tsc -p tsconfig.app.json --noEmit`, `npm run check:vendor`, `npm run test:run`. Baseline is **386 passing across 22 files, zero skipped**.
- Scene work is judged in the browser, not only by tests. `npm run dev` must stay runnable throughout; a task that leaves the scene blank is not done.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `src/sites/types.ts` | `FloorDef`, `MachineDef`, `ObstacleRect`, `JobAnchor`, `PortalDef`, `SiteDef` |
| `src/sites/factory/index.ts` | The factory: six floors assembled into one `SiteDef` |
| `src/sites/factory/floors.ts` | Per-floor geometry, machines, anchors, portals |
| `src/sim/navmesh.ts` | Site data → per-floor walkability grid |
| `src/sim/pathing.ts` | A\* over a grid, plus portal-aware cross-floor routing |
| `src/sim/roles.ts` | Role definitions and which jobs each accepts |
| `src/sim/jobs.ts` | The job pool, selection, and per-job duration/animation |
| `src/sim/agent.ts` | One worker: position, floor, current job, path following |
| `src/sim/agents.ts` | The agent set; ticks them and answers "where is worker N" |
| `src/phone/physiology.ts` | Activity → heart-rate drift and step buckets |
| `src/scene/building/Building.tsx` | The dollhouse stack |
| `src/scene/building/FloorSlab.tsx` | One floor: slab, walls, active/dim treatment |
| `src/scene/building/Portals.tsx` | Stairs and lift, drawn from portal data |
| `src/state/buildingStore.ts` | Active floor, camera focus, quality tier |

**Modified:** `src/runtime/fleet.ts` (real `getContext`), `src/phone/VirtualPhone.ts` (widened `PhoneContext`), `src/scene/Scene.tsx` (render the building), `src/App.tsx` (own the agent tick).

**Deleted at the end of Task 9:** `src/scene/sceneDefs.ts`, `src/scene/Floor.tsx`, `src/scene/Walls.tsx`, `src/scene/Ceiling.tsx` — superseded by the site data model and the building components. `Machine.tsx`, `Worker.tsx`, `DecoWorker.tsx`, `Stairs.tsx`, `ConveyorBelt.tsx` and `AlertOrb.tsx` survive into Phase 2C's visual pass.

---

### Task 1: The site data model

**Files:**
- Create: `src/sites/types.ts`, `src/sites/factory/floors.ts`, `src/sites/factory/index.ts`
- Test: `src/sites/__tests__/factory.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
```ts
export type Vec2 = { x: number; z: number };
export type ObstacleRect = { x: number; z: number; w: number; d: number };
export type MachineDef = {
  id: string;              // e.g. 'CHILLER-07' — the asset_id sent to the server
  label: string;
  floor: string;           // '1'..'6' — matches Event.floor
  position: Vec2;
  rotationY: number;
  kind: 'chiller' | 'panel' | 'reactor' | 'press' | 'packer' | 'furnace';
};
export type JobAnchorKind = 'stores' | 'terminal' | 'break' | 'inspect' | 'sweep';
export type JobAnchor = { id: string; kind: JobAnchorKind; floor: string; position: Vec2 };
export type PortalDef = {
  id: string; kind: 'stairs' | 'lift';
  fromFloor: string; toFloor: string;
  fromPosition: Vec2; toPosition: Vec2;
  travelSeconds: number;
};
export type FloorDef = {
  id: string;              // '1'..'6'
  label: string;           // 'Goods-in / dispatch'
  elevation: number;       // metres, floor slab top
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  obstacles: ObstacleRect[];
  machines: MachineDef[];
  anchors: JobAnchor[];
};
export type SiteDef = {
  id: 'factory' | 'construction';
  label: string;
  floors: FloorDef[];
  portals: PortalDef[];
  floorHeight: number;
};
export const FACTORY: SiteDef;
export function floorOf(site: SiteDef, floorId: string): FloorDef;   // throws on unknown
export function allMachines(site: SiteDef): MachineDef[];
```

- [ ] **Step 1: Write the failing test**

```ts
// src/sites/__tests__/factory.test.ts
import { describe, expect, it } from 'vitest';
import { FACTORY, allMachines, floorOf } from '@/sites/factory';

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
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/sites/__tests__/factory.test.ts`
Expected: FAIL — cannot resolve `@/sites/factory`.

- [ ] **Step 3: Implement `src/sites/types.ts`**

Write the types exactly as the Interfaces block above declares them, with a file header explaining that a site is **data, not code** — adding the construction site in Phase 5 must mean adding a module here and nothing else.

- [ ] **Step 4: Implement the six floors**

Create `src/sites/factory/floors.ts` exporting `FACTORY_FLOORS: FloorDef[]`, and `src/sites/factory/index.ts` assembling `FACTORY` plus the two helpers.

Use a consistent building footprint on every floor — `bounds` of `minX: -8, maxX: 8, minZ: -14, maxZ: 2` — with `floorHeight: 4` and elevations `0, 4, 8, 12, 16, 20`. Content per the design's §5 table:

| Floor | Label | Machines |
|---|---|---|
| 1 | Goods-in / dispatch | `DOCK-LIFT-01`, `PALLET-WRAP-02`, `CONVEYOR-IN-03` |
| 2 | Material prep | `MIXER-04`, `SILO-05`, `HOPPER-06` |
| 3 | Production hall | `PRESS-12`, `CNC-07`, `CONVEYOR-08`, `ROBOT-09` |
| 4 | Process hall | `REACTOR-01`, `CHILLER-07`, `PRESSURE-VESSEL-10` |
| 5 | Packaging & QA | `PACK-03`, `LABELLER-11`, `INSPECT-BENCH-13` |
| 6 | Plant & control | `COMPRESSOR-01`, `SWITCHGEAR-14`, `HVAC-15` |

Give each floor three obstacle rectangles at minimum (the machines' own footprints plus at least one wall or plant block), and the three required anchors (`stores`, `terminal`, `break`) plus any of `inspect` / `sweep` you want. Portals: a stairwell at `x: -7, z: 0` connecting every adjacent pair in both directions (`travelSeconds: 6`), and a lift at `x: 7, z: 0` connecting every adjacent pair in both directions (`travelSeconds: 4`).

Keep every machine and anchor at least 1 m inside `bounds` so the navmesh has room to path around them.

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/sites/__tests__/factory.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add src/sites
git commit -m "feat: describe the factory as six floors of data

A site is data, not code: floors, obstacles, machines with their own floor
label and coordinates, job anchors and portals. Adding the construction site
later means adding a module here and touching nothing else.

The tests are structural invariants rather than snapshots — machine ids are
unique because asset_id reaches the server, every machine is declared on the
floor that contains it, everything sits inside its floor's bounds, and every
floor is reachable by at least one portal."
```

---

### Task 2: The navmesh

**Files:**
- Create: `src/sim/navmesh.ts`
- Test: `src/sim/__tests__/navmesh.test.ts`

**Interfaces:**
- Consumes: `FloorDef`, `ObstacleRect`, `Vec2` from `@/sites/types`
- Produces:
```ts
export const CELL_SIZE = 0.5;                    // metres per grid cell
export type Grid = {
  floorId: string;
  minX: number; minZ: number;
  cols: number; rows: number;
  walkable: Uint8Array;                          // row-major, 1 = walkable
};
export function buildGrid(floor: FloorDef, clearance?: number): Grid;
export function cellOf(grid: Grid, p: Vec2): { col: number; row: number };
export function centreOf(grid: Grid, col: number, row: number): Vec2;
export function isWalkable(grid: Grid, col: number, row: number): boolean;
export function nearestWalkable(grid: Grid, p: Vec2): Vec2 | null;
```

- [ ] **Step 1: Write the failing test**

```ts
// src/sim/__tests__/navmesh.test.ts
import { describe, expect, it } from 'vitest';
import type { FloorDef } from '@/sites/types';
import { CELL_SIZE, buildGrid, cellOf, centreOf, isWalkable, nearestWalkable } from '@/sim/navmesh';

const floor: FloorDef = {
  id: '1', label: 'test', elevation: 0,
  bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
  obstacles: [{ x: -1, z: -1, w: 2, d: 2 }],   // a 2x2 block at the centre
  machines: [], anchors: [],
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
    const tight = buildGrid(floor, 0);
    const padded = buildGrid(floor, 0.5);
    const blocked = (g: ReturnType<typeof buildGrid>) =>
      g.walkable.reduce((n, v) => n + (v ? 0 : 1), 0);
    expect(blocked(padded)).toBeGreaterThan(blocked(tight));
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
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/sim/__tests__/navmesh.test.ts`
Expected: FAIL — cannot resolve `@/sim/navmesh`.

- [ ] **Step 3: Implement**

```ts
// src/sim/navmesh.ts
/**
 * A floor's walkability grid.
 *
 * Deliberately a uniform grid rather than a polygon mesh: a floor is a
 * rectangle with box obstacles, so a grid is exact here, trivially debuggable,
 * and cheap to rebuild when a floor's contents change. At 0.5 m over a 16x16 m
 * floor it is 32x32 = 1024 cells — nothing.
 *
 * `clearance` inflates every obstacle by roughly a worker's half-width, so a
 * path that hugs a corner still leaves the body clear of the geometry. Pathing
 * therefore never needs to know how wide a worker is.
 */
import type { FloorDef, ObstacleRect, Vec2 } from '@/sites/types';

export const CELL_SIZE = 0.5;

/** Half a worker's shoulder width, the default inflation for every obstacle. */
export const DEFAULT_CLEARANCE = 0.35;

export type Grid = {
  floorId: string;
  minX: number;
  minZ: number;
  cols: number;
  rows: number;
  walkable: Uint8Array;
};

const idx = (grid: Grid, col: number, row: number) => row * grid.cols + col;

const inflate = (r: ObstacleRect, by: number): ObstacleRect => ({
  x: r.x - by, z: r.z - by, w: r.w + by * 2, d: r.d + by * 2,
});

export function buildGrid(floor: FloorDef, clearance = DEFAULT_CLEARANCE): Grid {
  const { minX, maxX, minZ, maxZ } = floor.bounds;
  const cols = Math.ceil((maxX - minX) / CELL_SIZE);
  const rows = Math.ceil((maxZ - minZ) / CELL_SIZE);
  const grid: Grid = { floorId: floor.id, minX, minZ, cols, rows, walkable: new Uint8Array(cols * rows) };
  grid.walkable.fill(1);

  const blocks = floor.obstacles.map((o) => inflate(o, clearance));
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = minX + (col + 0.5) * CELL_SIZE;
      const cz = minZ + (row + 0.5) * CELL_SIZE;
      const blocked = blocks.some(
        (b) => cx >= b.x && cx <= b.x + b.w && cz >= b.z && cz <= b.z + b.d,
      );
      if (blocked) grid.walkable[idx(grid, col, row)] = 0;
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
  return grid.walkable[idx(grid, col, row)] === 1;
}

/**
 * The nearest open cell to `p`, by expanding rings. Used whenever authored data
 * puts a target inside geometry — a machine's interaction point, say — so a bad
 * coordinate degrades to "stand beside it" rather than failing to path at all.
 */
export function nearestWalkable(grid: Grid, p: Vec2): Vec2 | null {
  const start = cellOf(grid, p);
  const maxRing = Math.max(grid.cols, grid.rows);
  for (let ring = 0; ring <= maxRing; ring++) {
    for (let dc = -ring; dc <= ring; dc++) {
      for (let dr = -ring; dr <= ring; dr++) {
        if (ring > 0 && Math.abs(dc) !== ring && Math.abs(dr) !== ring) continue;
        const col = start.col + dc;
        const row = start.row + dr;
        if (isWalkable(grid, col, row)) return centreOf(grid, col, row);
      }
    }
  }
  return null;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/sim/__tests__/navmesh.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/sim/navmesh.ts src/sim/__tests__/navmesh.test.ts
git commit -m "feat: per-floor walkability grid

A uniform grid rather than a polygon mesh, because a floor is a rectangle with
box obstacles — the grid is exact here, debuggable, and 1024 cells at 0.5 m
over a 16x16 m floor.

Obstacles inflate by a worker's half-width, so pathing never has to know how
wide a worker is and a path that hugs a corner still clears the geometry.
nearestWalkable exists so authored data that puts a target inside a machine
degrades to standing beside it rather than failing to path."
```

---

### Task 3: A\* and cross-floor routing

**Files:**
- Create: `src/sim/pathing.ts`
- Test: `src/sim/__tests__/pathing.test.ts`

**Interfaces:**
- Consumes: `Grid`, `cellOf`, `centreOf`, `isWalkable`, `nearestWalkable`, `CELL_SIZE` from `@/sim/navmesh`; `PortalDef`, `SiteDef`, `Vec2` from `@/sites/types`
- Produces:
```ts
export type Waypoint = { floorId: string; position: Vec2 };
export type Leg =
  | { kind: 'walk'; floorId: string; points: Vec2[] }
  | { kind: 'portal'; portal: PortalDef };
export function findPath(grid: Grid, from: Vec2, to: Vec2): Vec2[] | null;
export function routeAcrossFloors(
  site: SiteDef, grids: Map<string, Grid>,
  from: Waypoint, to: Waypoint,
): Leg[] | null;
```

- [ ] **Step 1: Write the failing test**

```ts
// src/sim/__tests__/pathing.test.ts
import { describe, expect, it } from 'vitest';
import type { FloorDef, SiteDef } from '@/sites/types';
import { buildGrid, cellOf, isWalkable } from '@/sim/navmesh';
import { findPath, routeAcrossFloors } from '@/sim/pathing';

const openFloor = (id: string, obstacles: FloorDef['obstacles'] = []): FloorDef => ({
  id, label: `floor ${id}`, elevation: 0,
  bounds: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 },
  obstacles, machines: [], anchors: [],
});

describe('findPath', () => {
  it('finds a straight route across an empty floor', () => {
    const g = buildGrid(openFloor('1'), 0);
    const path = findPath(g, { x: -4, z: 0 }, { x: 4, z: 0 });
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);
  });

  it('routes around a wall instead of through it', () => {
    // a wall spanning the middle, with a gap at the top
    const g = buildGrid(openFloor('1', [{ x: -0.5, z: -5, w: 1, d: 8 }]), 0);
    const path = findPath(g, { x: -4, z: 0 }, { x: 4, z: 0 });
    expect(path).not.toBeNull();
    for (const p of path!) {
      const c = cellOf(g, p);
      expect(isWalkable(g, c.col, c.row)).toBe(true);
    }
    // it had to detour, so it is longer than the straight-line cell count
    expect(path!.length).toBeGreaterThan(16);
  });

  it('returns null when the destination is genuinely sealed off', () => {
    const g = buildGrid(openFloor('1', [{ x: 1, z: -5, w: 0.5, d: 10 }]), 0);
    expect(findPath(g, { x: -4, z: 0 }, { x: 4.5, z: 0 })).toBeNull();
  });

  it('returns a single point when start and end are the same cell', () => {
    const g = buildGrid(openFloor('1'), 0);
    const path = findPath(g, { x: 1, z: 1 }, { x: 1.1, z: 1.1 });
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
    id: 'factory', label: 'test', floorHeight: 4,
    floors: [openFloor('1'), openFloor('2'), openFloor('3')],
    portals: [
      { id: 's12', kind: 'stairs', fromFloor: '1', toFloor: '2',
        fromPosition: { x: -4, z: 0 }, toPosition: { x: -4, z: 0 }, travelSeconds: 6 },
      { id: 's23', kind: 'stairs', fromFloor: '2', toFloor: '3',
        fromPosition: { x: -4, z: 0 }, toPosition: { x: -4, z: 0 }, travelSeconds: 6 },
    ],
  };
  const grids = new Map(site.floors.map((f) => [f.id, buildGrid(f, 0)]));

  it('walks only, when both ends are on one floor', () => {
    const legs = routeAcrossFloors(site, grids,
      { floorId: '1', position: { x: -3, z: -3 } },
      { floorId: '1', position: { x: 3, z: 3 } });
    expect(legs).not.toBeNull();
    expect(legs!.every((l) => l.kind === 'walk')).toBe(true);
  });

  it('walk → portal → walk for an adjacent floor', () => {
    const legs = routeAcrossFloors(site, grids,
      { floorId: '1', position: { x: 3, z: 3 } },
      { floorId: '2', position: { x: 2, z: -2 } });
    expect(legs!.map((l) => l.kind)).toEqual(['walk', 'portal', 'walk']);
  });

  it('chains two portals to reach a floor two levels away', () => {
    const legs = routeAcrossFloors(site, grids,
      { floorId: '1', position: { x: 3, z: 3 } },
      { floorId: '3', position: { x: 0, z: 0 } });
    expect(legs!.filter((l) => l.kind === 'portal')).toHaveLength(2);
  });

  it('returns null for a floor no portal reaches', () => {
    const isolated: SiteDef = { ...site, floors: [...site.floors, openFloor('9')] };
    expect(routeAcrossFloors(isolated, new Map([...grids, ['9', buildGrid(openFloor('9'), 0)]]),
      { floorId: '1', position: { x: 0, z: 0 } },
      { floorId: '9', position: { x: 0, z: 0 } })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/sim/__tests__/pathing.test.ts`
Expected: FAIL — cannot resolve `@/sim/pathing`.

- [ ] **Step 3: Implement**

```ts
// src/sim/pathing.ts
/**
 * A* within a floor, and a breadth-first portal search between floors.
 *
 * Two separate problems deliberately kept separate: inside a floor the cost is
 * distance, between floors it is "how many stairwells" — a worker does not
 * weigh three metres of walking against a lift ride, they just go. Splitting
 * them keeps each search small and each one testable on its own.
 */
import type { PortalDef, SiteDef, Vec2 } from '@/sites/types';
import { CELL_SIZE, cellOf, centreOf, isWalkable, nearestWalkable, type Grid } from '@/sim/navmesh';

export type Waypoint = { floorId: string; position: Vec2 };

export type Leg =
  | { kind: 'walk'; floorId: string; points: Vec2[] }
  | { kind: 'portal'; portal: PortalDef };

/** 8-way movement; diagonals cost √2 so a diagonal is not a free shortcut. */
const NEIGHBOURS: readonly [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

const key = (col: number, row: number) => row * 100_000 + col;

export function findPath(grid: Grid, from: Vec2, to: Vec2): Vec2[] | null {
  const start = cellOf(grid, nearestWalkable(grid, from) ?? from);
  const goalPoint = nearestWalkable(grid, to);
  if (goalPoint === null) return null;
  const goal = cellOf(grid, goalPoint);

  if (!isWalkable(grid, start.col, start.row)) return null;
  if (start.col === goal.col && start.row === goal.row) return [centreOf(grid, goal.col, goal.row)];

  const h = (c: number, r: number) => Math.hypot(c - goal.col, r - goal.row);

  const open: { col: number; row: number; f: number }[] = [{ ...start, f: h(start.col, start.row) }];
  const cameFrom = new Map<number, number>();
  const g = new Map<number, number>([[key(start.col, start.row), 0]]);
  const closed = new Set<number>();

  while (open.length > 0) {
    // Small grids (~1k cells): a linear scan beats a heap's constant factor.
    let bestAt = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bestAt].f) bestAt = i;
    const current = open.splice(bestAt, 1)[0];
    const currentKey = key(current.col, current.row);
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);

    if (current.col === goal.col && current.row === goal.row) {
      const points: Vec2[] = [];
      let k: number | undefined = currentKey;
      while (k !== undefined) {
        const col = k % 100_000;
        const row = (k - col) / 100_000;
        points.push(centreOf(grid, col, row));
        k = cameFrom.get(k);
      }
      return points.reverse();
    }

    for (const [dc, dr, cost] of NEIGHBOURS) {
      const col = current.col + dc;
      const row = current.row + dr;
      if (!isWalkable(grid, col, row)) continue;
      // No corner-cutting: a diagonal needs both orthogonal neighbours open,
      // or a worker clips the corner of a machine.
      if (dc !== 0 && dr !== 0) {
        if (!isWalkable(grid, current.col + dc, current.row)) continue;
        if (!isWalkable(grid, current.col, current.row + dr)) continue;
      }
      const nKey = key(col, row);
      if (closed.has(nKey)) continue;
      const tentative = (g.get(currentKey) ?? Infinity) + cost;
      if (tentative < (g.get(nKey) ?? Infinity)) {
        cameFrom.set(nKey, currentKey);
        g.set(nKey, tentative);
        open.push({ col, row, f: tentative + h(col, row) });
      }
    }
  }
  return null;
}

/** Portals a worker can take from `floorId`, in either declared direction. */
function portalsFrom(site: SiteDef, floorId: string): { portal: PortalDef; to: string }[] {
  const out: { portal: PortalDef; to: string }[] = [];
  for (const p of site.portals) {
    if (p.fromFloor === floorId) out.push({ portal: p, to: p.toFloor });
    else if (p.toFloor === floorId) out.push({ portal: p, to: p.fromFloor });
  }
  return out;
}

/** Where a portal is entered when travelling from `floorId`. */
function entryPoint(portal: PortalDef, floorId: string): Vec2 {
  return portal.fromFloor === floorId ? portal.fromPosition : portal.toPosition;
}

/** Where a portal deposits a worker arriving on `floorId`. */
function exitPoint(portal: PortalDef, floorId: string): Vec2 {
  return portal.fromFloor === floorId ? portal.fromPosition : portal.toPosition;
}

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

  // Fewest portals wins; a worker does not trade walking distance against stairs.
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
    chain.unshift({ floorId: step.floorId, portal: step.portal });
    cursor = step.floorId;
  }

  const legs: Leg[] = [];
  let position = from.position;
  let floorId = from.floorId;
  for (const step of chain) {
    const grid = grids.get(floorId);
    if (!grid) return null;
    const points = findPath(grid, position, entryPoint(step.portal, floorId));
    if (points === null) return null;
    legs.push({ kind: 'walk', floorId, points });
    legs.push({ kind: 'portal', portal: step.portal });
    floorId = step.portal.fromFloor === floorId ? step.portal.toFloor : step.portal.fromFloor;
    position = exitPoint(step.portal, floorId);
  }

  const lastGrid = grids.get(to.floorId);
  if (!lastGrid) return null;
  const finalPoints = findPath(lastGrid, position, to.position);
  if (finalPoints === null) return null;
  legs.push({ kind: 'walk', floorId: to.floorId, points: finalPoints });
  return legs;
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/sim/__tests__/pathing.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/sim/pathing.ts src/sim/__tests__/pathing.test.ts
git commit -m "feat: A* within a floor, portal search between floors

Two separate searches on purpose. Inside a floor the cost is distance; between
floors it is how many stairwells, because a worker does not weigh three metres
of walking against a lift ride. Splitting them keeps each small and testable.

Diagonals cost root-2 and require both orthogonal neighbours to be open, so a
path cannot cut the corner of a machine — the failure that looks like a worker
walking through geometry."
```

---

### Task 4: Roles and the job pool

**Files:**
- Create: `src/sim/roles.ts`, `src/sim/jobs.ts`
- Test: `src/sim/__tests__/jobs.test.ts`

**Interfaces:**
- Consumes: `SiteDef`, `JobAnchorKind`, `MachineDef`, `Vec2` from `@/sites/types`
- Produces:
```ts
export type Role = 'operator' | 'technician' | 'inspector' | 'materials' | 'supervisor' | 'cleaner';
export const ROLES: readonly Role[];
export function roleForIndex(index: number): Role;

export type Activity = 'walking' | 'operating' | 'inspecting' | 'carrying'
                     | 'logging' | 'talking' | 'resting' | 'sweeping' | 'climbing';
export type Job = {
  id: string;
  activity: Activity;
  target: { floorId: string; position: Vec2 };
  /** how long the worker stays put once they arrive, ms */
  dwellMs: number;
  label: string;
};
export function jobsForRole(role: Role): readonly JobKind[];
export type JobKind = 'inspect' | 'operate' | 'fetch' | 'carry' | 'log' | 'meet' | 'break' | 'sweep' | 'patrol';
export function pickJob(
  site: SiteDef, role: Role, currentFloorId: string, rand: () => number,
): Job;
```

- [ ] **Step 1: Write the failing test**

```ts
// src/sim/__tests__/jobs.test.ts
import { describe, expect, it } from 'vitest';
import { FACTORY } from '@/sites/factory';
import { ROLES, roleForIndex } from '@/sim/roles';
import { jobsForRole, pickJob } from '@/sim/jobs';

/** deterministic stand-in for Math.random */
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
    for (const role of ROLES) expect(jobsForRole(role).length).toBeGreaterThanOrEqual(2);
  });
});

describe('pickJob', () => {
  it('always returns a job a worker can actually reach', () => {
    for (const role of ROLES) {
      const job = pickJob(FACTORY, role, '3', seq([0.1, 0.5, 0.9]));
      const floor = FACTORY.floors.find((f) => f.id === job.target.floorId);
      expect(floor).toBeDefined();
      expect(job.target.position.x).toBeGreaterThanOrEqual(floor!.bounds.minX);
      expect(job.target.position.x).toBeLessThanOrEqual(floor!.bounds.maxX);
    }
  });

  it('only ever gives a role a job its role permits', () => {
    for (const role of ROLES) {
      const kinds = new Set(jobsForRole(role));
      for (let i = 0; i < 40; i++) {
        const job = pickJob(FACTORY, role, '2', seq([i / 40, (i * 7) % 40 / 40]));
        expect(kinds.has(job.id.split(':')[0] as never)).toBe(true);
      }
    }
  });

  it('gives a positive dwell so a worker is not teleporting between jobs', () => {
    const job = pickJob(FACTORY, 'operator', '1', seq([0.3]));
    expect(job.dwellMs).toBeGreaterThan(0);
  });

  it('sometimes sends a worker to another floor', () => {
    const floors = new Set<string>();
    for (let i = 0; i < 60; i++) {
      floors.add(pickJob(FACTORY, 'materials', '1', seq([i / 60, ((i * 13) % 60) / 60])).target.floorId);
    }
    expect(floors.size).toBeGreaterThan(1);
  });

  it('is deterministic given the same random sequence', () => {
    const a = pickJob(FACTORY, 'technician', '4', seq([0.42, 0.17]));
    const b = pickJob(FACTORY, 'technician', '4', seq([0.42, 0.17]));
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/sim/__tests__/jobs.test.ts`
Expected: FAIL — cannot resolve `@/sim/roles`.

- [ ] **Step 3: Implement `src/sim/roles.ts`**

```ts
// src/sim/roles.ts
/**
 * A worker's role decides which jobs they will take. Without it the site reads
 * as sixty people doing the same random walk; with it, the cleaner sweeps, the
 * inspector visits machines and the materials handler moves between floors, and
 * the place looks organised rather than merely busy.
 */
export const ROLES = [
  'operator', 'technician', 'inspector', 'materials', 'supervisor', 'cleaner',
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Deterministic per worker index, and spread so a 60-worker roster contains
 * every role. Index is 1-based to match the provisioning identity scheme.
 */
export function roleForIndex(index: number): Role {
  return ROLES[(index - 1) % ROLES.length];
}
```

- [ ] **Step 4: Implement `src/sim/jobs.ts`**

```ts
// src/sim/jobs.ts
/**
 * What a worker does next.
 *
 * A job is a destination, an activity and a dwell time — nothing about how to
 * get there, which is pathing's problem. `pickJob` takes its randomness as a
 * parameter so a worker's behaviour is reproducible in a test and varied in a
 * demo.
 */
import type { JobAnchor, SiteDef, Vec2 } from '@/sites/types';
import type { Role } from '@/sim/roles';

export type Activity =
  | 'walking' | 'operating' | 'inspecting' | 'carrying'
  | 'logging' | 'talking' | 'resting' | 'sweeping' | 'climbing';

export type JobKind =
  | 'inspect' | 'operate' | 'fetch' | 'carry' | 'log' | 'meet' | 'break' | 'sweep' | 'patrol';

export type Job = {
  id: string;                                   // '<kind>:<targetId>'
  activity: Activity;
  target: { floorId: string; position: Vec2 };
  dwellMs: number;
  label: string;
};

const ROLE_JOBS: Record<Role, readonly JobKind[]> = {
  operator:   ['operate', 'log', 'meet', 'break'],
  technician: ['inspect', 'operate', 'fetch', 'log', 'break'],
  inspector:  ['inspect', 'log', 'patrol', 'break'],
  materials:  ['fetch', 'carry', 'log', 'break'],
  supervisor: ['patrol', 'meet', 'log', 'inspect'],
  cleaner:    ['sweep', 'fetch', 'break'],
};

export function jobsForRole(role: Role): readonly JobKind[] {
  return ROLE_JOBS[role];
}

/** Dwell ranges, ms — long enough to read as work, short enough to keep moving. */
const DWELL: Record<JobKind, [number, number]> = {
  inspect: [8_000, 20_000],
  operate: [12_000, 30_000],
  fetch:   [4_000, 9_000],
  carry:   [4_000, 9_000],
  log:     [6_000, 14_000],
  meet:    [8_000, 18_000],
  break:   [20_000, 45_000],
  sweep:   [10_000, 22_000],
  patrol:  [2_000, 6_000],
};

const ACTIVITY: Record<JobKind, Activity> = {
  inspect: 'inspecting', operate: 'operating', fetch: 'carrying', carry: 'carrying',
  log: 'logging', meet: 'talking', break: 'resting', sweep: 'sweeping', patrol: 'walking',
};

const pick = <T,>(items: readonly T[], rand: () => number): T =>
  items[Math.min(items.length - 1, Math.floor(rand() * items.length))];

const between = ([lo, hi]: [number, number], rand: () => number) =>
  Math.round(lo + rand() * (hi - lo));

function anchors(site: SiteDef, kind: JobAnchor['kind']): JobAnchor[] {
  return site.floors.flatMap((f) => f.anchors.filter((a) => a.kind === kind));
}

export function pickJob(
  site: SiteDef,
  role: Role,
  currentFloorId: string,
  rand: () => number,
): Job {
  const kind = pick(ROLE_JOBS[role], rand);

  // Machine-facing work prefers this floor, so a worker is not permanently in
  // a stairwell — but not exclusively, or the building would never mix.
  const localMachines = site.floors.find((f) => f.id === currentFloorId)?.machines ?? [];
  const allMachines = site.floors.flatMap((f) => f.machines);

  if (kind === 'inspect' || kind === 'operate') {
    const pool = localMachines.length > 0 && rand() < 0.7 ? localMachines : allMachines;
    const m = pick(pool, rand);
    return {
      id: `${kind}:${m.id}`,
      activity: ACTIVITY[kind],
      target: { floorId: m.floor, position: m.position },
      dwellMs: between(DWELL[kind], rand),
      label: `${kind === 'inspect' ? 'Inspecting' : 'Operating'} ${m.label}`,
    };
  }

  const anchorKind =
    kind === 'fetch' || kind === 'carry' ? 'stores'
    : kind === 'log' ? 'terminal'
    : kind === 'break' ? 'break'
    : kind === 'sweep' ? 'sweep'
    : kind === 'meet' ? 'terminal'
    : 'inspect';

  const pool = anchors(site, anchorKind);
  const fallback = anchors(site, 'terminal');
  const a = pick(pool.length > 0 ? pool : fallback, rand);

  return {
    id: `${kind}:${a.id}`,
    activity: ACTIVITY[kind],
    target: { floorId: a.floor, position: a.position },
    dwellMs: between(DWELL[kind], rand),
    label: `${kind} at ${a.id}`,
  };
}
```

Note the `patrol` branch falls through to the `inspect` anchor kind; ensure every floor declares at least one `inspect` **or** that the `terminal` fallback covers it — the test `always returns a job a worker can actually reach` will catch a gap.

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/sim/__tests__/jobs.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add src/sim/roles.ts src/sim/jobs.ts src/sim/__tests__/jobs.test.ts
git commit -m "feat: roles and the job pool

A role decides which jobs a worker will take. Without it the site reads as
sixty people doing the same random walk; with it the cleaner sweeps, the
inspector visits machines, the materials handler crosses floors, and the place
looks organised rather than merely busy.

pickJob takes its randomness as a parameter, so behaviour is reproducible in a
test and varied in a demo. Machine work prefers the worker's current floor but
not exclusively, or the building would never mix."
```

---

### Task 5: The agent

**Files:**
- Create: `src/sim/agent.ts`
- Test: `src/sim/__tests__/agent.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4
- Produces:
```ts
export type AgentState = {
  index: number;
  role: Role;
  floorId: string;
  position: Vec2;
  facing: number;              // radians
  activity: Activity;
  job: Job | null;
  /** metres walked since the last tick — physiology reads this */
  movedThisTick: number;
};
export type Agent = {
  state: AgentState;
  tick(dtMs: number): void;
};
export function createAgent(opts: {
  index: number; role: Role; site: SiteDef; grids: Map<string, Grid>;
  start: { floorId: string; position: Vec2 };
  rand: () => number;
  walkSpeed?: number;          // m/s, default 1.3
}): Agent;
```

- [ ] **Step 1: Write the failing test**

```ts
// src/sim/__tests__/agent.test.ts
import { describe, expect, it } from 'vitest';
import { FACTORY } from '@/sites/factory';
import { buildGrid } from '@/sim/navmesh';
import { createAgent } from '@/sim/agent';

const grids = new Map(FACTORY.floors.map((f) => [f.id, buildGrid(f)]));
const rand = () => 0.5;

const spawn = (floorId = '1') =>
  createAgent({
    index: 1, role: 'technician', site: FACTORY, grids, rand,
    start: { floorId, position: { x: 0, z: 0 } },
  });

const run = (a: ReturnType<typeof spawn>, ms: number, stepMs = 100) => {
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
    run(a, 3_000);
    const moved = Math.hypot(a.state.position.x - start.x, a.state.position.z - start.z);
    expect(moved).toBeGreaterThan(0.5);
  });

  it('reports the distance walked each tick, for physiology', () => {
    const a = spawn();
    a.tick(16);
    a.tick(100);
    expect(a.state.movedThisTick).toBeGreaterThan(0);
  });

  it('stops moving while dwelling at the target', () => {
    const a = spawn();
    run(a, 120_000);                       // long enough to arrive and dwell
    const before = { ...a.state.position };
    a.tick(100);
    if (a.state.activity !== 'walking') {
      const moved = Math.hypot(a.state.position.x - before.x, a.state.position.z - before.z);
      expect(moved).toBe(0);
      expect(a.state.movedThisTick).toBe(0);
    }
  });

  it('always holds a walkable position', () => {
    const a = spawn();
    for (let i = 0; i < 3_000; i++) {
      a.tick(50);
      const f = FACTORY.floors.find((x) => x.id === a.state.floorId)!;
      expect(a.state.position.x).toBeGreaterThanOrEqual(f.bounds.minX - 0.01);
      expect(a.state.position.x).toBeLessThanOrEqual(f.bounds.maxX + 0.01);
    }
  });

  it('eventually changes floor when a job sends it elsewhere', () => {
    const a = createAgent({
      index: 2, role: 'materials', site: FACTORY, grids,
      rand: (() => { let i = 0; return () => [0.9, 0.1, 0.4, 0.7][i++ % 4]; })(),
      start: { floorId: '1', position: { x: 0, z: 0 } },
    });
    const floors = new Set<string>();
    for (let i = 0; i < 20_000; i++) { a.tick(50); floors.add(a.state.floorId); }
    expect(floors.size).toBeGreaterThan(1);
  });

  it('reports climbing while on a portal', () => {
    const a = createAgent({
      index: 3, role: 'materials', site: FACTORY, grids,
      rand: (() => { let i = 0; return () => [0.9, 0.1, 0.4, 0.7][i++ % 4]; })(),
      start: { floorId: '1', position: { x: 0, z: 0 } },
    });
    const seen = new Set<string>();
    for (let i = 0; i < 20_000; i++) { a.tick(50); seen.add(a.state.activity); }
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
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/sim/__tests__/agent.test.ts`
Expected: FAIL — cannot resolve `@/sim/agent`.

- [ ] **Step 3: Implement**

Write `src/sim/agent.ts` as a small state machine with exactly four states, and a header explaining that the agent owns *movement and job lifecycle only* — it never touches vitals, alerts or the network:

- `routing` — no job: call `pickJob`, then `routeAcrossFloors` from the current waypoint. If routing returns `null`, pick a different job rather than stalling; after 5 consecutive failures, dwell 2 s and try again so a badly-authored floor degrades to a standing worker rather than a busy loop.
- `walking` — consume the current `walk` leg's points, advancing `walkSpeed × dt`, setting `facing` from the direction of travel, accumulating `movedThisTick`, and setting `activity = 'walking'`.
- `traversing` — a `portal` leg: hold position, set `activity = 'climbing'`, count down `travelSeconds`, then set `floorId` and `position` to the portal's exit and continue.
- `dwelling` — arrived: set `activity` to the job's activity, `movedThisTick = 0`, count down `dwellMs`, then clear the job and return to `routing`.

`movedThisTick` must be reset to 0 at the top of every `tick`, then accumulated only while walking — Task 6 reads it and a stale value would make a resting worker look like they were still moving.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/sim/__tests__/agent.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/sim/agent.ts src/sim/__tests__/agent.test.ts
git commit -m "feat: the worker agent — routing, walking, traversing, dwelling

Four states and nothing else. The agent owns movement and the job lifecycle; it
never touches vitals, alerts or the network, so it can be ticked in a test
without a fleet.

A route that cannot be found picks a different job rather than stalling, and
five consecutive failures degrade to standing still for two seconds — a badly
authored floor produces a stationary worker, not a busy loop.

movedThisTick resets at the top of every tick: physiology reads it, and a stale
value would make a resting worker look like they were still walking."
```

---

### Task 6: Physiology that writes steps

**Files:**
- Create: `src/phone/physiology.ts`
- Test: `src/phone/__tests__/physiology.test.ts`

**Interfaces:**
- Consumes: `VitalsBuffer` from `@/phone/vitalsBuffer`; `Activity` from `@/sim/jobs`; `isInactive`, `RISK_CONFIG` from `@/phone/vendor/health/risk`
- Produces:
```ts
export const PHYSIOLOGY = {
  restingRangeBpm: [54, 72],
  walkingBpm: 105,
  climbingBpm: 135,
  carryingBpm: 118,
  workingBpm: 96,
  /** bpm per second the heart moves toward its target */
  approachRate: 1.6,
  /** steps per metre walked */
  stepsPerMetre: 1.35,
  /** how often a step bucket is closed and written, ms */
  stepBucketMs: 15_000,
} as const;
export type PhysiologyState = { hr: number; pendingSteps: number; sinceBucketMs: number };
export function initialPhysiology(restingHr: number): PhysiologyState;
export function advancePhysiology(
  state: PhysiologyState, activity: Activity, metresMoved: number,
  restingHr: number, dtMs: number, nowMs: number, buffer: VitalsBuffer,
): PhysiologyState;
```

- [ ] **Step 1: Write the failing test**

```ts
// src/phone/__tests__/physiology.test.ts
import { describe, expect, it } from 'vitest';
import { VitalsBuffer } from '@/phone/vitalsBuffer';
import { isInactive } from '@/phone/vendor/health/risk';
import { advancePhysiology, initialPhysiology } from '@/phone/physiology';

const NOW = Date.parse('2026-08-10T09:00:00Z');
const RESTING = 60;

const walk = (ms: number, buffer: VitalsBuffer, from = initialPhysiology(RESTING)) => {
  let s = from;
  let t = NOW;
  const stepMs = 500;
  for (let e = 0; e < ms; e += stepMs) {
    t += stepMs;
    s = advancePhysiology(s, 'walking', 1.3 * (stepMs / 1000), RESTING, stepMs, t, buffer);
  }
  return { state: s, at: t };
};

describe('physiology', () => {
  it('starts at the worker\'s resting heart rate', () => {
    expect(initialPhysiology(RESTING).hr).toBeCloseTo(RESTING, 0);
  });

  it('raises heart rate while walking', () => {
    const b = new VitalsBuffer();
    const { state } = walk(120_000, b);
    expect(state.hr).toBeGreaterThan(RESTING + 20);
  });

  it('recovers toward resting once the worker stops', () => {
    const b = new VitalsBuffer();
    const walked = walk(120_000, b);
    let s = walked.state;
    let t = walked.at;
    const high = s.hr;
    for (let e = 0; e < 300_000; e += 500) {
      t += 500;
      s = advancePhysiology(s, 'resting', 0, RESTING, 500, t, b);
    }
    expect(s.hr).toBeLessThan(high);
    expect(s.hr).toBeCloseTo(RESTING, 0);
  });

  it('climbing is harder than walking', () => {
    const b = new VitalsBuffer();
    let climb = initialPhysiology(RESTING);
    let t = NOW;
    for (let e = 0; e < 120_000; e += 500) {
      t += 500;
      climb = advancePhysiology(climb, 'climbing', 0.4, RESTING, 500, t, b);
    }
    expect(climb.hr).toBeGreaterThan(walk(120_000, new VitalsBuffer()).state.hr);
  });

  // THE ONE THAT MATTERS — the vendored stress rule only fires when a worker
  // reads as inactive. If movement writes no steps, every exerting worker also
  // trips `stress` as though sitting still.
  it('writes step buckets while walking, so the vendored gate reads MOVING', () => {
    const b = new VitalsBuffer();
    const { at } = walk(120_000, b);
    expect(b.steps().length).toBeGreaterThan(0);
    expect(isInactive(b.steps(), new Date(at).toISOString(), true)).toBe(false);
  });

  it('writes no steps while resting, so the gate reads INACTIVE', () => {
    const b = new VitalsBuffer();
    let s = initialPhysiology(RESTING);
    let t = NOW;
    for (let e = 0; e < 120_000; e += 500) {
      t += 500;
      s = advancePhysiology(s, 'resting', 0, RESTING, 500, t, b);
    }
    expect(isInactive(b.steps(), new Date(t).toISOString(), true)).toBe(true);
  });

  it('appends heart-rate samples the engine can read', () => {
    const b = new VitalsBuffer();
    walk(120_000, b);
    expect(b.hrSeries().length).toBeGreaterThan(3);
  });

  it('never emits a negative or absurd heart rate', () => {
    const b = new VitalsBuffer();
    let s = initialPhysiology(RESTING);
    let t = NOW;
    for (let e = 0; e < 600_000; e += 500) {
      t += 500;
      s = advancePhysiology(s, e % 2 === 0 ? 'climbing' : 'resting', 0.4, RESTING, 500, t, b);
      expect(s.hr).toBeGreaterThan(30);
      expect(s.hr).toBeLessThan(210);
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/phone/__tests__/physiology.test.ts`
Expected: FAIL — cannot resolve `@/phone/physiology`.

- [ ] **Step 3: Implement**

Write `src/phone/physiology.ts` with a header stating plainly why steps matter — quoting the finding: the vendored `stress` rule gates on `isInactive`, so movement that writes no steps makes every exerting worker also read as pathologically stressed while standing still. The engine is right; the input would be wrong.

Behaviour: each call moves `hr` toward the activity's target at `approachRate` bpm/s (targets from `PHYSIOLOGY`, with `resting`/`talking`/`logging` targeting `restingHr` and `operating`/`inspecting`/`sweeping` targeting `workingBpm`), accumulates `pendingSteps += metresMoved × stepsPerMetre`, and every `stepBucketMs` closes a bucket — calling `buffer.appendSteps(Math.round(pendingSteps), bucketStart, nowMs)` only when `pendingSteps ≥ 1`, then resetting it. It also appends an HR sample on the same cadence via `buffer.append(hr, nowMs)`.

Never write a zero-count bucket: Samsung writes buckets only while stepping, and an empty-but-present bucket is a different signal from no bucket at all.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/phone/__tests__/physiology.test.ts`
Expected: PASS, 8 tests. The fifth and sixth are the point — the **vendored** `isInactive` must read `false` while walking and `true` while resting.

- [ ] **Step 5: Commit**

```bash
git add src/phone/physiology.ts src/phone/__tests__/physiology.test.ts
git commit -m "feat: physiology that writes step buckets, not just heart rate

The item the Phase 1 backlog flagged as most likely to bite silently. The
vendored stress rule only fires when a worker reads as inactive, so movement
that raises heart rate without writing steps makes every hard-working worker
also light up as pathologically stressed while apparently standing still. The
engine is correct; the input was what would have been wrong.

The two load-bearing tests call the vendored isInactive directly: false while
walking, true while resting. Zero-count buckets are never written — Samsung
writes a bucket only while stepping, and an empty bucket is a different signal
from no bucket."
```

---

### Task 7: Agents wired into the fleet

**Files:**
- Create: `src/sim/agents.ts`
- Modify: `src/phone/VirtualPhone.ts` (widen `PhoneContext`), `src/runtime/fleet.ts` (real `getContext`, physiology tick)
- Test: `src/sim/__tests__/agents.test.ts`, and extend `src/runtime/__tests__/fleet.test.ts`

**Interfaces:**
- Consumes: Tasks 1–6, plus `Fleet` and `VirtualPhone` from Phase 1
- Produces:
```ts
export type Agents = {
  tick(dtMs: number, nowMs: number): void;
  contextFor(index: number): PhoneContext;
  stateFor(index: number): AgentState | undefined;
  all(): AgentState[];
};
export function createAgents(opts: {
  site: SiteDef; indices: number[]; buffers: Map<number, VitalsBuffer>;
  restingHrFor: (index: number) => number; rand: () => number;
}): Agents;
```
`PhoneContext` gains, all additive:
```ts
export type PhoneContext = {
  position: { x: number; z: number };
  floor: string | null;
  moving: boolean;
  noiseDbFs: number;
  /** ms since the noise sample was taken — feeds classifyNoise's staleness branch */
  noiseAgeMs: number;
  /** ms since the GPS fix — feeds decideProximity's stale-fix fallback */
  gpsAgeMs: number;
  /** whether the Steps grant is readable; false makes the gated rules abstain */
  stepsReadable: boolean;
};
```

- [ ] **Step 1: Write the failing test**

```ts
// src/sim/__tests__/agents.test.ts
import { describe, expect, it } from 'vitest';
import { FACTORY } from '@/sites/factory';
import { VitalsBuffer } from '@/phone/vitalsBuffer';
import { createAgents } from '@/sim/agents';

const build = (n: number) => {
  const indices = Array.from({ length: n }, (_, i) => i + 1);
  const buffers = new Map(indices.map((i) => [i, new VitalsBuffer()]));
  for (const [i, b] of buffers) b.seed(58 + (i % 10), Date.parse('2026-08-10T09:00:00Z'));
  return {
    indices, buffers,
    agents: createAgents({
      site: FACTORY, indices, buffers,
      restingHrFor: (i) => 58 + (i % 10), rand: () => 0.5,
    }),
  };
};

describe('agents', () => {
  it('creates one agent per worker index', () => {
    const { agents, indices } = build(12);
    expect(agents.all()).toHaveLength(indices.length);
  });

  it('spreads workers across floors rather than stacking them on one', () => {
    const { agents } = build(60);
    expect(new Set(agents.all().map((a) => a.floorId)).size).toBeGreaterThan(1);
  });

  it('reports a context whose floor and position match the agent', () => {
    const { agents } = build(6);
    agents.tick(16, Date.now());
    const state = agents.stateFor(3)!;
    const ctx = agents.contextFor(3);
    expect(ctx.floor).toBe(state.floorId);
    expect(ctx.position).toEqual(state.position);
  });

  it('reports moving:true only while the agent is walking', () => {
    const { agents } = build(4);
    let now = Date.now();
    for (let i = 0; i < 200; i++) { now += 100; agents.tick(100, now); }
    for (const s of agents.all()) {
      expect(agents.contextFor(s.index).moving).toBe(s.activity === 'walking' || s.activity === 'climbing');
    }
  });

  it('writes vitals into each worker\'s own buffer', () => {
    const { agents, buffers } = build(4);
    let now = Date.parse('2026-08-10T09:00:00Z');
    for (let i = 0; i < 600; i++) { now += 500; agents.tick(500, now); }
    for (const b of buffers.values()) expect(b.hrSeries().length).toBeGreaterThan(0);
  });

  it('gives an unknown index a safe context rather than throwing', () => {
    const { agents } = build(2);
    expect(() => agents.contextFor(999)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/sim/__tests__/agents.test.ts`
Expected: FAIL — cannot resolve `@/sim/agents`.

- [ ] **Step 3: Widen `PhoneContext` and use the new fields**

In `src/phone/VirtualPhone.ts`, extend the `PhoneContext` type with `noiseAgeMs`, `gpsAgeMs` and `stepsReadable` as above, then use them where the values are currently hardcoded:
- the noise sample passed to `classifyContext` takes `ageMs: ctx.noiseAgeMs` instead of `0`;
- the motion signal takes `stepsReadable: ctx.stepsReadable` instead of `true`;
- the GPS fix passed to `decideProximity` takes `timestamp: nowMs - ctx.gpsAgeMs` instead of `nowMs`.

This is what makes two currently-unreachable branches of the vendored code live: noise staleness, and the stale-fix proximity fallback. **Do not change any decision logic** — only what is fed in.

Update the existing `VirtualPhone` tests' context fixtures to supply the three new fields (`noiseAgeMs: 0`, `gpsAgeMs: 0`, `stepsReadable: true` preserves their current behaviour exactly).

- [ ] **Step 4: Implement `src/sim/agents.ts`**

One `Agent` per index, spawned on a floor chosen by `index % floors.length` at a walkable point near that floor's `terminal` anchor. `tick` advances every agent, then advances that agent's physiology with its `activity` and `movedThisTick`, writing into its buffer.

`contextFor` maps an agent's state to a `PhoneContext`: position and floor straight through; `moving` true for `walking` and `climbing`; `noiseDbFs` from the loudest machine within 6 m of the agent (a small per-`kind` table, quiet default `-48`); `noiseAgeMs` a small constant (the monitor's cadence); `gpsAgeMs` a small constant; `stepsReadable` true. An unknown index returns a safe default context — origin, floor `null`, still, quiet — rather than throwing, because a phone must never crash the tick loop.

- [ ] **Step 5: Wire it into `Fleet`**

`Fleet` gains an optional `agents: Agents`. When present, `getContext` delegates to `agents.contextFor(worker.index)` and `Fleet` no longer needs its own context stub. Keep the existing `getContext` dependency for tests that don't want agents.

- [ ] **Step 6: Run everything**

Run: `npx tsc -p tsconfig.app.json --noEmit && npm run check:vendor && npm run test:run`
Expected: tsc clean, vendor 11/11, full suite green with the new tests. If a pre-existing `VirtualPhone` test fails, it is because its context fixture is missing a new field — add the three fields, do not weaken the assertion.

- [ ] **Step 7: Commit**

```bash
git add src/sim/agents.ts src/sim/__tests__/agents.test.ts src/phone/VirtualPhone.ts src/runtime/fleet.ts src/phone/__tests__/VirtualPhone.test.ts
git commit -m "feat: each phone now reads its own worker's real position and floor

The seam Phase 1 built is filled rather than moved: getContext delegates to the
agent set, so a VirtualPhone sees where its worker actually is, which floor
they are on, and whether they are moving.

PhoneContext gains noiseAgeMs, gpsAgeMs and stepsReadable — all additive, and
all previously hardcoded. Supplying them for real brings two branches of the
vendored code to life that could never fire before: noise staleness, and the
stale-GPS proximity fallback. No decision logic changed; only what is fed in."
```

---

### Task 8: The building, on screen

**Files:**
- Create: `src/state/buildingStore.ts`, `src/scene/building/Building.tsx`, `src/scene/building/FloorSlab.tsx`, `src/scene/building/Portals.tsx`
- Test: `src/state/__tests__/buildingStore.test.ts`

**Interfaces:**
- Consumes: `SiteDef`, `FloorDef`; `Agents` from Task 7
- Produces: `useBuildingStore` (Zustand) with `activeFloorId`, `setActiveFloor`, `qualityTier`, `setQualityTier`, `focus`, `setFocus`; `<Building site agents />`

- [ ] **Step 1: Write the failing test**

```ts
// src/state/__tests__/buildingStore.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { FACTORY } from '@/sites/factory';
import { isFloorActive, nextFloorId, useBuildingStore } from '@/state/buildingStore';

beforeEach(() => useBuildingStore.getState().reset());

describe('buildingStore', () => {
  it('starts on a real floor of the site', () => {
    expect(FACTORY.floors.some((f) => f.id === useBuildingStore.getState().activeFloorId)).toBe(true);
  });

  it('changes the active floor', () => {
    useBuildingStore.getState().setActiveFloor('4');
    expect(useBuildingStore.getState().activeFloorId).toBe('4');
  });

  it('ignores a floor the site does not have', () => {
    const before = useBuildingStore.getState().activeFloorId;
    useBuildingStore.getState().setActiveFloor('99');
    expect(useBuildingStore.getState().activeFloorId).toBe(before);
  });

  it('reports exactly one floor as active', () => {
    useBuildingStore.getState().setActiveFloor('2');
    const active = FACTORY.floors.filter((f) => isFloorActive(f.id, '2'));
    expect(active).toHaveLength(1);
  });

  it('steps up and down without falling off the ends', () => {
    expect(nextFloorId(FACTORY, '1', -1)).toBe('1');
    expect(nextFloorId(FACTORY, '6', +1)).toBe('6');
    expect(nextFloorId(FACTORY, '3', +1)).toBe('4');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/state/__tests__/buildingStore.test.ts`
Expected: FAIL — cannot resolve `@/state/buildingStore`.

- [ ] **Step 3: Implement the store**

`src/state/buildingStore.ts` — Zustand, with `activeFloorId` defaulting to the site's first floor, `setActiveFloor` validating against the site, `qualityTier: 'high' | 'medium' | 'low'`, `focus: string | null`, and a `reset()` for tests. Export the two pure helpers `isFloorActive` and `nextFloorId` so the stepping logic is testable without the store.

- [ ] **Step 4: Implement the building components**

`FloorSlab.tsx` renders one floor: a slab at `elevation`, low side walls, the floor's obstacles as simple blocks, and its machines via the existing `Machine` component. It takes an `active: boolean` and treats it as the only visual switch — active floors get full material detail and cast shadows; dim floors drop to a flat material, no shadow casting, and reduced opacity on the slab so the stack reads as a cutaway.

`Building.tsx` maps the site's floors to `FloorSlab`s at their elevations, renders `Portals`, and renders one worker per agent at that agent's position and floor, using the existing `Worker` component. Dim-floor workers render at reduced fidelity per the quality tier.

`Portals.tsx` draws each portal as a stair run or a lift shaft between its two elevations, from the portal data.

The front of the building (the `maxZ` wall) is deliberately omitted on every floor — that is the cutaway.

- [ ] **Step 5: Render it**

Replace `Scene.tsx`'s single-room contents with `<Building site={FACTORY} agents={agents} />`, keeping the existing lighting rig and `CameraRig`. Widen the overview camera so all six floors are in frame. Clicking a floor slab calls `setActiveFloor`.

- [ ] **Step 6: Verify in the browser**

Run: `npm run dev`, open the printed URL, press Start with a small worker count.
Expected: six stacked floors, one lit and the rest dim, workers walking on them, clicking a floor changes which is lit. Fix anything that renders blank or inside-out before committing.

- [ ] **Step 7: Commit**

```bash
git add src/state/buildingStore.ts src/state/__tests__ src/scene/building src/scene/Scene.tsx
git commit -m "feat: the dollhouse — six floors, one active

An open-fronted stack with the front wall omitted on every floor. The active
floor is lit and detailed; the rest dim, stop casting shadows and simplify, so
the building reads as a cutaway rather than six disconnected slabs.

The floor-stepping and validation logic lives in two pure helpers beside the
store, so the part worth testing is testable without a renderer."
```

---

### Task 9: Retire the single-room scene

**Files:**
- Delete: `src/scene/sceneDefs.ts`, `src/scene/Floor.tsx`, `src/scene/Walls.tsx`, `src/scene/Ceiling.tsx`
- Modify: `src/state/store.ts`, `src/App.tsx`, and any remaining importer

**Interfaces:**
- Consumes: Task 8
- Produces: a codebase with exactly one description of the site

- [ ] **Step 1: Find every importer**

Run: `grep -rn "sceneDefs\|scene/Floor\|scene/Walls\|scene/Ceiling" src/`
Expected: a short list. Each one either moves to the site data model or goes.

- [ ] **Step 2: Move what is still needed**

`store.ts` currently seeds five hardcoded workers from `WORKER_DEFS`. Those are superseded: the roster now comes from provisioning and the positions from agents. Remove the seeded workers and the `routing` field's dependency on them, keeping whatever the alert console still reads.

If a camera-focus table (`CAMERA_FOCUS`) is still referenced, replace it with a function that derives a focus position from an agent's current position, since workers now move.

- [ ] **Step 3: Delete the files**

```bash
git rm src/scene/sceneDefs.ts src/scene/Floor.tsx src/scene/Walls.tsx src/scene/Ceiling.tsx
```

- [ ] **Step 4: Verify**

Run: `npx tsc -p tsconfig.app.json --noEmit && npm run test:run && npm run dev`
Expected: tsc clean, suite green, and the scene still renders. A tsc error naming a deleted module means an importer was missed — fix the importer, do not restore the file.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: delete the single-room scene, now that the building replaces it

sceneDefs, Floor, Walls and Ceiling described a one-room factory and a fixed
cast of five workers. Both are now derived — the site from src/sites, the
roster from provisioning, the positions from agents — so keeping them would
leave two descriptions of the same place, which is how they drift."
```

---

## Self-Review

**Spec coverage.** Design §5 the sites → Task 1. §6 worker behaviour → Tasks 2–5. The backlog's physiology item → Task 6. The predicted `PhoneContext` widening → Task 7. §5.1 dollhouse presentation → Task 8. The backlog's "delete the superseded scene" thread → Task 9.

**Deliberately not in Phase 2A:** the controlled worker (§12) is Phase 2B; the character rig, machine detail, lighting and adaptive tiers are Phase 2C. Task 8 renders with the *existing* `Worker` and `Machine` components — this phase makes the building live, not beautiful.

**Also carried, not fixed here** — these are in `docs/phase-2-backlog.md` and belong to 2B/2C: `buildReason`'s stale prose table, `primary` as a constant, `Fleet`'s parallel arrays and non-idempotent `start()`, `App.tsx` never stopping the fleet, `outbox.ts`'s shadowed contract types, `VirtualPhone`'s hand-rolled dedup, and the SpO2 test-fixture drift.

**Type consistency.** `Vec2`, `FloorDef`, `SiteDef`, `MachineDef`, `PortalDef` are defined in Task 1 and consumed unchanged by Tasks 2–8. `Grid` is defined in Task 2 and consumed by Tasks 3, 5 and 7. `Job` / `Activity` are defined in Task 4 and consumed by Tasks 5, 6 and 7. `AgentState` is defined in Task 5 and consumed by Tasks 7 and 8. `PhoneContext` is widened once, in Task 7, and every existing fixture is updated in the same task.
