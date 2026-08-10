import type { PortalDef, SiteDef } from '@/sites/types';
import {
  CONSTRUCTION_FLOORS,
  FLOOR_HEIGHT,
  HOIST_POSITION,
  STAIR_POSITION,
} from '@/sites/construction/floors';

/**
 * Two ways up, both slower than the factory's.
 *
 * A scaffold stair is a scaffold stair — steeper, with half-landings — and the
 * hoist is a cage on a mast that has to be called, boarded and gated. Neither
 * is a lift, and making them as quick as one would flatten the only thing that
 * makes the two sites feel different to move around: on a construction site,
 * getting to another level is a decision.
 */
function buildPortals(): PortalDef[] {
  const portals: PortalDef[] = [];
  for (let i = 0; i < CONSTRUCTION_FLOORS.length - 1; i++) {
    const below = CONSTRUCTION_FLOORS[i].id;
    const above = CONSTRUCTION_FLOORS[i + 1].id;
    portals.push({
      id: `stairs-${below}-${above}`,
      kind: 'stairs',
      fromFloor: below,
      toFloor: above,
      fromPosition: { ...STAIR_POSITION },
      toPosition: { ...STAIR_POSITION },
      travelSeconds: 9,
    });
    portals.push({
      id: `hoist-${below}-${above}`,
      // Declared as a lift because that is what it is to the pathfinder: a
      // ride you wait for rather than a climb. What makes it a hoist is the
      // asset standing at its landing and the time it takes.
      kind: 'lift',
      fromFloor: below,
      toFloor: above,
      fromPosition: { ...HOIST_POSITION },
      toPosition: { ...HOIST_POSITION },
      travelSeconds: 11,
    });
  }
  return portals;
}

export const CONSTRUCTION: SiteDef = {
  id: 'construction',
  style: 'frame',
  label: 'Construction site',
  floors: CONSTRUCTION_FLOORS,
  portals: buildPortals(),
  floorHeight: FLOOR_HEIGHT,
};
