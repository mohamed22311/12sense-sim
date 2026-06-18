import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { C } from '../styles/palette';
import { useStore } from '../state/store';
import { WORKER_DEFS, MACHINE_DEFS } from './sceneDefs';

interface OrbState {
  active: boolean;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  color: string;
  progress: number;
  workerId: string;
}

const PULSE_RING_DURATION = 1.2;
const MAX_ALERTED_WORKERS = 2; // only closest workers get the alert

export function AlertOrb() {
  const orbsRef        = useRef<OrbState[]>([]);
  const alertedCountRef= useRef(0);
  // Support up to 5 workers, no hooks in loops
  const mesh0 = useRef<THREE.Mesh>(null!);
  const mesh1 = useRef<THREE.Mesh>(null!);
  const mesh2 = useRef<THREE.Mesh>(null!);
  const mesh3 = useRef<THREE.Mesh>(null!);
  const mesh4 = useRef<THREE.Mesh>(null!);
  const meshRefs = [mesh0, mesh1, mesh2, mesh3, mesh4];

  const ringRef       = useRef<THREE.Mesh>(null!);
  const ringMatRef    = useRef<THREE.MeshStandardMaterial>(null!);
  const routingRef    = useRef<THREE.Mesh>(null!);
  const routingMatRef = useRef<THREE.MeshStandardMaterial>(null!);

  const phase        = useStore((s) => s.scenarioPhase);
  const activeAsset  = useStore((s) => s.activeAlertAsset);
  const workers      = useStore((s) => s.workers);
  const setWorkerEff = useStore((s) => s.setWorkerEffect);
  const setPhase     = useStore((s) => s.setPhase);

  const phaseRef    = useRef(phase);
  const phaseStartT = useRef(0);
  const prevPhase   = useRef('idle');
  const deliveredTo = useRef<Set<string>>(new Set());

  phaseRef.current = phase;

  function orbColor(workerId: string): string {
    const w = workers.find((w) => w.id === workerId);
    if (!w) return C.visual;
    const p = w.routing.primary;
    return p === 'haptic' ? C.haptic : p === 'audio' ? C.audio : C.visual;
  }

  function machinePos(): THREE.Vector3 {
    const m = MACHINE_DEFS.find((m) => m.id === activeAsset);
    if (!m) return new THREE.Vector3(0, 1, -5);
    return new THREE.Vector3(m.position[0], 1.5, m.position[2]);
  }

  useFrame((_, delta) => {
    const t = performance.now() * 0.001;
    const currentPhase = phaseRef.current;

    if (currentPhase !== prevPhase.current) {
      phaseStartT.current = t;

      if (currentPhase === 'machine_fail') {
        deliveredTo.current.clear();
        orbsRef.current = [];
      }

      if (currentPhase === 'delivery') {
        const mPos = machinePos();
        const mVec = new THREE.Vector2(mPos.x, mPos.z);

        // Find closest workers by distance from machine (static WORKER_DEFS positions)
        const sorted = WORKER_DEFS
          .map((def) => ({
            def,
            dist: mVec.distanceTo(new THREE.Vector2(def.position[0], def.position[2])),
          }))
          .sort((a, b) => a.dist - b.dist)
          .slice(0, MAX_ALERTED_WORKERS)
          .map((x) => x.def);

        alertedCountRef.current = sorted.length;

        orbsRef.current = sorted.map((wDef) => ({
          active: true,
          pos: mPos.clone(),
          target: new THREE.Vector3(wDef.position[0], 1.2, wDef.position[2]),
          color: orbColor(wDef.id),
          progress: 0,
          workerId: wDef.id,
        }));
      }

      if (currentPhase === 'idle' || currentPhase === 'acknowledged') {
        orbsRef.current = orbsRef.current.map((o) => ({ ...o, active: false }));
      }

      prevPhase.current = currentPhase;
    }

    const elapsed = t - phaseStartT.current;

    // ─── Pulse ring ───────────────────────────────────────────────────
    if (ringRef.current && ringMatRef.current) {
      if (currentPhase === 'machine_fail') {
        const prog = Math.min(elapsed / PULSE_RING_DURATION, 1);
        const mPos = machinePos();
        ringRef.current.position.copy(mPos);
        ringRef.current.position.y = 0.1;
        ringRef.current.scale.setScalar(prog * 6);
        ringMatRef.current.opacity = 1 - prog;
        ringRef.current.visible = true;
      } else {
        ringRef.current.visible = false;
      }
    }

    // ─── Routing node ─────────────────────────────────────────────────
    if (routingRef.current && routingMatRef.current) {
      if (currentPhase === 'routing') {
        const pulse = Math.sin(elapsed * 10) * 2 + 2.5;
        routingMatRef.current.emissiveIntensity = Math.max(0, pulse);
        routingRef.current.visible = true;
        routingRef.current.rotation.x += delta * 1.2;
        routingRef.current.rotation.y += delta * 0.8;
      } else {
        routingRef.current.visible = false;
      }
    }

    // ─── Orb travel ───────────────────────────────────────────────────
    orbsRef.current.forEach((orb, i) => {
      const mesh = meshRefs[i]?.current;
      if (!mesh) return;

      if (!orb.active) {
        mesh.visible = false;
        return;
      }

      orb.progress = Math.min(orb.progress + delta * 1.2, 1);
      orb.pos.lerp(orb.target, orb.progress * 0.08);
      mesh.position.copy(orb.pos);
      mesh.visible = true;

      const sc = 0.12 + Math.sin(t * 8) * 0.02;
      mesh.scale.setScalar(sc);

      (mesh.material as THREE.MeshStandardMaterial).color.set(orb.color);
      (mesh.material as THREE.MeshStandardMaterial).emissive.set(orb.color);

      const dist = orb.pos.distanceTo(orb.target);
      if (dist < 0.25 && !deliveredTo.current.has(orb.workerId)) {
        deliveredTo.current.add(orb.workerId);
        orb.active = false;
        mesh.visible = false;

        const worker = workers.find((w) => w.id === orb.workerId);
        if (!worker) return;

        const { primary } = worker.routing;
        const isDanger = worker.sensors.stress_index > 70 || worker.sensors.spo2 < 95 || worker.sensors.battery < 15;

        setWorkerEff(orb.workerId, {
          vibrating:  primary === 'haptic' || worker.routing.channels.includes('haptic'),
          flashing:   worker.routing.channels.includes('visual'),
          audioWaves: worker.routing.channels.includes('audio'),
          ringColor:  isDanger ? C.ringDanger : C.ringAlert,
          ringPulse:  true,
          dangerFlag: true, // always show alert on watch for every delivered worker
        });

        if (deliveredTo.current.size >= alertedCountRef.current) {
          setTimeout(() => setPhase('alerting'), 200);
        }
      }
    });
  });

  return (
    <group>
      {/* Pulse ring — flat circle expanding from machine */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.9, 1.0, 40]} />
        <meshStandardMaterial
          ref={ringMatRef}
          color={C.critical}
          emissive={C.critical}
          emissiveIntensity={2.0}
          transparent
          opacity={1}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Alert orbs — up to 5 */}
      <mesh ref={mesh0} visible={false}>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshStandardMaterial color={C.haptic} emissive={C.haptic} emissiveIntensity={2.5} roughness={0.3} transparent opacity={0.9} />
      </mesh>
      <mesh ref={mesh1} visible={false}>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshStandardMaterial color={C.haptic} emissive={C.haptic} emissiveIntensity={2.5} roughness={0.3} transparent opacity={0.9} />
      </mesh>
      <mesh ref={mesh2} visible={false}>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshStandardMaterial color={C.haptic} emissive={C.haptic} emissiveIntensity={2.5} roughness={0.3} transparent opacity={0.9} />
      </mesh>
      <mesh ref={mesh3} visible={false}>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshStandardMaterial color={C.haptic} emissive={C.haptic} emissiveIntensity={2.5} roughness={0.3} transparent opacity={0.9} />
      </mesh>
      <mesh ref={mesh4} visible={false}>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshStandardMaterial color={C.haptic} emissive={C.haptic} emissiveIntensity={2.5} roughness={0.3} transparent opacity={0.9} />
      </mesh>

      {/* Routing node — octahedron hovering above scene */}
      <mesh ref={routingRef} position={[0, 4, -2]} visible={false}>
        <octahedronGeometry args={[0.18, 0]} />
        <meshStandardMaterial
          ref={routingMatRef}
          color="#a090e0"
          emissive="#7c62c8"
          emissiveIntensity={2.5}
          roughness={0.3}
          transparent
          opacity={0.85}
        />
      </mesh>
    </group>
  );
}
