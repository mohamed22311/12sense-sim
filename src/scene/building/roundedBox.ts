import * as THREE from 'three';
import { toCreasedNormals } from 'three-stdlib';

/**
 * A box with real bevelled edges.
 *
 * This exists because the previous helper of the same name was a no-op: it
 * returned a plain `BoxGeometry` and stored the radius in `userData`, where
 * nothing read it. Every worker and every machine in the building has been
 * hard-edged since, which is most of why the scene read as primitives rather
 * than as objects.
 *
 * A bevel is not decoration. A perfectly sharp edge produces a single
 * discontinuous jump in shading, so it reads as a mathematical boundary; a
 * bevel two millimetres wide catches a specular highlight along its length and
 * reads as a manufactured edge. It is the cheapest thing that separates
 * "modelled" from "generated".
 *
 * Built the way drei's `RoundedBox` builds it — an extruded rounded profile
 * with creased normals — but as a plain geometry, so the same instance can be
 * shared by sixty meshes instead of memoised per component.
 */

const EPS = 0.00001;

function profile(width: number, height: number, radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  const r = radius - EPS;
  shape.absarc(EPS, EPS, EPS, -Math.PI / 2, -Math.PI, true);
  shape.absarc(EPS, height - r * 2, EPS, Math.PI, Math.PI / 2, true);
  shape.absarc(width - r * 2, height - r * 2, EPS, Math.PI / 2, 0, true);
  shape.absarc(width - r * 2, EPS, EPS, 0, -Math.PI / 2, true);
  return shape;
}

/**
 * `radius` is clamped to just under half the smallest side: a bevel wider than
 * that inverts the extrusion and produces a shape with folded normals, which
 * renders as a black smear rather than failing loudly.
 */
export function roundedBox(
  width: number,
  height: number,
  depth: number,
  radius: number,
  smoothness = 3,
): THREE.BufferGeometry {
  const r = Math.min(radius, Math.min(width, height, depth) / 2 - EPS);
  const geometry = new THREE.ExtrudeGeometry(profile(width, height, r), {
    depth: depth - r * 2,
    bevelEnabled: true,
    bevelSegments: smoothness * 2,
    steps: 1,
    bevelSize: r - EPS,
    bevelThickness: r,
    curveSegments: smoothness,
  });
  geometry.center();
  // Without this the bevel shades as facets and the effect is lost entirely.
  return toCreasedNormals(geometry, 0.4);
}

/**
 * A tapered box: the same bevelled shape, narrowed toward one end.
 *
 * Bodies are not extruded rectangles. A torso that is wider at the shoulders
 * than the waist, and a limb that narrows toward the hand, is the difference
 * between a figure and a stack of blocks — and it costs one vertex pass over
 * a geometry that is built once and shared by the whole crowd.
 */
export function taperedBox(
  width: number,
  height: number,
  depth: number,
  radius: number,
  /** width and depth at the bottom, as a fraction of the top */
  taper: number,
): THREE.BufferGeometry {
  const geometry = roundedBox(width, height, depth, radius);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const half = height / 2;

  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    // 0 at the bottom, 1 at the top, so the scale runs from `taper` to 1.
    const t = (y + half) / height;
    const scale = taper + (1 - taper) * t;
    position.setX(i, position.getX(i) * scale);
    position.setZ(i, position.getZ(i) * scale);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return toCreasedNormals(geometry, 0.4);
}
