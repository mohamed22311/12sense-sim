import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import type { DecoWorkerDef } from './sceneDefs';

const SKIN_TONES    = ['#e8c5a0', '#c8906a', '#a06040', '#d4a878', '#f0d0a8'];
const SHIRT_COLORS  = ['#4a7fb8', '#c06040', '#408060', '#8040a0', '#b08040'];
const PANT_COLORS   = ['#3a4a6a', '#2a3a2a', '#4a3a2a', '#3a3a5a', '#5a4a3a'];
const HELMET_COLORS = ['#f0a820', '#f0a820', '#e05030', '#f0a820', '#20a0e0'];

interface Props { def: DecoWorkerDef }

export function DecoWorker({ def }: Props) {
  const groupRef    = useRef<THREE.Group>(null!);
  const leftArmRef  = useRef<THREE.Group>(null!);
  const rightArmRef = useRef<THREE.Group>(null!);
  const headRef     = useRef<THREE.Group>(null!);

  const idx    = def.skinIndex % SKIN_TONES.length;
  const skin   = SKIN_TONES[idx];
  const shirt  = SHIRT_COLORS[idx];
  const pants  = PANT_COLORS[idx];
  const helmet = HELMET_COLORS[idx];
  const role   = def.role ?? 'idle';

  useFrame(() => {
    if (!groupRef.current) return;
    const t  = performance.now() * 0.001;
    const ph = def.skinIndex * 1.3;

    groupRef.current.position.y = def.position[1] + Math.sin(t * 1.6 + ph) * 0.005;

    if (headRef.current) {
      headRef.current.rotation.y = Math.sin(t * 0.45 + ph) * 0.28;
    }

    if (!leftArmRef.current || !rightArmRef.current) return;

    switch (role) {
      case 'panel': {
        // Arms alternate pressing controls
        const la = Math.sin(t * 1.8 + ph);
        const ra = Math.sin(t * 1.8 + ph + Math.PI * 0.7);
        leftArmRef.current.rotation.x  = -0.55 - Math.max(0, la) * 0.45;
        rightArmRef.current.rotation.x = -0.55 - Math.max(0, ra) * 0.45;
        leftArmRef.current.rotation.z  =  0.14;
        rightArmRef.current.rotation.z = -0.14;
        break;
      }
      case 'carry': {
        // Arms forward, carrying a box — slight body sway
        const sway = Math.sin(t * 0.55 + ph) * 0.04;
        leftArmRef.current.rotation.x  = -1.05 + sway;
        rightArmRef.current.rotation.x = -1.05 + sway;
        leftArmRef.current.rotation.z  =  0.24;
        rightArmRef.current.rotation.z = -0.24;
        break;
      }
      case 'wrench': {
        // Right arm cycles like tightening a bolt
        const stroke = Math.sin(t * 2.2 + ph);
        rightArmRef.current.rotation.x = -0.55 - stroke * 0.38;
        rightArmRef.current.rotation.z = -0.20 - Math.max(0, stroke) * 0.18;
        leftArmRef.current.rotation.x  = -0.45;
        leftArmRef.current.rotation.z  =  0.18;
        break;
      }
      case 'inspect': {
        // Lean down to inspect, slow rise-and-dip
        const lean = Math.abs(Math.sin(t * 0.35 + ph)) * 0.32;
        groupRef.current.rotation.x = lean;
        leftArmRef.current.rotation.x  = -0.6 - lean * 0.8;
        rightArmRef.current.rotation.x = -0.35;
        leftArmRef.current.rotation.z  =  0.16;
        rightArmRef.current.rotation.z = -0.10;
        break;
      }
      default: {
        // Gentle idle sway
        leftArmRef.current.rotation.x  = -0.38 + Math.sin(t * 0.75 + ph) * 0.09;
        rightArmRef.current.rotation.x = -0.38 + Math.sin(t * 0.75 + ph + 1.1) * 0.09;
        leftArmRef.current.rotation.z  =  0.15;
        rightArmRef.current.rotation.z = -0.15;
        break;
      }
    }
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

      {/* Head + helmet */}
      <group ref={headRef} position={[0, 1.06, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.13, 12, 10]} />
          <meshStandardMaterial color={skin} roughness={0.85} metalness={0} />
        </mesh>
        <mesh position={[0, 0.11, 0]} castShadow>
          <sphereGeometry args={[0.155, 12, 8]} />
          <meshStandardMaterial color={helmet} roughness={0.7} metalness={0.1} />
        </mesh>
        <mesh position={[0, 0.05, 0.06]}>
          <cylinderGeometry args={[0.175, 0.18, 0.028, 16]} />
          <meshStandardMaterial color={helmet} roughness={0.7} metalness={0.1} />
        </mesh>
      </group>

      {/* Left arm — pivot at shoulder */}
      <group ref={leftArmRef} position={[-0.20, 0.78, 0]} rotation={[-0.55, 0, 0.14]}>
        <RoundedBox args={[0.095, 0.38, 0.095]} radius={0.03} position={[0, -0.19, 0]} castShadow>
          <meshStandardMaterial color={shirt} roughness={0.88} metalness={0} />
        </RoundedBox>
        <mesh position={[0, -0.41, 0]}>
          <sphereGeometry args={[0.055, 8, 8]} />
          <meshStandardMaterial color={skin} roughness={0.85} />
        </mesh>
      </group>

      {/* Right arm — pivot at shoulder */}
      <group ref={rightArmRef} position={[0.20, 0.78, 0]} rotation={[-0.55, 0, -0.14]}>
        <RoundedBox args={[0.095, 0.38, 0.095]} radius={0.03} position={[0, -0.19, 0]} castShadow>
          <meshStandardMaterial color={shirt} roughness={0.88} metalness={0} />
        </RoundedBox>
        <mesh position={[0, -0.41, 0]}>
          <sphereGeometry args={[0.055, 8, 8]} />
          <meshStandardMaterial color={skin} roughness={0.85} />
        </mesh>
        {/* Wrench prop */}
        {role === 'wrench' && (
          <group position={[0, -0.52, 0.06]}>
            <mesh>
              <cylinderGeometry args={[0.012, 0.012, 0.22, 8]} />
              <meshStandardMaterial color="#888888" roughness={0.3} metalness={0.8} />
            </mesh>
            <mesh position={[0, 0.13, 0]}>
              <cylinderGeometry args={[0.022, 0.022, 0.06, 8]} />
              <meshStandardMaterial color="#888888" roughness={0.3} metalness={0.8} />
            </mesh>
          </group>
        )}
      </group>

      {/* Carry box — held in front when role=carry */}
      {role === 'carry' && (
        <mesh position={[0, 0.38, 0.22]} castShadow>
          <boxGeometry args={[0.20, 0.14, 0.16]} />
          <meshStandardMaterial color="#7a6040" roughness={0.9} metalness={0} />
        </mesh>
      )}

      {/* Clipboard — held by left hand when role=inspect */}
      {role === 'inspect' && (
        <mesh position={[-0.15, 0.50, 0.18]} rotation={[-0.5, 0, 0.1]} castShadow>
          <boxGeometry args={[0.12, 0.16, 0.012]} />
          <meshStandardMaterial color="#e8e0c0" roughness={0.95} metalness={0} />
        </mesh>
      )}
    </group>
  );
}
