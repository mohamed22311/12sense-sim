import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox, Text } from '@react-three/drei';
import * as THREE from 'three';
import { C } from '../styles/palette';
import { useStore } from '../state/store';
import type { MachineDef } from './sceneDefs';

interface Props { def: MachineDef }

const BUTTON_COLORS = ['#3d7090', '#5a4a7a', '#3d7060', '#7a6a3d', '#7a3d3d', '#3d6a7a', '#6a7a3d', '#7a3d6a', '#4a4a7a'];

export function Machine({ def }: Props) {
  const groupRef    = useRef<THREE.Group>(null!);
  const ledRef      = useRef<THREE.Mesh>(null!);
  const ledMatRef   = useRef<THREE.MeshStandardMaterial>(null!);
  const needleRef   = useRef<THREE.Mesh>(null!);
  const mistRefs    = [useRef<THREE.Mesh>(null!), useRef<THREE.Mesh>(null!), useRef<THREE.Mesh>(null!)];
  const mistTimers  = useRef([0, 1.2, 2.4]);

  // Fire particle refs (3 fixed — no hooks in loops)
  const fireRef0    = useRef<THREE.Mesh>(null!);
  const fireRef1    = useRef<THREE.Mesh>(null!);
  const fireRef2    = useRef<THREE.Mesh>(null!);
  const fireMat0    = useRef<THREE.MeshStandardMaterial>(null!);
  const fireMat1    = useRef<THREE.MeshStandardMaterial>(null!);
  const fireMat2    = useRef<THREE.MeshStandardMaterial>(null!);
  const fireTimers  = useRef([0, 0.4, 0.8]);

  // Electrical spark refs
  const sparkRef0   = useRef<THREE.Mesh>(null!);
  const sparkRef1   = useRef<THREE.Mesh>(null!);
  const sparkRef2   = useRef<THREE.Mesh>(null!);

  const setFocus    = useStore((s) => s.setFocus);
  const phase       = useStore((s) => s.scenarioPhase);
  const activeAsset = useStore((s) => s.activeAlertAsset);
  const alertType   = useStore((s) => s.machineAlertTypes[def.id] ?? 'pressure');

  const isActive  = activeAsset === def.id;
  const isFailing = isActive && (
    phase === 'machine_fail' || phase === 'context_scan' ||
    phase === 'routing'      || phase === 'delivery'     || phase === 'alerting'
  );

  useFrame((_, delta) => {
    if (!ledMatRef.current) return;
    const t = performance.now() * 0.001;

    // LED
    if (isFailing) {
      ledMatRef.current.color.set(C.ledRed);
      ledMatRef.current.emissive.set(C.ledRed);
      ledMatRef.current.emissiveIntensity = Math.floor(t * 4) % 2 === 0 ? 3.0 : 0.2;
    } else {
      ledMatRef.current.color.set(C.ledGreen);
      ledMatRef.current.emissive.set(C.ledGreen);
      ledMatRef.current.emissiveIntensity = 0.8 + Math.sin(t * 1.5) * 0.2;
    }

    // Machine shake
    if (isFailing && groupRef.current) {
      groupRef.current.position.x = def.position[0] + Math.sin(t * 60) * 0.006;
      groupRef.current.position.z = def.position[2] + Math.sin(t * 50 + 1) * 0.004;
    } else if (groupRef.current) {
      groupRef.current.position.x = THREE.MathUtils.lerp(groupRef.current.position.x, def.position[0], 0.2);
      groupRef.current.position.z = THREE.MathUtils.lerp(groupRef.current.position.z, def.position[2], 0.2);
      groupRef.current.position.y = Math.sin(t * 8) * 0.001;
    }

    // Gauge needle
    if (needleRef.current) {
      needleRef.current.rotation.z = isFailing
        ? needleRef.current.rotation.z + delta * 4
        : Math.sin(t * 0.5) * 0.3 - 0.1;
    }

    // Mist puffs (chiller only)
    if (def.type === 'chiller') {
      mistTimers.current = mistTimers.current.map((mt, i) => {
        const next = mt + delta;
        const cycle = next % 3.6;
        const prog = cycle / 1.8;
        const mesh = mistRefs[i].current;
        if (!mesh) return next;
        if (prog < 1) {
          const s = prog * 0.4;
          mesh.scale.setScalar(s);
          mesh.position.y = def.position[1] + 3.1 + prog * 0.3;
          (mesh.material as THREE.MeshStandardMaterial).opacity = (1 - prog) * 0.06;
          mesh.visible = true;
        } else {
          mesh.visible = false;
        }
        return next;
      });
    }

    // ─── Fire particles ───────────────────────────────────────────────
    if (isFailing && alertType === 'fire') {
      const frefs = [fireRef0.current, fireRef1.current, fireRef2.current];
      const fmats = [fireMat0.current, fireMat1.current, fireMat2.current];
      fireTimers.current = fireTimers.current.map((ft, i) => {
        const next = ft + delta;
        const prog = (next % 1.2) / 1.2;
        const mesh = frefs[i];
        const mat  = fmats[i];
        if (!mesh || !mat) return next;
        mesh.scale.setScalar(0.35 + prog * 0.65);
        mesh.position.y = 2.6 + prog * 1.4;
        // stay orange throughout — don't fade toward yellow so it blends with bright windows
        mat.color.setRGB(1.0, 0.3 + prog * 0.2, 0);
        mat.emissive.setRGB(0.9, 0.15 + prog * 0.1, 0);
        mat.emissiveIntensity = 1.5 + (1 - prog) * 1.5;
        mat.opacity = Math.max(0.72, (1 - prog) * 0.95);
        mesh.visible = true;
        return next;
      });
    } else {
      if (fireRef0.current) fireRef0.current.visible = false;
      if (fireRef1.current) fireRef1.current.visible = false;
      if (fireRef2.current) fireRef2.current.visible = false;
    }

    // ─── Electrical sparks ────────────────────────────────────────────
    if (isFailing && alertType === 'electrical') {
      const tv = Math.floor(t * 18) % 6;
      if (sparkRef0.current) sparkRef0.current.visible = tv === 0 || tv === 3;
      if (sparkRef1.current) sparkRef1.current.visible = tv === 1 || tv === 5;
      if (sparkRef2.current) sparkRef2.current.visible = tv === 2 || tv === 4;
    } else {
      if (sparkRef0.current) sparkRef0.current.visible = false;
      if (sparkRef1.current) sparkRef1.current.visible = false;
      if (sparkRef2.current) sparkRef2.current.visible = false;
    }
  });

  // Shared fire + spark effects rendered inside both machine types
  const alertEffects = (
    <>
      {/* Fire particles */}
      <mesh ref={fireRef0} position={[-0.12, 2.6, 0]}>
        <sphereGeometry args={[0.48, 12, 12]} />
        <meshStandardMaterial ref={fireMat0} color="#ff6600" emissive="#ff4400"
          emissiveIntensity={2.5} transparent opacity={0.01} roughness={1} depthWrite={false} />
      </mesh>
      <mesh ref={fireRef1} position={[0.18, 2.6, 0.1]}>
        <sphereGeometry args={[0.38, 12, 12]} />
        <meshStandardMaterial ref={fireMat1} color="#ff8800" emissive="#ff6600"
          emissiveIntensity={2.5} transparent opacity={0.01} roughness={1} depthWrite={false} />
      </mesh>
      <mesh ref={fireRef2} position={[0, 2.6, -0.12]}>
        <sphereGeometry args={[0.32, 12, 12]} />
        <meshStandardMaterial ref={fireMat2} color="#ffdd00" emissive="#ffaa00"
          emissiveIntensity={3.0} transparent opacity={0.01} roughness={1} depthWrite={false} />
      </mesh>

      {/* Electrical sparks — on camera-facing side (z=+0.3) */}
      <mesh ref={sparkRef0} position={[0.22, 1.65, 0.32]}>
        <sphereGeometry args={[0.14, 8, 8]} />
        <meshStandardMaterial color="#aaddff" emissive="#88ccff" emissiveIntensity={4} roughness={0} />
      </mesh>
      <mesh ref={sparkRef1} position={[-0.18, 1.95, 0.32]}>
        <sphereGeometry args={[0.10, 8, 8]} />
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={5} roughness={0} />
      </mesh>
      <mesh ref={sparkRef2} position={[0.06, 2.25, 0.32]}>
        <sphereGeometry args={[0.16, 8, 8]} />
        <meshStandardMaterial color="#ccaaff" emissive="#bbaaff" emissiveIntensity={3} roughness={0} />
      </mesh>

      {/* Alert point lights — only rendered when active */}
      {isFailing && alertType === 'fire' && (
        <>
          <pointLight position={[0, 3.2, 0]} intensity={3.5} distance={6} color="#ff6600" />
          <pointLight position={[0, 2.8, 0]} intensity={1.8} distance={4} color="#ffaa00" />
        </>
      )}
      {isFailing && alertType === 'electrical' && (
        <pointLight position={[0, 2.0, 0.5]} intensity={4} distance={5} color="#88aaff" />
      )}
    </>
  );

  // ─── Reactor type ───────────────────────────────────────────────────────────
  if (def.type === 'reactor') {
    return (
      <group ref={groupRef} position={def.position} rotation={[0, def.rotation ?? 0, 0]}
        onClick={(e) => { e.stopPropagation(); setFocus(def.id); }}>

        {/* Foundation plinth */}
        <RoundedBox args={[3.2, 0.22, 3.2]} radius={0.06} position={[0, 0.11, 0]} receiveShadow>
          <meshStandardMaterial color="#5a6070" roughness={0.85} metalness={0.1} />
        </RoundedBox>

        {/* Hazard stripes on plinth edge */}
        {[0, 1, 2, 3].map((i) => {
          const angle = (i / 4) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.sin(angle) * 1.5, 0.23, Math.cos(angle) * 1.5]}>
              <boxGeometry args={[0.22, 0.04, 1.4]} />
              <meshStandardMaterial color={i % 2 === 0 ? '#f0c020' : '#1a1a1a'} roughness={0.8} />
            </mesh>
          );
        })}

        {/* Main cylindrical vessel */}
        <mesh position={[0, 2.2, 0]} castShadow>
          <cylinderGeometry args={[0.85, 0.95, 4.0, 16]} />
          <meshStandardMaterial color="#4a5868" roughness={0.78} metalness={0.18} />
        </mesh>

        {/* Dome top */}
        <mesh position={[0, 4.25, 0]} castShadow>
          <sphereGeometry args={[0.86, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#3a4858" roughness={0.75} metalness={0.2} />
        </mesh>

        {/* Reinforcement rings */}
        {[0.8, 1.6, 2.4, 3.2].map((y, i) => (
          <mesh key={i} position={[0, y, 0]}>
            <torusGeometry args={[0.92, 0.04, 8, 32]} />
            <meshStandardMaterial color="#6a7888" roughness={0.7} metalness={0.3} />
          </mesh>
        ))}

        {/* Exhaust pipes on top */}
        {([-0.35, 0.35] as const).map((x, i) => (
          <group key={i}>
            <mesh position={[x, 5.1, 0]} castShadow>
              <cylinderGeometry args={[0.09, 0.09, 1.8, 10]} />
              <meshStandardMaterial color="#3a4858" roughness={0.7} metalness={0.3} />
            </mesh>
            <mesh position={[x, 6.1, 0]}>
              <cylinderGeometry args={[0.13, 0.09, 0.25, 10]} />
              <meshStandardMaterial color="#3a4858" roughness={0.7} metalness={0.3} />
            </mesh>
          </group>
        ))}

        {/* Horizontal pipe to left and right */}
        <mesh position={[-1.8, 1.4, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.065, 0.065, 1.8, 10]} />
          <meshStandardMaterial color="#456070" roughness={0.7} metalness={0.3} />
        </mesh>
        <mesh position={[1.8, 1.4, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.065, 0.065, 1.8, 10]} />
          <meshStandardMaterial color="#456070" roughness={0.7} metalness={0.3} />
        </mesh>

        {/* Front control panel (faces +Z = toward overview camera) */}
        <group position={[0, 1.1, 0.97]}>
          <RoundedBox args={[1.6, 1.6, 0.12]} radius={0.05} castShadow>
            <meshStandardMaterial color="#2a3848" roughness={0.85} metalness={0.1} />
          </RoundedBox>
          {/* Panel display */}
          <mesh position={[0, 0.35, 0.065]}>
            <planeGeometry args={[1.1, 0.55]} />
            <meshStandardMaterial color="#0d1821" emissive="#4e80cc" emissiveIntensity={isFailing ? 0.8 : 0.4} roughness={0.3} side={2} />
          </mesh>
          {/* Button rows */}
          {Array.from({ length: 8 }, (_, i) => {
            const col = i % 4; const row = Math.floor(i / 4);
            return (
              <RoundedBox key={i} args={[0.09, 0.07, 0.05]} radius={0.02}
                position={[-0.22 + col * 0.155, -0.12 + row * 0.16, 0.065]}>
                <meshStandardMaterial color={BUTTON_COLORS[i]} roughness={0.7}
                  emissive={BUTTON_COLORS[i]} emissiveIntensity={0.25} />
              </RoundedBox>
            );
          })}
          {/* Pressure gauge cluster */}
          {([-0.48, 0.48] as const).map((x, gi) => (
            <group key={gi} position={[x, -0.28, 0.065]}>
              <mesh>
                <torusGeometry args={[0.1, 0.015, 8, 20]} />
                <meshStandardMaterial color="#3a5060" roughness={0.6} metalness={0.4} />
              </mesh>
              <mesh ref={gi === 0 ? needleRef : undefined} rotation={[0, 0, gi === 0 ? -0.1 : 0.4]}>
                <boxGeometry args={[0.085, 0.012, 0.01]} />
                <meshStandardMaterial color="#ef4444" roughness={0.5} />
              </mesh>
            </group>
          ))}
        </group>

        {/* Side control panel (left) */}
        <group position={[-0.97, 1.4, 0]} rotation={[0, Math.PI / 2, 0]}>
          <RoundedBox args={[1.0, 1.2, 0.10]} radius={0.04} castShadow>
            <meshStandardMaterial color="#2a3848" roughness={0.85} metalness={0.1} />
          </RoundedBox>
          {Array.from({ length: 4 }, (_, i) => (
            <RoundedBox key={i} args={[0.07, 0.06, 0.05]} radius={0.02}
              position={[-0.18 + (i % 2) * 0.36, 0.2 - Math.floor(i / 2) * 0.2, 0.055]}>
              <meshStandardMaterial color={BUTTON_COLORS[i + 4]} roughness={0.7}
                emissive={BUTTON_COLORS[i + 4]} emissiveIntensity={0.2} />
            </RoundedBox>
          ))}
        </group>

        {/* Status LEDs around vessel */}
        {[0, 1, 2].map((i) => {
          const angle = (i / 3) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.sin(angle) * 0.88, 2.8, Math.cos(angle) * 0.88]}>
              <sphereGeometry args={[0.07, 10, 10]} />
              <meshStandardMaterial
                ref={i === 0 ? ledMatRef : undefined}
                color={i === 0 ? (isFailing ? C.ledRed : C.ledGreen) : C.ledGreen}
                emissive={i === 0 ? (isFailing ? C.ledRed : C.ledGreen) : '#20c060'}
                emissiveIntensity={i === 0 ? undefined : 0.7}
                roughness={0.3}
              />
            </mesh>
          );
        })}

        {/* Warning light on top dome */}
        <mesh position={[0, 4.7, 0]}>
          <sphereGeometry args={[0.12, 10, 10]} />
          <meshStandardMaterial
            color={isFailing ? '#ef4444' : '#f59e0b'}
            emissive={isFailing ? '#ef4444' : '#f59e0b'}
            emissiveIntensity={isFailing ? 3.0 : 0.6}
            roughness={0.3}
          />
        </mesh>
        {isFailing && <pointLight position={[0, 4.8, 0]} intensity={2.5} distance={8} color="#ff4444" />}

        {/* Machine label on plinth */}
        <Text position={[0, 0.24, 1.62]} fontSize={0.11} color="#c0d0e0" anchorX="center" anchorY="middle">
          {def.label}
        </Text>

        {alertEffects}
      </group>
    );
  }

  if (def.type === 'chiller') {
    return (
      <group ref={groupRef} position={def.position} rotation={[0, def.rotation ?? 0, 0]}
        onClick={(e) => { e.stopPropagation(); setFocus(def.id); }}>
        {/* Main body */}
        <RoundedBox args={[1.4, 2.2, 0.9]} radius={0.08} position={[0, 1.1, 0]} castShadow>
          <meshStandardMaterial color={C.machineBody} roughness={0.88} metalness={0.05} />
        </RoundedBox>

        {/* Top cooling unit */}
        <RoundedBox args={[1.2, 0.5, 0.8]} radius={0.06} position={[0, 2.55, 0]} castShadow>
          <meshStandardMaterial color={C.machineTrim} roughness={0.85} metalness={0.08} />
        </RoundedBox>

        {/* Cooling fins */}
        {Array.from({ length: 5 }, (_, i) => (
          <mesh key={i} position={[0, 2.18 + i * 0.07, 0]} castShadow>
            <boxGeometry args={[1.32, 0.045, 0.88]} />
            <meshStandardMaterial color={C.machineTrim} roughness={0.8} metalness={0.1} />
          </mesh>
        ))}

        {/* Pipes */}
        {[-0.3, 0.3].map((x, i) => (
          <mesh key={i} position={[x, 2.95, 0]} castShadow>
            <cylinderGeometry args={[0.07, 0.07, 0.5, 10]} />
            <meshStandardMaterial color="#456070" roughness={0.7} metalness={0.3} />
          </mesh>
        ))}

        {/* Mist puffs */}
        {mistRefs.map((ref, i) => (
          <mesh key={i} ref={ref} position={[i === 0 ? -0.3 : 0.3, 3.1, 0]}>
            <sphereGeometry args={[0.15, 8, 8]} />
            <meshStandardMaterial color="#a8c8d8" transparent opacity={0.05} roughness={1} depthWrite={false} />
          </mesh>
        ))}

        {/* Pressure gauge — on camera-facing side */}
        <mesh position={[0, 1.3, 0.46]}>
          <torusGeometry args={[0.12, 0.018, 8, 24]} />
          <meshStandardMaterial color="#3a5060" roughness={0.6} metalness={0.4} />
        </mesh>
        <mesh ref={needleRef} position={[0, 1.3, 0.475]} rotation={[0, 0, -0.1]}>
          <boxGeometry args={[0.10, 0.014, 0.01]} />
          <meshStandardMaterial color="#ef4444" roughness={0.5} metalness={0.2} />
        </mesh>

        {/* Control panel */}
        <RoundedBox args={[0.5, 0.35, 0.05]} radius={0.03} position={[0, 0.7, 0.48]} castShadow
          onClick={(e) => { e.stopPropagation(); setFocus(def.id); }}>
          <meshStandardMaterial color={C.machinePanel} roughness={0.9} />
        </RoundedBox>

        {/* Status LED */}
        <mesh ref={ledRef} position={[0, 2.4, 0.46]}>
          <sphereGeometry args={[0.08, 12, 12]} />
          <meshStandardMaterial ref={ledMatRef}
            color={C.ledGreen} emissive={C.ledGreen}
            emissiveIntensity={0.8} roughness={0.3} />
        </mesh>

        <Text position={[0, 0.18, 0.465]} fontSize={0.085} color="#a0c0d0" anchorX="center" anchorY="middle">
          {def.label}
        </Text>

        {alertEffects}
      </group>
    );
  }

  // PANEL type — electrical cabinet
  return (
    <group ref={groupRef} position={def.position} rotation={[0, def.rotation ?? 0, 0]}
      onClick={(e) => { e.stopPropagation(); setFocus(def.id); }}>
      {/* Main cabinet body */}
      <RoundedBox args={[0.9, 2.4, 0.5]} radius={0.06} position={[0, 1.2, 0]} castShadow>
        <meshStandardMaterial color={C.machineBody} roughness={0.88} metalness={0.05} />
      </RoundedBox>

      {/* Top bar */}
      <RoundedBox args={[0.9, 0.12, 0.5]} radius={0.04} position={[0, 2.46, 0]} castShadow>
        <meshStandardMaterial color={C.machineTrim} roughness={0.85} metalness={0.08} />
      </RoundedBox>

      {/* Button grid 3×3 — camera-facing side */}
      {Array.from({ length: 9 }, (_, i) => {
        const col = i % 3, row = Math.floor(i / 3);
        return (
          <RoundedBox key={i}
            args={[0.08, 0.06, 0.04]} radius={0.02}
            position={[-0.18 + col * 0.18, 1.5 + row * 0.14, 0.26]}
            castShadow>
            <meshStandardMaterial
              color={BUTTON_COLORS[i]}
              roughness={0.7}
              emissive={BUTTON_COLORS[i]}
              emissiveIntensity={0.2}
            />
          </RoundedBox>
        );
      })}

      {/* Display screen */}
      <mesh position={[0, 1.85, 0.256]}>
        <planeGeometry args={[0.5, 0.28]} />
        <meshStandardMaterial color="#0d1821" emissive="#4e80cc" emissiveIntensity={0.4} roughness={0.4} side={2} />
      </mesh>

      {/* Status LED */}
      <mesh ref={ledRef} position={[0, 2.38, 0.26]}>
        <sphereGeometry args={[0.065, 12, 12]} />
        <meshStandardMaterial ref={ledMatRef}
          color={C.ledGreen} emissive={C.ledGreen}
          emissiveIntensity={0.8} roughness={0.3} />
      </mesh>

      {/* Warning stripes at base */}
      {[0, 1].map((i) => (
        <mesh key={i} position={[0, 0.06, 0.26 + i * 0.01]} rotation={[0, 0, Math.PI / 4]}>
          <planeGeometry args={[0.9, 0.12]} />
          <meshStandardMaterial color={i === 0 ? '#f59e0b' : '#1f2937'} roughness={0.9} side={2} />
        </mesh>
      ))}

      <Text position={[0, 0.18, 0.26]} fontSize={0.075} color="#a0c0d0" anchorX="center" anchorY="middle">
        {def.label}
      </Text>

      {alertEffects}
    </group>
  );
}
