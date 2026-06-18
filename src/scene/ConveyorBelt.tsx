import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';

interface Props {
  position: [number, number, number];
  rotationY?: number;
  length?: number;
}

// Conveyor belt running along the Z axis by default.
// Packages animate from -length/2 to +length/2 and loop.
export function ConveyorBelt({ position, rotationY = 0, length = 4.2 }: Props) {
  const pkg0 = useRef<THREE.Mesh>(null!);
  const pkg1 = useRef<THREE.Mesh>(null!);
  const pkg2 = useRef<THREE.Mesh>(null!);
  const pkg3 = useRef<THREE.Mesh>(null!);
  const scanRef   = useRef<THREE.Group>(null!);
  const roller0   = useRef<THREE.Mesh>(null!);
  const roller1   = useRef<THREE.Mesh>(null!);

  const H = length / 2;

  useFrame((_) => {
    const t = performance.now() * 0.001;
    const SPEED = 0.55;

    // Packages loop along Z axis
    const pkgs = [pkg0, pkg1, pkg2, pkg3];
    pkgs.forEach((r, i) => {
      if (!r.current) return;
      const z = ((t * SPEED + (i / 4) * length) % length) - H;
      r.current.position.z = z;
    });

    // Scanner head bobs up and down
    if (scanRef.current) {
      scanRef.current.position.y = 1.55 + Math.abs(Math.sin(t * 0.9)) * 0.22;
    }

    // Roller spin
    const spin = t * SPEED * (2 / 0.15); // angular velocity = v/r
    if (roller0.current) roller0.current.rotation.x = spin;
    if (roller1.current) roller1.current.rotation.x = spin;
  });

  const BELT_W  = 0.80;
  const RAIL_W  = 0.07;
  const RAIL_X  = (BELT_W + RAIL_W) / 2;
  const STRIPES = Math.floor(length / 0.42);

  return (
    <group position={position} rotation={[0, rotationY, 0]}>

      {/* ── Legs ────────────────────────────────────────────────────────── */}
      {[-H + 0.35, 0, H - 0.35].map((z, i) => (
        <group key={i} position={[0, 0, z]}>
          {[-RAIL_X, RAIL_X].map((x, j) => (
            <mesh key={j} position={[x, -0.11, 0]} castShadow>
              <cylinderGeometry args={[0.028, 0.028, 0.22, 8]} />
              <meshStandardMaterial color="#5a6a7a" roughness={0.75} metalness={0.4} />
            </mesh>
          ))}
        </group>
      ))}

      {/* ── Side rails ──────────────────────────────────────────────────── */}
      {[-RAIL_X, RAIL_X].map((x, i) => (
        <RoundedBox key={i} args={[RAIL_W, 0.30, length]} radius={0.025}
          position={[x, 0.15, 0]} castShadow>
          <meshStandardMaterial color="#5a6a7a" roughness={0.80} metalness={0.30} />
        </RoundedBox>
      ))}

      {/* ── Belt surface ─────────────────────────────────────────────────── */}
      <mesh position={[0, 0.205, 0]}>
        <boxGeometry args={[BELT_W, 0.025, length]} />
        <meshStandardMaterial color="#2a3540" roughness={0.95} metalness={0.05} />
      </mesh>

      {/* Belt segment lines */}
      {Array.from({ length: STRIPES }, (_, i) => (
        <mesh key={i} position={[0, 0.222, -H + i * 0.42 + 0.21]}>
          <boxGeometry args={[BELT_W - 0.04, 0.004, 0.04]} />
          <meshStandardMaterial color="#4a5a6a" roughness={0.95} />
        </mesh>
      ))}

      {/* ── Drive rollers ────────────────────────────────────────────────── */}
      <mesh ref={roller0} position={[0, 0.15, -H + 0.04]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.15, 0.15, BELT_W + RAIL_W * 2 + 0.02, 14]} />
        <meshStandardMaterial color="#8a9aaa" roughness={0.5} metalness={0.55} />
      </mesh>
      <mesh ref={roller1} position={[0, 0.15,  H - 0.04]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.15, 0.15, BELT_W + RAIL_W * 2 + 0.02, 14]} />
        <meshStandardMaterial color="#8a9aaa" roughness={0.5} metalness={0.55} />
      </mesh>

      {/* ── Moving packages ──────────────────────────────────────────────── */}
      <mesh ref={pkg0} position={[0, 0.33, 0]} castShadow>
        <boxGeometry args={[0.28, 0.24, 0.32]} />
        <meshStandardMaterial color="#c8a050" roughness={0.9} metalness={0} />
      </mesh>
      {/* Package strapping stripe */}
      <mesh ref={pkg1} position={[0, 0.33, 0]} castShadow>
        <boxGeometry args={[0.24, 0.20, 0.30]} />
        <meshStandardMaterial color="#7a5030" roughness={0.9} metalness={0} />
      </mesh>
      <mesh ref={pkg2} position={[0, 0.30, 0]} castShadow>
        <boxGeometry args={[0.32, 0.18, 0.26]} />
        <meshStandardMaterial color="#4a6858" roughness={0.9} metalness={0} />
      </mesh>
      <mesh ref={pkg3} position={[0, 0.32, 0]} castShadow>
        <boxGeometry args={[0.22, 0.22, 0.28]} />
        <meshStandardMaterial color="#9a8050" roughness={0.9} metalness={0} />
      </mesh>

      {/* ── Overhead scanner arch ────────────────────────────────────────── */}
      {[-RAIL_X - 0.14, RAIL_X + 0.14].map((x, i) => (
        <mesh key={i} position={[x, 0.88, 0]} castShadow>
          <cylinderGeometry args={[0.028, 0.028, 1.76, 8]} />
          <meshStandardMaterial color="#4a5a6a" roughness={0.7} metalness={0.45} />
        </mesh>
      ))}
      <mesh position={[0, 1.77, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.025, 0.025, BELT_W + 0.38, 8]} />
        <meshStandardMaterial color="#4a5a6a" roughness={0.7} metalness={0.45} />
      </mesh>

      {/* Scanner head (bobs on useFrame) */}
      <group ref={scanRef} position={[0, 1.55, 0]}>
        <RoundedBox args={[0.32, 0.11, 0.18]} radius={0.03} castShadow>
          <meshStandardMaterial color="#1e2c3a" roughness={0.65} metalness={0.25} />
        </RoundedBox>
        {/* Blue scan line */}
        <mesh position={[0, -0.062, 0]}>
          <boxGeometry args={[0.24, 0.012, 0.10]} />
          <meshStandardMaterial color="#38a8ff" emissive="#38a8ff" emissiveIntensity={2.0}
            roughness={0.1} toneMapped={false} />
        </mesh>
        <pointLight position={[0, -0.08, 0]} intensity={0.4} distance={1.5} color="#3890ff" />
      </group>

      {/* ── Control panel at one end ─────────────────────────────────────── */}
      <group position={[RAIL_X + 0.28, 0.6, H - 0.3]}>
        <RoundedBox args={[0.22, 0.42, 0.12]} radius={0.03} castShadow>
          <meshStandardMaterial color="#2a3848" roughness={0.85} metalness={0.1} />
        </RoundedBox>
        {[0.10, -0.02, -0.14].map((y, i) => (
          <mesh key={i} position={[-0.02, y, 0.065]}>
            <cylinderGeometry args={[0.025, 0.025, 0.04, 10]} />
            <meshStandardMaterial
              color={i === 0 ? '#22c55e' : i === 1 ? '#f59e0b' : '#ef4444'}
              emissive={i === 0 ? '#22c55e' : i === 1 ? '#f59e0b' : '#ef4444'}
              emissiveIntensity={0.6} roughness={0.3} />
          </mesh>
        ))}
        {/* Running indicator LED */}
        <mesh position={[0.06, 0.16, 0.065]}>
          <sphereGeometry args={[0.018, 8, 8]} />
          <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={1.5} roughness={0.3} />
        </mesh>
      </group>

    </group>
  );
}
