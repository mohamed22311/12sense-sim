import * as THREE from 'three';
import type { SiteTheme } from '@/styles/theme';

/**
 * Shared geometry and materials for the things that make a slab read as a
 * working floor rather than a shelf.
 *
 * All of it is created once and reused across six floors, for the same reason
 * the worker crowd shares its assets: three.js compiles a shader per material,
 * and a floor's dressing repeated six times would multiply that for no visual
 * gain — every floor's edge is the same edge.
 */

/** Height of the guard rail along the open cutaway edge, metres. */
export const RAIL_HEIGHT = 1.05;

export type DressingMaterials = {
  hazard: THREE.MeshStandardMaterial;
  rail: THREE.MeshStandardMaterial;
  walkway: THREE.MeshStandardMaterial;
  hazardDim: THREE.MeshStandardMaterial;
  railDim: THREE.MeshStandardMaterial;
  beam: THREE.MeshStandardMaterial;
  beamDim: THREE.MeshStandardMaterial;
  pilaster: THREE.MeshStandardMaterial;
  pilasterDim: THREE.MeshStandardMaterial;
};

const dressingCache = new Map<string, DressingMaterials>();

/** Built once per world, shared by all six floors of it. */
export function dressingMaterials(theme: SiteTheme): DressingMaterials {
  const cached = dressingCache.get(theme.id);
  if (cached) return cached;
  const built: DressingMaterials = {
    hazard: new THREE.MeshStandardMaterial({ color: theme.caution, roughness: 0.62 }),
    rail: new THREE.MeshStandardMaterial({ color: theme.machineTrim, roughness: 0.32, metalness: 0.68 }),
    walkway: new THREE.MeshStandardMaterial({
      color: theme.floorLine,
      roughness: 0.9,
      transparent: true,
      opacity: 0.5,
    }),
    hazardDim: new THREE.MeshStandardMaterial({ color: theme.plantDim, roughness: 0.8 }),
    railDim: new THREE.MeshStandardMaterial({ color: theme.wallDim, roughness: 0.66, metalness: 0.3 }),
    beam: new THREE.MeshStandardMaterial({ color: theme.structureBeam, roughness: 0.66, metalness: 0.22 }),
    beamDim: new THREE.MeshStandardMaterial({ color: theme.structureBeamDim, roughness: 0.84 }),
    pilaster: new THREE.MeshStandardMaterial({ color: theme.wall, roughness: 0.9 }),
    pilasterDim: new THREE.MeshStandardMaterial({ color: theme.wallDim, roughness: 0.92 }),
  };
  dressingCache.set(theme.id, built);
  return built;
}

/**
 * Structure, shared across every floor.
 *
 * A sixteen-metre wall and a sixteen-metre ceiling are the two largest
 * surfaces on screen, and left flat they read as backdrop rather than as
 * building — there is nothing for light to fall across and nothing to give the
 * space a scale. Beams under the slab and pilasters up the back wall fix both
 * at the cost of nine meshes a floor, all sharing one geometry and one
 * material.
 */


/** A capping plate for an obstacle, scaled to its footprint. */
export const obstacleCap = new THREE.BoxGeometry(1, 0.08, 1);

export const structureGeometry = {
  /** A metre of downstand beam, scaled along its length per floor. */
  beam: new THREE.BoxGeometry(0.22, 0.3, 1),
  /** A rib up the back wall, breaking a flat plane into bays. */
  pilaster: new THREE.BoxGeometry(0.34, 1, 0.12),
} as const;

/** Where the ceiling beams sit, as a fraction of the floor's depth. */
export const BEAM_FRACTIONS = [0.18, 0.42, 0.66, 0.9];

/** Where the back-wall pilasters sit, as a fraction of the floor's width. */
export const PILASTER_FRACTIONS = [0.08, 0.29, 0.5, 0.71, 0.92];

export const dressingGeometry = {
  /** A metre of horizontal rail; scaled along its length per floor. */
  railBar: new THREE.CylinderGeometry(0.035, 0.035, 1, 6),
  railPost: new THREE.CylinderGeometry(0.03, 0.03, RAIL_HEIGHT, 6),
  /** One segment of the hazard stripe at the slab's open edge. */
  stripe: new THREE.BoxGeometry(1, 0.02, 0.34),
  /** A painted walkway band. */
  walkway: new THREE.PlaneGeometry(1, 1),
} as const;
