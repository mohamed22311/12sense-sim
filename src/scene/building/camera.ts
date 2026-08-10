import type { SiteDef } from '@/sites/types';
import { C } from '@/styles/palette';
import { FACTORY } from '@/sites/factory';

/**
 * The overview framing for a stacked site.
 *
 * Derived from the site rather than hardcoded: the stack's height is
 * `floors × floorHeight`, and the camera has to sit far enough back that the
 * whole of it fits a 58° vertical field of view with room to spare. The
 * original constants framed a single 3 m room and cut the building off at the
 * third floor.
 *
 * A function rather than a constant, because there are two sites now and they
 * are not the same height — a construction site with taller lifts would have
 * been framed for the factory and clipped.
 */

export type BuildingCamera = {
  /** the initial camera placement, before the rig takes over */
  position: [number, number, number];
  /** x and z of what the rig looks at; y is derived per frame */
  target: [number, number, number];
  /** how far back the rig orbits */
  distance: number;
  /** half the stack's height — where the rig's look-point sits */
  stackMidHeight: number;
};

export function buildingCamera(site: SiteDef): BuildingCamera {
  const top = site.floors[site.floors.length - 1].elevation + site.floorHeight;

  /*
    Distance is derived, not guessed. The stack is `top` metres tall and the
    camera has a 58° vertical field of view, so fitting it with a comfortable
    margin needs roughly (top/2) / tan(29°) — then a little more, because the
    building is also deep and the far side has to fit too.
  */
  const fit = ((top / 2) / Math.tan((29 * Math.PI) / 180)) * 1.34;

  return {
    position: [0, top * 0.42, fit - 6],
    target: [0, top * 0.42, -6],
    distance: fit * 1.06,
    stackMidHeight: top / 2,
  };
}

/** The default framing, for the camera prop that has to exist before a site does. */
export const BUILDING_CAMERA = buildingCamera(FACTORY);

/** Clear colour — the sky the building reads against, from the slate ramp. */
export const SKY_COLOR = C.bg;
