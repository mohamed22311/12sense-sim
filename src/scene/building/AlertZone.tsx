import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { DoubleSide, type Mesh, type MeshBasicMaterial } from 'three';
import { SIGNAL } from '@/styles/theme';

/**
 * The reach of an alert, drawn on the floor while the radius is being chosen.
 *
 * A slider reading "12 m" does not answer the question the operator is asking,
 * which is *who will this reach*. On a 16 m floor the difference between 8 m
 * and 20 m is the difference between three people and everyone, and until the
 * alert is raised — irreversibly, on a live server — there was no way to see
 * which. This is that answer, at the scale the decision is actually made at.
 *
 * Drawn as a disc plus a travelling ring rather than a static outline. The
 * motion is not decoration: the disc alone reads as a painted marking on the
 * floor, and the point being made is that this is a *broadcast* with an edge.
 *
 * `depthWrite` is off and the disc sits a few centimetres above the slab, so it
 * reads as light cast on the floor rather than as an object standing on it, and
 * never z-fights with the slab underneath.
 */

/** Seconds for the ring to travel from the machine out to the edge. */
const SWEEP_PERIOD_S = 1.9;

/** How far above the slab the zone floats, in metres. */
const LIFT = 0.04;

export type AlertZoneProps = {
  x: number;
  z: number;
  radiusM: number;
  /** dimmed when the floor it is on is not the one being looked at */
  active: boolean;
};

export function AlertZone({ x, z, radiusM, active }: AlertZoneProps) {
  const ringRef = useRef<Mesh>(null);
  const ringMat = useRef<MeshBasicMaterial>(null);
  const edgeMat = useRef<MeshBasicMaterial>(null);
  const elapsed = useRef(0);

  /*
    Unit geometry, scaled by the radius. The radius changes on every pointer
    move of the slider — rebuilding a ring geometry per frame would allocate
    and dispose sixty times a second for a control that is being dragged.
  */
  const segments = useMemo(() => Math.max(48, Math.round(radiusM * 6)), [radiusM]);

  useFrame((_, dt) => {
    elapsed.current = (elapsed.current + dt) % SWEEP_PERIOD_S;
    const t = elapsed.current / SWEEP_PERIOD_S;

    if (ringRef.current) {
      // Travels out from the machine, so the eye reads the direction the alert
      // goes rather than a circle that merely pulses in place.
      const scale = Math.max(0.001, t * radiusM);
      ringRef.current.scale.set(scale, scale, 1);
    }
    if (ringMat.current) {
      // Fades as it reaches the edge — a ring that vanishes at full radius
      // states where the boundary is without drawing a hard second line there.
      ringMat.current.opacity = (active ? 0.55 : 0.2) * (1 - t) ** 1.4;
    }
    if (edgeMat.current) {
      const breathe = 0.5 + 0.5 * Math.sin((elapsed.current / SWEEP_PERIOD_S) * Math.PI * 2);
      edgeMat.current.opacity = (active ? 0.75 : 0.28) + breathe * 0.15;
    }
  });

  return (
    <group position={[x, LIFT, z]} rotation={[-Math.PI / 2, 0, 0]}>
      {/* the filled area — everyone standing in this is in range */}
      <mesh renderOrder={2}>
        <circleGeometry args={[radiusM, segments]} />
        <meshBasicMaterial
          color={SIGNAL.red}
          transparent
          opacity={active ? 0.13 : 0.05}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>

      {/* the boundary itself, which is the number on the slider made visible */}
      <mesh renderOrder={4}>
        <ringGeometry args={[radiusM * 0.985, radiusM, segments]} />
        <meshBasicMaterial
          ref={edgeMat}
          color={SIGNAL.red}
          transparent
          opacity={0.75}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>

      {/* the travelling sweep */}
      <mesh ref={ringRef} renderOrder={3}>
        <ringGeometry args={[0.94, 1, 64]} />
        <meshBasicMaterial
          ref={ringMat}
          color={SIGNAL.red}
          transparent
          opacity={0.5}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
    </group>
  );
}
