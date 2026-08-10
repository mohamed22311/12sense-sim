/**
 * Shared geometry and materials for the worker crowd.
 *
 * The measured problem: `SimWorker` scaled every limb by a per-worker `build`
 * factor, so drei memoised a *distinct* `RoundedBoxGeometry` per worker — ~300
 * to 480 of them for sixty people — and each mesh carried its own inline
 * material, another ~480 unshared. That is the dominant cost in a scene whose
 * simulation ticks in 0.014 ms.
 *
 * The fix is not to make everyone identical. Build varies across a small set of
 * BUCKETS, and every worker in a bucket shares one geometry set; skin and vest
 * colour vary across a small palette of shared materials. Sixty workers still
 * look like sixty people — the eye reads height, colour and gait, not whether
 * two torsos are the same 4% wider — while the GPU sees a handful of objects.
 */
import * as THREE from 'three';
import { PEOPLE } from '@/styles/theme';
import { roundedBox, taperedBox } from '@/scene/building/roundedBox';

/** How many distinct body scales exist. Three reads as varied; sixty does not. */
export const BUILD_BUCKETS = 3;

/** The scale factor for each bucket. */
const BUILD_SCALE = [0.92, 1.0, 1.08] as const;

/** Deterministic 0..1 from a worker index, so a worker looks the same every run. */
export function hashUnit(index: number, salt: number): number {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function buildBucketFor(index: number): number {
  return Math.floor(hashUnit(index, 2) * BUILD_BUCKETS) % BUILD_BUCKETS;
}

export function buildScale(bucket: number): number {
  return BUILD_SCALE[bucket];
}

/**
 * One geometry per shape per bucket, created once for the process.
 *
 * `RoundedBoxGeometry` is not re-created per worker any more; a bucket's set is
 * built on first use and then handed to every worker who shares that build.
 */
type WorkerGeometry = {
  leg: THREE.BufferGeometry;
  boot: THREE.BufferGeometry;
  torso: THREE.BufferGeometry;
  hips: THREE.BufferGeometry;
  neck: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  helmet: THREE.BufferGeometry;
  helmetBrim: THREE.BufferGeometry;
  helmetLow: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  glove: THREE.BufferGeometry;
  band: THREE.BufferGeometry;
  armBand: THREE.BufferGeometry;
};

const geometryCache = new Map<number, WorkerGeometry>();

/**
 * One worker's parts, at one build.
 *
 * Every part is bevelled and most are tapered, because the shapes a body is
 * made of are not extruded rectangles: a torso is wider at the shoulders than
 * the waist, a forearm narrows toward the hand, a leg narrows toward the
 * ankle. That taper is what stops sixty figures reading as stacks of blocks,
 * and it costs nothing at runtime — the geometry is built once per build
 * bucket and shared by every worker in it.
 */
export function workerGeometry(bucket: number): WorkerGeometry {
  const cached = geometryCache.get(bucket);
  if (cached) return cached;

  const s = BUILD_SCALE[bucket];
  const created: WorkerGeometry = {
    // Legs narrow to the ankle; the boot is what stops them ending in air.
    leg: taperedBox(0.155, 0.58 * s, 0.155, 0.045, 0.82),
    boot: roundedBox(0.17, 0.11, 0.24, 0.04),
    // The torso carries the strongest read of build, so it takes the taper.
    torso: taperedBox(0.44 * s, 0.5, 0.27, 0.085, 0.78),
    hips: roundedBox(0.36 * s, 0.16, 0.24, 0.06),
    neck: new THREE.CylinderGeometry(0.055, 0.062, 0.08, 8),
    head: taperedBox(0.19, 0.22, 0.2, 0.075, 0.9),
    helmet: new THREE.SphereGeometry(0.132, 14, 9, 0, Math.PI * 2, 0, Math.PI / 2.1),
    // A brim is the single most recognisable thing about a hard hat, and its
    // shadow on the face is what makes the head read as wearing one.
    helmetBrim: new THREE.CylinderGeometry(0.17, 0.155, 0.022, 14),
    helmetLow: new THREE.SphereGeometry(0.132, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2.1),
    arm: taperedBox(0.105, 0.42, 0.12, 0.045, 0.8),
    glove: roundedBox(0.1, 0.11, 0.11, 0.035),
    band: roundedBox(0.455 * s, 0.055, 0.285, 0.02),
    armBand: roundedBox(0.115, 0.045, 0.13, 0.016),
  };
  geometryCache.set(bucket, created);
  return created;
}

/**
 * Shared materials.
 *
 * People do not change colour with the site — a hi-vis vest is a hi-vis vest on
 * a factory floor and on a slab — so these are built once rather than per
 * theme. Variety comes from four hat colours and two vest colours across the
 * crowd, which is what makes sixty figures read as sixty people.
 */
const skinMaterials = PEOPLE.skin.map(
  (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.72 }),
);

const vestMaterials = PEOPLE.vests.map(
  (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
);

const helmetMaterials = PEOPLE.helmets.map(
  (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.06 }),
);

const pick = <T,>(items: readonly T[], index: number, salt: number): T =>
  items[Math.floor(hashUnit(index, salt) * items.length) % items.length];

export const workerMaterials = {
  skin: (index: number) => pick(skinMaterials, index, 1),
  vestFor: (index: number) => pick(vestMaterials, index, 4),
  helmetFor: (index: number) => pick(helmetMaterials, index, 5),
  trousers: new THREE.MeshStandardMaterial({ color: PEOPLE.trousers, roughness: 0.86 }),
  boots: new THREE.MeshStandardMaterial({ color: PEOPLE.boots, roughness: 0.68 }),
  glove: new THREE.MeshStandardMaterial({ color: PEOPLE.glove, roughness: 0.84 }),
  /** Retroreflective tape: low roughness and a little metalness, so it flares
      under the sun the way the real thing does. */
  band: new THREE.MeshStandardMaterial({ color: PEOPLE.band, roughness: 0.2, metalness: 0.28 }),
  vest: vestMaterials[0],
  helmet: helmetMaterials[0],
} as const;
