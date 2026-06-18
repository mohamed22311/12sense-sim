import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import type { DecoWorkerDef } from './sceneDefs';

const SKIN_TONES   = ['#e8c5a0', '#c8906a', '#a06040', '#d4a878', '#f0d0a8'];
const SHIRT_COLORS = ['#4a7fb8', '#c06040', '#408060', '#8040a0', '#b08040'];
const PANT_COLORS  = ['#3a4a6a', '#2a3a2a', '#4a3a2a', '#3a3a5a', '#5a4a3a'];
const HELMET_COLORS = ['#f0a820', '#f0a820', '#e05030', '#f0a820', '#20a0e0'];

interface Props { def: DecoWorkerDef }

export function DecoWorker({ def }: Props) {
  const groupRef = useRef<THREE.Group>(null!);
  const idx = def.skinIndex % SKIN_TONES.length;
  const skin   = SKIN_TONES[idx];
  const shirt  = SHIRT_COLORS[idx];
  const pants  = PANT_COLORS[idx];
  const helmet = HELMET_COLORS[idx];

  // Subtle idle sway — each worker offset by skinIndex so they don't sync
  useFrame(() => {
    if (!groupRef.current) return;
    const t = performance.now() * 0.001;
    groupRef.current.position.y = def.position[1] + Math.sin(t * 1.6 + def.skinIndex * 1.3) * 0.005;
  });

  return (
    <group ref={groupRef} position={def.position} rotation={[0, def.facing, 0]}>
      {/* Legs */}
      <RoundedBox args={[0.11, 0.44, 0.11]} radius={0.03} position={[-0.08, 0.22, 0]} castShadow>
        <meshStandardMaterial color={pants} roughness={0.9} metalness={0} />
      </RoundedBox>
      <RoundedBox args={[0.11, 0.44, 0.11]} radius={0.03} position={[ 0.08, 0.22, 0]} castShadow>
        <meshStandardMaterial color={pants} roughness={0.9} metalness={0} />
      </RoundedBox>

      {/* Torso */}
      <RoundedBox args={[0.32, 0.42, 0.18]} radius={0.05} position={[0, 0.66, 0]} castShadow>
        <meshStandardMaterial color={shirt} roughness={0.88} metalness={0} />
      </RoundedBox>

      {/* Hi-vis vest stripes */}
      <mesh position={[0, 0.68, 0.092]}>
        <planeGeometry args={[0.30, 0.06]} />
        <meshStandardMaterial color="#f0c020" emissive="#f0c020" emissiveIntensity={0.3} roughness={0.8} side={2} />
      </mesh>
      <mesh position={[0, 0.58, 0.092]}>
        <planeGeometry args={[0.30, 0.06]} />
        <meshStandardMaterial color="#f0c020" emissive="#f0c020" emissiveIntensity={0.3} roughness={0.8} side={2} />
      </mesh>

      {/* Head */}
      <mesh position={[0, 1.06, 0]} castShadow>
        <sphereGeometry args={[0.13, 12, 10]} />
        <meshStandardMaterial color={skin} roughness={0.85} metalness={0} />
      </mesh>

      {/* Helmet */}
      <mesh position={[0, 1.17, 0]} castShadow>
        <sphereGeometry args={[0.155, 12, 8]} />
        <meshStandardMaterial color={helmet} roughness={0.7} metalness={0.1} />
      </mesh>
      <mesh position={[0, 1.11, 0.06]}>
        <cylinderGeometry args={[0.175, 0.18, 0.028, 16]} />
        <meshStandardMaterial color={helmet} roughness={0.7} metalness={0.1} />
      </mesh>

      {/* Arms — slightly raised toward machine (working pose) */}
      <RoundedBox args={[0.095, 0.38, 0.095]} radius={0.03}
        position={[-0.20, 0.70, 0.10]} rotation={[-0.55, 0, 0.18]} castShadow>
        <meshStandardMaterial color={shirt} roughness={0.88} metalness={0} />
      </RoundedBox>
      <RoundedBox args={[0.095, 0.38, 0.095]} radius={0.03}
        position={[ 0.20, 0.70, 0.10]} rotation={[-0.55, 0, -0.18]} castShadow>
        <meshStandardMaterial color={shirt} roughness={0.88} metalness={0} />
      </RoundedBox>

      {/* Hands */}
      <mesh position={[-0.22, 0.52, 0.20]}>
        <sphereGeometry args={[0.055, 8, 8]} />
        <meshStandardMaterial color={skin} roughness={0.85} />
      </mesh>
      <mesh position={[ 0.22, 0.52, 0.20]}>
        <sphereGeometry args={[0.055, 8, 8]} />
        <meshStandardMaterial color={skin} roughness={0.85} />
      </mesh>
    </group>
  );
}
