import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import { C } from '@/styles/palette';

/**
 * Where the site stands on the earth, as an object you can point at.
 *
 * Everything in the simulation is metres from an arbitrary origin, and that
 * origin has to correspond to a real coordinate — the one a physical handset
 * is standing at. Rather than typing that in, you place this pin: whatever
 * spot it sits on becomes the coordinate, and the whole site relocates around
 * it. Nobody in the building moves, and every distance between every phone and
 * every alert is preserved, because a translation preserves all of them.
 *
 * It is drawn as a survey pin because that is exactly what it is: a marker
 * that says "this point, here, is the known one".
 */

export type AnchorPinProps = {
  x: number;
  z: number;
  /** dim it when its floor is not the one being looked at */
  active: boolean;
};

const PIN_HEIGHT = 1.5;

export function AnchorPin({ x, z, active }: AnchorPinProps) {
  const ring = useRef<THREE.Mesh>(null);
  const clock = useRef(0);

  useFrame((_, delta) => {
    if (!active || !ring.current) return;
    // A slow breathing ring. The pin is small and easily lost against a floor
    // of plant, and it is the one object on screen whose position is a
    // *setting* rather than a fact — it should look like it wants attention.
    clock.current += delta;
    const pulse = 1 + Math.sin(clock.current * 1.6) * 0.12;
    ring.current.scale.set(pulse, pulse, 1);
  });

  const brass = active ? C.caution : '#7d6a2c';

  return (
    <group position={[x, 0, z]}>
      <mesh ref={ring} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, 0.62, 32]} />
        <meshBasicMaterial
          color={brass}
          transparent
          opacity={active ? 0.8 : 0.4}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* the stake */}
      <mesh position={[0, PIN_HEIGHT / 2, 0]} castShadow={active}>
        <cylinderGeometry args={[0.035, 0.035, PIN_HEIGHT, 8]} />
        <meshStandardMaterial color={brass} roughness={0.45} metalness={0.5} />
      </mesh>

      {/* the head — a flat disc, readable from directly above as well as level */}
      <mesh position={[0, PIN_HEIGHT, 0]} castShadow={active}>
        <cylinderGeometry args={[0.2, 0.2, 0.07, 16]} />
        <meshStandardMaterial
          color={brass}
          roughness={0.35}
          metalness={0.6}
          emissive={new THREE.Color(brass)}
          emissiveIntensity={active ? 0.35 : 0}
        />
      </mesh>

      {active && (
        <Billboard position={[0, PIN_HEIGHT + 0.34, 0]}>
          <Text
            fontSize={0.32}
            color={C.caution}
            anchorX="center"
            anchorY="bottom"
            outlineWidth={0.024}
            outlineColor="#1b212a"
          >
            SITE ANCHOR
          </Text>
        </Billboard>
      )}
    </group>
  );
}
