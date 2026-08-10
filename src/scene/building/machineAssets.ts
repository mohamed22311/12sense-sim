import * as THREE from 'three';
import { SIGNAL, type SiteTheme } from '@/styles/theme';
import { roundedBox } from '@/scene/building/roundedBox';

/**
 * Shared geometry and materials for the machines.
 *
 * Same discipline as the worker crowd: every machine of a kind draws from one
 * set of objects, because a floor holds three or four and the building holds
 * twenty, and three.js compiles a shader per material. Variation between kinds
 * comes from silhouette, which is what actually tells a reactor from a packing
 * line at a glance — not from each instance owning its own materials.
 */

/**
 * Machine materials, built per theme and cached.
 *
 * A factory's plant is painted steel-teal and a construction site's is
 * hire-fleet yellow, so these cannot be module constants any more. They are
 * still built once *per world* rather than per machine — the sharing that
 * keeps the shader count down is unchanged, the cache key is just the theme
 * now instead of nothing.
 */
export type MachineMaterials = {
  body: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  panel: THREE.MeshStandardMaterial;
  screen: THREE.MeshStandardMaterial;
  hazard: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  lamp: () => THREE.MeshStandardMaterial;
};

const machineMaterialCache = new Map<string, MachineMaterials>();

export function machineMaterials(theme: SiteTheme): MachineMaterials {
  const cached = machineMaterialCache.get(theme.id);
  if (cached) return cached;

  const built: MachineMaterials = {
    /*
      Painted housing, machined guard, dark cabinet — separated by roughness as
      much as by colour. A scene where every surface shares one roughness reads
      as a single material tinted differently; the specular response is what
      tells cast housing from a guard, and it costs nothing.
    */
    body: new THREE.MeshStandardMaterial({ color: theme.machineBody, roughness: 0.62, metalness: 0.28 }),
    trim: new THREE.MeshStandardMaterial({ color: theme.machineTrim, roughness: 0.3, metalness: 0.66 }),
    panel: new THREE.MeshStandardMaterial({ color: theme.machinePanel, roughness: 0.58, metalness: 0.3 }),
    screen: new THREE.MeshStandardMaterial({
      color: SIGNAL.screen,
      roughness: 0.28,
      emissive: new THREE.Color(SIGNAL.screenGlow),
      emissiveIntensity: 0.7,
    }),
    hazard: new THREE.MeshStandardMaterial({ color: theme.caution, roughness: 0.62 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#2a2f36', roughness: 0.92 }),
    /** Status lamp. Cloned per machine, because each one's colour is its own. */
    lamp: () =>
      new THREE.MeshStandardMaterial({
        color: SIGNAL.green,
        emissive: new THREE.Color(SIGNAL.green),
        emissiveIntensity: 1.3,
        roughness: 0.3,
      }),
  };
  machineMaterialCache.set(theme.id, built);
  return built;
}

export const machineGeometry = {
  // shared primitives
  lamp: new THREE.SphereGeometry(0.075, 10, 8),
  post: new THREE.CylinderGeometry(0.07, 0.07, 1, 8),
  pipe: new THREE.CylinderGeometry(0.055, 0.055, 1, 8),
  plate: new THREE.BoxGeometry(1, 1, 1),
  /** A bevelled unit cube, for the plates that read as parts rather than trim. */
  block: roundedBox(1, 1, 1, 0.06),

  // reactor — a tall vessel with a domed head, the tallest thing on a floor
  vessel: new THREE.CylinderGeometry(0.62, 0.68, 2.0, 16),
  dome: new THREE.SphereGeometry(0.62, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  skirt: new THREE.CylinderGeometry(0.72, 0.78, 0.28, 16),

  // chiller — a boxy unit with a fan face
  chillerBody: roundedBox(1.5, 1.35, 1.0, 0.07),
  fanRing: new THREE.TorusGeometry(0.34, 0.055, 8, 20),
  fanBlade: new THREE.BoxGeometry(0.58, 0.05, 0.12),

  // panel — a slim wall cabinet
  cabinet: roundedBox(1.05, 1.7, 0.36, 0.05),
  screen: new THREE.PlaneGeometry(0.62, 0.4),

  // press — a heavy frame with a ram
  pressFrame: roundedBox(1.5, 0.28, 1.1, 0.05),
  pressColumn: new THREE.CylinderGeometry(0.1, 0.1, 1.9, 10),
  ram: roundedBox(0.9, 0.42, 0.75, 0.05),
  bed: roundedBox(1.2, 0.22, 0.9, 0.04),

  // packer — a low conveyor bed under an arch
  conveyor: roundedBox(2.1, 0.16, 0.72, 0.035),
  roller: new THREE.CylinderGeometry(0.09, 0.09, 0.72, 10),
  arch: new THREE.BoxGeometry(0.14, 1.15, 0.14),
  archTop: roundedBox(1.5, 0.16, 0.2, 0.035),
  carton: roundedBox(0.3, 0.26, 0.3, 0.022),

  // furnace — a squat box with a stack and a glowing door
  furnaceBody: roundedBox(1.5, 1.5, 1.2, 0.07),
  stack: new THREE.CylinderGeometry(0.2, 0.24, 1.5, 10),
  door: new THREE.PlaneGeometry(0.66, 0.5),
} as const;

/** The furnace door glow; shared, since every furnace burns the same. */
export const furnaceGlow = new THREE.MeshStandardMaterial({
  // The one genuinely hot thing in the scene. Kept warmer and brighter than
  // any other surface so a lit furnace door reads as heat, not as paint.
  color: '#e8823c',
  emissive: new THREE.Color('#e0611f'),
  emissiveIntensity: 1.5,
  roughness: 0.5,
});

/**
 * The construction site's plant.
 *
 * Kept in its own block rather than merged above because these are a different
 * world: painted steel and diesel rather than stainless and pipework, and the
 * silhouettes have to separate from each other, not from a reactor. A hoist is
 * a mast, a crane is a lattice, a generator is a box on skids, a pump is a
 * skid with a hopper, a welder is a trolley with bottles.
 */
export type SitePlantMaterials = {
  plant: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  bottle: THREE.MeshStandardMaterial;
};

const sitePlantCache = new Map<string, SitePlantMaterials>();

export function siteMaterials(theme: SiteTheme): SitePlantMaterials {
  const cached = sitePlantCache.get(theme.id);
  if (cached) return cached;
  const built: SitePlantMaterials = {
    /** Hire-fleet yellow. On a real site it is the most saturated thing in
        view, and the scene should agree rather than muting it. */
    plant: new THREE.MeshStandardMaterial({ color: theme.caution, roughness: 0.58, metalness: 0.16 }),
    steel: new THREE.MeshStandardMaterial({ color: theme.machineTrim, roughness: 0.36, metalness: 0.62 }),
    dark: new THREE.MeshStandardMaterial({ color: '#39414b', roughness: 0.78 }),
    /** Gas bottles, and anything else that must read as "not structure". */
    bottle: new THREE.MeshStandardMaterial({ color: '#2f7f9e', roughness: 0.4, metalness: 0.34 }),
  };
  sitePlantCache.set(theme.id, built);
  return built;
}

export const siteGeometry = {
  /** hoist — a mast with a cage running up it */
  mast: new THREE.BoxGeometry(0.16, 3.4, 0.16),
  cage: roundedBox(1.0, 1.5, 0.9, 0.05),
  cageBar: new THREE.BoxGeometry(0.06, 1.5, 0.06),
  hoistBase: roundedBox(1.6, 0.24, 1.4, 0.04),

  /** crane — a lattice mast section, the tallest thing on any deck */
  latticeLeg: new THREE.BoxGeometry(0.12, 3.6, 0.12),
  latticeBrace: new THREE.BoxGeometry(1.3, 0.08, 0.08),
  craneBase: roundedBox(2.0, 0.3, 2.0, 0.05),

  /** generator — a canopied set on skids */
  canopy: roundedBox(1.9, 1.05, 0.95, 0.07),
  skid: roundedBox(2.1, 0.18, 1.1, 0.035),
  louvre: new THREE.BoxGeometry(0.03, 0.62, 0.5),
  exhaust: new THREE.CylinderGeometry(0.08, 0.08, 0.9, 8),

  /** pump — a skid with a hopper and a folded boom */
  hopper: new THREE.CylinderGeometry(0.62, 0.34, 0.7, 4),
  boom: new THREE.BoxGeometry(0.18, 0.18, 1.8),
  outrigger: new THREE.BoxGeometry(0.14, 0.12, 1.1),

  /** welder — a trolley with two bottles and a screen */
  trolley: roundedBox(0.85, 0.55, 0.6, 0.05),
  bottle: new THREE.CylinderGeometry(0.13, 0.13, 1.15, 10),
  bottleCap: new THREE.CylinderGeometry(0.07, 0.07, 0.16, 8),
  screen: roundedBox(1.1, 1.35, 0.05, 0.02),
  wheel: new THREE.CylinderGeometry(0.16, 0.16, 0.08, 12),
} as const;
