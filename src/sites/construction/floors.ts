import type { FloorDef, JobAnchor, MachineDef, ObstacleRect, Vec2 } from '@/sites/types';

/**
 * A six-level building under construction.
 *
 * Written the same way as the factory — a builder over the repeated parts,
 * hand-written only where the levels genuinely differ — but it is not a
 * repainted factory. A site under construction differs in three ways that
 * matter to everything downstream:
 *
 * - The plant is different, and so are its failures. A hoist gate left open is
 *   a fall, not a process upset.
 * - The obstacles are structural. Columns and core walls stay put on every
 *   level, so the routes through a deck are the same routes on every deck —
 *   which is exactly true of a real frame, and a useful contrast with the
 *   factory, where each floor's plant makes its own maze.
 * - There is no lift car, only a hoist. So the two portals are the scaffold
 *   stair and the external hoist, and the hoist is slower than a lift because
 *   it is a cage on a mast, not a lift.
 */

/** Every level shares the frame's footprint. */
export const FLOOR_BOUNDS = { minX: -8, maxX: 8, minZ: -14, maxZ: 2 } as const;

/** Taller than the factory: a structural frame has deeper floor-to-floor. */
export const FLOOR_HEIGHT = 4.4;

const MACHINE_FOOTPRINT = 2.4;

/** The stair tower is west; the hoist is bolted to the east face. */
export const STAIR_POSITION: Vec2 = { x: -7, z: 0 };
export const HOIST_POSITION: Vec2 = { x: 7, z: 0 };

const MACHINE_SLOTS: Vec2[] = [
  { x: -4.5, z: -10 },
  { x: 4.5, z: -10 },
  { x: -4.5, z: -5 },
  { x: 4.5, z: -5 },
];

const MACHINE_ROTATION = [Math.PI, Math.PI, 0, 0];

type MachineSpec = { id: string; label: string; kind: MachineDef['kind'] };

const footprintOf = (p: Vec2): ObstacleRect => ({
  x: p.x - MACHINE_FOOTPRINT / 2,
  z: p.z - MACHINE_FOOTPRINT / 2,
  w: MACHINE_FOOTPRINT,
  d: MACHINE_FOOTPRINT,
  kind: 'machine',
});

/**
 * The lift core and two column lines: the parts of a frame that exist on every
 * level and cannot be moved. They are what a walker on any deck routes around.
 */
const STRUCTURE: ObstacleRect[] = [
  /*
    Full height, because a core drawn at waist height reads as a stack of
    crates rather than as the thing holding the deck above up — but no bigger
    than a core needs to be. At 3.2 × 4.0 m it walled off the middle of every
    level and hid the plant behind it, which trades one wrong reading for
    another. Slim columns for the same reason.
  */
  { x: -1.2, z: -8.6, w: 2.4, d: 3.0, height: 3.2 },
  { x: -6.2, z: -12.8, w: 0.6, d: 0.6, height: 3.2 },
  { x: 5.6, z: -12.8, w: 0.6, d: 0.6, height: 3.2 },
  { x: -6.2, z: -1.4, w: 0.6, d: 0.6, height: 3.2 },
  { x: 5.6, z: -1.4, w: 0.6, d: 0.6, height: 3.2 },
];

function anchorsFor(floorId: string): JobAnchor[] {
  return [
    { id: `stores-${floorId}`, kind: 'stores', floor: floorId, position: { x: -6.5, z: -12.5 } },
    { id: `terminal-${floorId}`, kind: 'terminal', floor: floorId, position: { x: 6.0, z: -3.0 } },
    { id: `break-${floorId}`, kind: 'break', floor: floorId, position: { x: -5.0, z: 0.6 } },
    { id: `inspect-${floorId}`, kind: 'inspect', floor: floorId, position: { x: 0.0, z: -12.5 } },
    { id: `sweep-${floorId}`, kind: 'sweep', floor: floorId, position: { x: 1.5, z: -1.5 } },
  ];
}

function buildLevel(
  id: string,
  label: string,
  index: number,
  specs: MachineSpec[],
): FloorDef {
  const machines: MachineDef[] = specs.map((spec, i) => ({
    ...spec,
    floor: id,
    position: MACHINE_SLOTS[i],
    rotationY: MACHINE_ROTATION[i],
  }));

  return {
    id,
    label,
    elevation: index * FLOOR_HEIGHT,
    bounds: { ...FLOOR_BOUNDS },
    obstacles: [...machines.map((m) => footprintOf(m.position)), ...STRUCTURE],
    machines,
    anchors: anchorsFor(id),
  };
}

/*
  Levels run bottom-up, and the trade on each one is the trade that would
  actually be there: the frame goes up from the top while the floors below are
  progressively finished. That is why the crane and the formwork are at the
  top and the finishing trades are at the bottom — a site is a sequence in
  space as well as in time.
*/
export const CONSTRUCTION_FLOORS: FloorDef[] = [
  buildLevel('1', 'Ground & laydown', 0, [
    { id: 'HOIST-01', label: 'Passenger Hoist 01', kind: 'hoist' },
    { id: 'GEN-02', label: 'Site Generator 02', kind: 'generator' },
    { id: 'DB-03', label: 'Distribution Board 03', kind: 'panel' },
  ]),
  buildLevel('2', 'Podium — blockwork', 1, [
    { id: 'PUMP-04', label: 'Concrete Pump 04', kind: 'pump' },
    { id: 'COMP-05', label: 'Site Compressor 05', kind: 'chiller' },
    { id: 'WELD-06', label: 'Welding Set 06', kind: 'welder' },
  ]),
  buildLevel('3', 'Level 3 — MEP first fix', 2, [
    { id: 'WELD-07', label: 'Welding Set 07', kind: 'welder' },
    { id: 'DB-08', label: 'Distribution Board 08', kind: 'panel' },
    { id: 'GEN-09', label: 'Standby Generator 09', kind: 'generator' },
    { id: 'COMP-10', label: 'Site Compressor 10', kind: 'chiller' },
  ]),
  buildLevel('4', 'Level 4 — slab pour', 3, [
    { id: 'PUMP-11', label: 'Concrete Pump 11', kind: 'pump' },
    { id: 'WELD-12', label: 'Welding Set 12', kind: 'welder' },
    { id: 'DB-13', label: 'Distribution Board 13', kind: 'panel' },
  ]),
  buildLevel('5', 'Level 5 — formwork', 4, [
    { id: 'CRANE-14', label: 'Tower Crane 14 — mast tie', kind: 'crane' },
    { id: 'HOIST-15', label: 'Material Hoist 15', kind: 'hoist' },
    { id: 'PUMP-16', label: 'Grout Pump 16', kind: 'pump' },
  ]),
  buildLevel('6', 'Roof & crane deck', 5, [
    { id: 'CRANE-17', label: 'Tower Crane 17 — jib', kind: 'crane' },
    { id: 'GEN-18', label: 'Roof Generator 18', kind: 'generator' },
    { id: 'DB-19', label: 'Distribution Board 19', kind: 'panel' },
  ]),
];
