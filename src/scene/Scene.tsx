import { useRef, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBox } from '@react-three/drei';
import { useStore } from '../state/store';
import { Floor } from './Floor';
import { Walls } from './Walls';
import { Ceiling } from './Ceiling';
import { Worker } from './Worker';
import { Machine } from './Machine';
import { AdminStation } from './AdminStation';
import { AlertOrb } from './AlertOrb';
import { DecoWorker } from './DecoWorker';
import { Stairs } from './Stairs';
import { ConveyorBelt } from './ConveyorBelt';
import { WORKER_DEFS, MACHINE_DEFS, WALL_MACHINE_DEFS, DECO_WORKER_DEFS, CAMERA_OVERVIEW, CAMERA_FOCUS } from './sceneDefs';
import { watchFocusData } from './workerFocusRef';

// Shared drag-vs-click state between CameraRig and Scene (same module)
const _dragState = { wasDragging: false };

function Lights() {
  return (
    <>
      <ambientLight intensity={0.55} color="#fff8e0" />
      <hemisphereLight args={['#f6f0e4', '#a89a84', 0.7]} />
      <directionalLight position={[-10, 8, 4]} intensity={1.3} color="#fff0d4" castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.1}
        shadow-camera-far={60}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
      />
      <directionalLight position={[10,  5,  3]}  intensity={0.45} color="#c9d8e8" />
      <directionalLight position={[0,   3, -10]} intensity={0.30} color="#ffb37a" />
      <pointLight position={[-4, 5.2,   0]} intensity={0.5} distance={12} color="#fffbe8" />
      <pointLight position={[ 0, 5.2,   0]} intensity={0.5} distance={12} color="#fffbe8" />
      <pointLight position={[ 4, 5.2,   0]} intensity={0.5} distance={12} color="#fffbe8" />
      <pointLight position={[-4, 5.2, -10]} intensity={0.5} distance={12} color="#fffbe8" />
      <pointLight position={[ 4, 5.2, -10]} intensity={0.5} distance={12} color="#fffbe8" />
    </>
  );
}

function CameraRig() {
  const { gl } = useThree();
  const focusTarget = useStore((s) => s.focusTarget);

  const targetPos   = useRef(new THREE.Vector3(...CAMERA_OVERVIEW.position));
  const targetLook  = useRef(new THREE.Vector3(...CAMERA_OVERVIEW.target));
  const currentLook = useRef(new THREE.Vector3(...CAMERA_OVERVIEW.target));

  // Zoom (scroll wheel, overview only)
  const zoomRef = useRef(1.0);

  // Spherical orbit orientation (drag to rotate, overview only)
  // Initial values match CAMERA_OVERVIEW exactly:
  //   base = [0,4.5,11], target = [0,1.2,-2], dir = [0,3.3,13], len ≈ 13.38
  //   az = atan2(0,1) = 0,  el = asin(3.3/13.38) ≈ 0.249
  const azimuthRef   = useRef(0);
  const elevationRef = useRef(0.249);

  // Always-current focusTarget for use inside event callbacks
  const focusRef = useRef(focusTarget);
  focusRef.current = focusTarget;

  useEffect(() => {
    const canvas = gl.domElement;
    let isDragging = false;
    let dragDist   = 0;
    let lastX      = 0;
    let lastY      = 0;

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      dragDist = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      _dragState.wasDragging = false;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      dragDist += Math.sqrt(dx * dx + dy * dy);
      lastX = e.clientX;
      lastY = e.clientY;

      if (dragDist > 5) _dragState.wasDragging = true;

      // Only rotate in overview mode and once past small threshold
      if (!focusRef.current && dragDist > 3) {
        // Drag right = camera orbits right (shows left scene) → azimuth decreases
        azimuthRef.current   -= dx * 0.005;
        // Drag up (dy < 0) = camera elevates higher → elevation increases
        elevationRef.current  = Math.max(0.05, Math.min(1.2, elevationRef.current - dy * 0.004));
      }
    };

    const onPointerUp = () => { isDragging = false; };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (focusRef.current) return;
      zoomRef.current = Math.max(0.45, Math.min(2.2, zoomRef.current + e.deltaY * 0.0007));
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup',   onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup',   onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [gl]);

  useFrame(({ camera }) => {
    const focus = focusTarget
      ? CAMERA_FOCUS[focusTarget as keyof typeof CAMERA_FOCUS]
      : null;

    const isWorkerFocus = focusTarget ? WORKER_DEFS.some(w => w.id === focusTarget) : false;

    // Tighten near plane for watch closeup so the arm isn't clipped
    const wantNear = isWorkerFocus ? 0.015 : 0.1;
    if (camera.near !== wantNear) {
      camera.near = wantNear;
      camera.updateProjectionMatrix();
    }

    if (isWorkerFocus && watchFocusData.valid) {
      // 0.55 units back along watch normal — far enough to show the whole wrist
      const DIST = 0.55;
      targetPos.current
        .copy(watchFocusData.watchPos)
        .addScaledVector(watchFocusData.watchNormal, DIST);
      targetLook.current.copy(watchFocusData.watchPos);
    } else if (focus) {
      targetPos.current.set(...(focus.position as [number, number, number]));
      targetLook.current.set(...(focus.target as [number, number, number]));
    } else {
      // Build camera position from spherical coordinates around the look target
      const look    = new THREE.Vector3(...CAMERA_OVERVIEW.target);
      const basePos = new THREE.Vector3(...CAMERA_OVERVIEW.position);
      const dist    = basePos.distanceTo(look) * zoomRef.current;

      const az = azimuthRef.current;
      const el = elevationRef.current;
      const dir = new THREE.Vector3(
        Math.sin(az) * Math.cos(el),
        Math.sin(el),
        Math.cos(az) * Math.cos(el),
      );

      targetPos.current.copy(look).addScaledVector(dir, dist);
      targetLook.current.copy(look);
    }

    camera.position.lerp(targetPos.current, 0.055);
    currentLook.current.lerp(targetLook.current, 0.055);
    camera.lookAt(currentLook.current);
  });

  return null;
}

// ─── Wall machine wrapper (non-interactive, decorative) ─────────────────────
function WallMachine({ def }: { def: typeof WALL_MACHINE_DEFS[0] }) {
  return <Machine def={{ ...def, type: def.type }} />;
}

// ─── Industrial props ────────────────────────────────────────────────────────
function FactoryProps() {
  return (
    <group>
      {/* ── Horizontal pipe run along back wall (high) ─────────────────── */}
      <mesh position={[0, 4.8, -13.7]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.055, 0.055, 16, 8]} />
        <meshStandardMaterial color="#6a7888" roughness={0.7} metalness={0.35} />
      </mesh>
      <mesh position={[0, 3.8, -13.7]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.04, 0.04, 14, 8]} />
        <meshStandardMaterial color="#5a6878" roughness={0.7} metalness={0.3} />
      </mesh>

      {/* ── Pipe runs along right wall ──────────────────────────────────── */}
      <mesh position={[7.92, 3.5, -7]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 14, 8]} />
        <meshStandardMaterial color="#6a7888" roughness={0.7} metalness={0.3} />
      </mesh>

      {/* ── Storage barrel cluster (front-left corner) ──────────────────── */}
      {([[-6.0, 0.42, -0.8], [-5.3, 0.42, -0.5], [-5.7, 0.42, -1.5]] as const).map(([x, y, z], i) => (
        <group key={i} position={[x, y, z]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.32, 0.30, 0.84, 14]} />
            <meshStandardMaterial color={i === 0 ? '#3a6080' : i === 1 ? '#806040' : '#406030'} roughness={0.85} metalness={0.1} />
          </mesh>
          {/* Barrel lid */}
          <mesh position={[0, 0.43, 0]}>
            <cylinderGeometry args={[0.33, 0.33, 0.04, 14]} />
            <meshStandardMaterial color="#2a2a2a" roughness={0.9} />
          </mesh>
          {/* Hazard stripe */}
          <mesh position={[0, 0.05, 0]}>
            <cylinderGeometry args={[0.305, 0.305, 0.08, 14]} />
            <meshStandardMaterial color="#f0c020" roughness={0.85} />
          </mesh>
        </group>
      ))}

      {/* ── Tool cabinet (right side, mid-factory) ──────────────────────── */}
      <group position={[7.4, 0, -7.5]}>
        <RoundedBox args={[0.55, 1.9, 0.45]} radius={0.04} position={[0, 0.95, 0]} castShadow>
          <meshStandardMaterial color="#3050a0" roughness={0.88} metalness={0.05} />
        </RoundedBox>
        {/* Drawer handles */}
        {[0.4, 0.8, 1.2, 1.6].map((y, i) => (
          <mesh key={i} position={[-0.28, y, 0.24]}>
            <boxGeometry args={[0.18, 0.03, 0.025]} />
            <meshStandardMaterial color="#c8c8c8" roughness={0.5} metalness={0.6} />
          </mesh>
        ))}
      </group>

      {/* ── Fire extinguisher (front-right) ─────────────────────────────── */}
      <group position={[7.6, 0, -1.5]}>
        <mesh position={[0, 0.55, 0]} castShadow>
          <cylinderGeometry args={[0.1, 0.1, 1.1, 12]} />
          <meshStandardMaterial color="#cc2020" roughness={0.8} metalness={0.15} />
        </mesh>
        <mesh position={[0, 1.15, 0]}>
          <cylinderGeometry args={[0.06, 0.1, 0.15, 12]} />
          <meshStandardMaterial color="#cc2020" roughness={0.8} metalness={0.15} />
        </mesh>
      </group>

      {/* ── Warning floor stripe around reactor area ─────────────────────── */}
      {([-3.0, -3.5, -4.0, -4.5, -5.0, -9.0, -9.5, -10.0, -10.5, -11.0] as const).map((z, i) => (
        <mesh key={i} position={[0, 0.003, z]} receiveShadow>
          <planeGeometry args={[6.5, 0.06]} />
          <meshStandardMaterial
            color={i % 2 === 0 ? '#f0c020' : '#1a1a1a'}
            roughness={0.95}
            side={2}
          />
        </mesh>
      ))}

      {/* ── Ceiling cable trays (overhead, between lights) ───────────────── */}
      <mesh position={[-2.0, 5.7, -7]}>
        <boxGeometry args={[0.3, 0.08, 8]} />
        <meshStandardMaterial color="#3a4a5a" roughness={0.85} metalness={0.3} />
      </mesh>
      <mesh position={[2.0, 5.7, -7]}>
        <boxGeometry args={[0.3, 0.08, 8]} />
        <meshStandardMaterial color="#3a4a5a" roughness={0.85} metalness={0.3} />
      </mesh>
    </group>
  );
}

function SceneContents() {
  return (
    <>
      <Lights />
      <CameraRig />
      <Floor />
      <Walls />
      <Ceiling />
      <Stairs />
      <FactoryProps />
      {/* Conveyor belt with animated packages + overhead scanner */}
      <ConveyorBelt position={[3.0, 0, -2.5]} length={4.2} />
      {/* Second shorter conveyor near back-left area */}
      <ConveyorBelt position={[-2.0, 0, -12.8]} rotationY={Math.PI / 2} length={2.8} />
      <AdminStation />
      {/* Simulation workers (with smartwatches + alert routing) */}
      {WORKER_DEFS.map((def) => (
        <Worker key={def.id} def={def} />
      ))}
      {/* Central simulation machine */}
      {MACHINE_DEFS.map((def) => (
        <Machine key={def.id} def={def} />
      ))}
      {/* Wall machines (decorative — visually match factory but no alert interaction) */}
      {WALL_MACHINE_DEFS.map((def) => (
        <WallMachine key={def.id} def={def} />
      ))}
      {/* Decorative workers around wall machines + on stairs/mezzanine */}
      {DECO_WORKER_DEFS.map((def) => (
        <DecoWorker key={def.id} def={def} />
      ))}
      <AlertOrb />
    </>
  );
}

export function Scene() {
  const setFocus = useStore((s) => s.setFocus);
  return (
    <Canvas
      shadows
      camera={{ position: CAMERA_OVERVIEW.position as [number,number,number], fov: 58, near: 0.1, far: 120 }}
      gl={{ antialias: true, alpha: false }}
      style={{ background: '#c8b498', width: '100%', height: '100%' }}
      onPointerMissed={() => {
        if (!_dragState.wasDragging) setFocus(null);
        _dragState.wasDragging = false;
      }}
    >
      <SceneContents />
    </Canvas>
  );
}
