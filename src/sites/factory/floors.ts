import type { FloorDef, JobAnchor, MachineDef, ObstacleRect, Vec2 } from '@/sites/types';

/**
 * The factory's six floors.
 *
 * Written through a small builder rather than as six hand-typed literals: the
 * repeated parts (bounds, the anchor set every floor must carry, the obstacle
 * footprint under each machine) are exactly the parts that drift when copied,
 * and the site tests assert those invariants. What stays hand-written per floor
 * is the only thing that is genuinely different — which machines are on it.
 */

/** Every floor shares one footprint; the building is a stack, not a ziggurat. */
export const FLOOR_BOUNDS = { minX: -8, maxX: 8, minZ: -14, maxZ: 2 } as const;

export const FLOOR_HEIGHT = 4;

/** Machines occupy a square footprint of this side length, centred on them. */
const MACHINE_FOOTPRINT = 2.4;

/** Where the two portals meet each floor. Kept clear of machines and anchors. */
export const STAIR_POSITION: Vec2 = { x: -7, z: 0 };
export const LIFT_POSITION: Vec2 = { x: 7, z: 0 };

/** The four positions a floor's machines occupy, in order. */
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
 * A plant block down the centre of every floor. It exists so pathing has
 * something to route *around* on every level — a floor whose only obstacles are
 * its machines produces suspiciously straight walks.
 */
const CENTRAL_PLANT: ObstacleRect = { x: -1.4, z: -8.5, w: 2.8, d: 3.5 };

/** The anchors every floor must carry, plus two optional ones. */
function anchorsFor(floorId: string): JobAnchor[] {
  return [
    { id: `stores-${floorId}`, kind: 'stores', floor: floorId, position: { x: -6.5, z: -12.5 } },
    { id: `terminal-${floorId}`, kind: 'terminal', floor: floorId, position: { x: 6.0, z: -3.0 } },
    { id: `break-${floorId}`, kind: 'break', floor: floorId, position: { x: -5.0, z: 0.6 } },
    { id: `inspect-${floorId}`, kind: 'inspect', floor: floorId, position: { x: 0.0, z: -12.5 } },
    { id: `sweep-${floorId}`, kind: 'sweep', floor: floorId, position: { x: 1.5, z: -1.5 } },
  ];
}

function buildFloor(
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
    obstacles: [...machines.map((m) => footprintOf(m.position)), CENTRAL_PLANT],
    machines,
    anchors: anchorsFor(id),
  };
}

/*
  `kind` is the machine's *shape and failure vocabulary*, not decoration. It
  decides which body is drawn and which alerts the dialog offers, so a conveyor
  typed as a press offers "light curtain broken during stroke" — an alert a
  conveyor cannot raise. These were assigned when the renderer knew three
  bodies and several are corrected here now that it knows six.
*/
export const FACTORY_FLOORS: FloorDef[] = [
  buildFloor('1', 'Goods-in / dispatch', 0, [
    { id: 'DOCK-LIFT-01', label: 'Dock Lift 01', kind: 'panel' },
    { id: 'PALLET-WRAP-02', label: 'Pallet Wrapper 02', kind: 'packer' },
    { id: 'CONVEYOR-IN-03', label: 'Inbound Conveyor 03', kind: 'packer' },
  ]),
  buildFloor('2', 'Material prep', 1, [
    { id: 'MIXER-04', label: 'Mixer 04', kind: 'reactor' },
    { id: 'DRYER-05', label: 'Rotary Dryer 05', kind: 'furnace' },
    { id: 'HOPPER-06', label: 'Hopper 06', kind: 'packer' },
  ]),
  buildFloor('3', 'Production hall', 2, [
    { id: 'PRESS-12', label: 'Press 12', kind: 'press' },
    { id: 'CNC-07', label: 'CNC Cell 07', kind: 'press' },
    { id: 'CONVEYOR-08', label: 'Line Conveyor 08', kind: 'packer' },
    { id: 'ROBOT-09', label: 'Pick Robot 09', kind: 'panel' },
  ]),
  buildFloor('4', 'Process hall', 3, [
    { id: 'REACTOR-01', label: 'Process Reactor 01', kind: 'reactor' },
    { id: 'CHILLER-07', label: 'Chiller 07 — Cold Room B', kind: 'chiller' },
    { id: 'PRESSURE-VESSEL-10', label: 'Pressure Vessel 10', kind: 'reactor' },
  ]),
  buildFloor('5', 'Packaging & QA', 4, [
    { id: 'PACK-03', label: 'Packing Line 03', kind: 'packer' },
    { id: 'LABELLER-11', label: 'Labeller 11', kind: 'packer' },
    { id: 'INSPECT-BENCH-13', label: 'Inspection Bench 13', kind: 'panel' },
  ]),
  buildFloor('6', 'Plant & control', 5, [
    { id: 'COMPRESSOR-01', label: 'Compressor 01', kind: 'chiller' },
    { id: 'SWITCHGEAR-14', label: 'Switchgear 14', kind: 'panel' },
    { id: 'HVAC-15', label: 'HVAC Plant 15', kind: 'chiller' },
  ]),
];
