import type { MachineDef, PortalDef, SiteDef } from '@/sites/types';
import {
  FACTORY_FLOORS,
  FLOOR_HEIGHT,
  LIFT_POSITION,
  STAIR_POSITION,
} from '@/sites/factory/floors';

/**
 * Portals connect adjacent floors only, in both directions, through two shafts:
 * a stairwell on the west side and a lift on the east.
 *
 * Adjacent-only is deliberate. A lift that stopped at every floor from every
 * floor would let a worker teleport six levels in one leg, and the cross-floor
 * search would stop being interesting — the walk to the shaft is most of what
 * makes a floor change read as travel rather than a cut.
 */
function buildPortals(): PortalDef[] {
  const portals: PortalDef[] = [];
  for (let i = 0; i < FACTORY_FLOORS.length - 1; i++) {
    const below = FACTORY_FLOORS[i].id;
    const above = FACTORY_FLOORS[i + 1].id;
    portals.push({
      id: `stairs-${below}-${above}`,
      kind: 'stairs',
      fromFloor: below,
      toFloor: above,
      fromPosition: { ...STAIR_POSITION },
      toPosition: { ...STAIR_POSITION },
      travelSeconds: 6,
    });
    portals.push({
      id: `lift-${below}-${above}`,
      kind: 'lift',
      fromFloor: below,
      toFloor: above,
      fromPosition: { ...LIFT_POSITION },
      toPosition: { ...LIFT_POSITION },
      travelSeconds: 4,
    });
  }
  return portals;
}

export const FACTORY: SiteDef = {
  id: 'factory',
  style: 'enclosed',
  label: 'Factory',
  floors: FACTORY_FLOORS,
  portals: buildPortals(),
  floorHeight: FLOOR_HEIGHT,
};

/**
 * Throws rather than returning undefined: every caller here treats a floor id
 * as data it already validated, so a miss is a bug in the caller and should
 * surface at the point it happened rather than as a null three frames later.
 */
export function floorOf(site: SiteDef, floorId: string) {
  const floor = site.floors.find((f) => f.id === floorId);
  if (!floor) {
    throw new Error(
      `unknown floor ${JSON.stringify(floorId)} on site ${site.id}; ` +
        `known floors: ${site.floors.map((f) => f.id).join(', ')}`,
    );
  }
  return floor;
}

export function allMachines(site: SiteDef): MachineDef[] {
  return site.floors.flatMap((f) => f.machines);
}

export { FACTORY_FLOORS, FLOOR_HEIGHT, LIFT_POSITION, STAIR_POSITION };
