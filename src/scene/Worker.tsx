import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox, Text } from '@react-three/drei';
import * as THREE from 'three';
import { C } from '../styles/palette';
import { useStore } from '../state/store';
import type { WorkerDef } from './sceneDefs';
import { watchFocusData } from './workerFocusRef';

interface Props { def: WorkerDef }

// ─── Watch face canvas rendering ─────────────────────────────────────────────
const W = 256, H = 192;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawWatchFace(
  ctx: CanvasRenderingContext2D,
  dangerFlag: boolean,
  acked: boolean,
  info?: { type: string; asset: string; severity: string },
) {
  ctx.clearRect(0, 0, W, H);

  if (!dangerFlag) {
    // ── Normal: deep space clock ──────────────────────────────────────
    // Outer bezel
    roundRect(ctx, 0, 0, W, H, 22);
    ctx.fillStyle = '#0b0f1a';
    ctx.fill();

    // Screen glow ring
    roundRect(ctx, 4, 4, W - 8, H - 8, 18);
    ctx.strokeStyle = '#1e3a6e';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Logo chip top-left
    ctx.fillStyle = '#1a3a6e';
    roundRect(ctx, 12, 12, 46, 20, 4);
    ctx.fill();
    ctx.fillStyle = '#5090e0';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('12S', 16, 27);

    // Status dot top-right
    ctx.fillStyle = '#22c55e';
    ctx.shadowColor = '#22c55e';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(W - 20, 22, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Time — large and bright
    const now = new Date();
    const hh  = String(now.getHours()).padStart(2, '0');
    const mm  = String(now.getMinutes()).padStart(2, '0');
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#6ab0ff';
    ctx.shadowBlur = 12;
    ctx.font = 'bold 72px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${hh}:${mm}`, W / 2, 116);
    ctx.shadowBlur = 0;

    // Date chip
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    roundRect(ctx, W / 2 - 60, 128, 120, 22, 6);
    ctx.fill();
    ctx.fillStyle = '#8ab0d0';
    ctx.font = '13px monospace';
    ctx.fillText(dateStr, W / 2, 143);

    // Bottom bar
    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('● ONLINE', W / 2, H - 14);

  } else if (!acked) {
    // ── Active alert: urgent red ──────────────────────────────────────
    roundRect(ctx, 0, 0, W, H, 22);
    ctx.fillStyle = '#1a0404';
    ctx.fill();

    // Pulsing red border
    roundRect(ctx, 3, 3, W - 6, H - 6, 19);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Alert header stripe
    ctx.fillStyle = '#ef4444';
    roundRect(ctx, 10, 10, W - 20, 36, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#ff8888';
    ctx.shadowBlur = 6;
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('⚠  ALERT', W / 2, 34);
    ctx.shadowBlur = 0;

    // Asset ID
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 22px monospace';
    ctx.fillText(info?.asset ?? '', W / 2, 76);

    // Severity badge
    const sevColor = (info?.severity ?? '') === 'critical' ? '#ff3333' : '#f97316';
    ctx.fillStyle = sevColor;
    ctx.shadowColor = sevColor;
    ctx.shadowBlur = 10;
    ctx.font = 'bold 18px monospace';
    ctx.fillText((info?.severity ?? '').toUpperCase(), W / 2, 106);
    ctx.shadowBlur = 0;

    // Divider
    ctx.strokeStyle = 'rgba(239,68,68,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(16, 118); ctx.lineTo(W - 16, 118);
    ctx.stroke();

    // Tap instruction — glowing button style
    ctx.fillStyle = 'rgba(239,68,68,0.2)';
    roundRect(ctx, 16, 128, W - 32, 38, 10);
    ctx.fill();
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.5;
    roundRect(ctx, 16, 128, W - 32, 38, 10);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px monospace';
    ctx.fillText('TAP TO ACK', W / 2, 152);

    // Type label bottom
    const typeTxt = info?.type === 'fire' ? '🔥 FIRE' : info?.type === 'electrical' ? '⚡ ELECTRICAL' : '🔧 PRESSURE';
    ctx.fillStyle = 'rgba(255,100,100,0.6)';
    ctx.font = '12px monospace';
    ctx.fillText(typeTxt, W / 2, H - 12);

  } else {
    // ── Acknowledged: green clear ─────────────────────────────────────
    roundRect(ctx, 0, 0, W, H, 22);
    ctx.fillStyle = '#041008';
    ctx.fill();

    roundRect(ctx, 3, 3, W - 6, H - 6, 19);
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Green header
    ctx.fillStyle = '#16a34a';
    roundRect(ctx, 10, 10, W - 20, 36, 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('✓ ACKNOWLEDGED', W / 2, 34);

    // Big OK
    ctx.fillStyle = '#22c55e';
    ctx.shadowColor = '#22c55e';
    ctx.shadowBlur = 20;
    ctx.font = 'bold 72px monospace';
    ctx.fillText('OK', W / 2, 116);
    ctx.shadowBlur = 0;

    // Asset cleared
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(ctx, 16, 128, W - 32, 26, 6);
    ctx.fill();
    ctx.fillStyle = '#6abf88';
    ctx.font = '13px monospace';
    ctx.fillText(info?.asset ?? '', W / 2, 145);

    ctx.fillStyle = '#22c55e';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('● CLEAR', W / 2, H - 14);
  }
}

export function Worker({ def }: Props) {
  const groupRef     = useRef<THREE.Group>(null!);
  const bodyRef      = useRef<THREE.Group>(null!);
  const headRef      = useRef<THREE.Mesh>(null!);
  const leftLegRef   = useRef<THREE.Group>(null!);
  const rightLegRef  = useRef<THREE.Group>(null!);
  const leftArmRef   = useRef<THREE.Group>(null!);
  const rightArmRef  = useRef<THREE.Group>(null!);
  const watchRef     = useRef<THREE.Mesh>(null!);
  const watchMatRef  = useRef<THREE.MeshStandardMaterial>(null!);
  const watchScreenMatRef = useRef<THREE.MeshStandardMaterial>(null!);
  const watchRingRef    = useRef<THREE.Mesh>(null!);
  const watchRingMatRef = useRef<THREE.MeshStandardMaterial>(null!);
  const ringRef      = useRef<THREE.Mesh>(null!);
  const ringMatRef   = useRef<THREE.MeshStandardMaterial>(null!);

  const walkIndex  = useRef(0);
  const walkT      = useRef(0);
  const headTurnT  = useRef(0);
  const inspectT   = useRef(0);
  const vibTimer   = useRef(0);

  const lastDrawState = useRef({ dangerFlag: false, acked: true, minTs: 0 });

  const worker          = useStore((s) => s.workers.find((w) => w.id === def.id)!);
  const setFocus        = useStore((s) => s.setFocus);
  const focusTarget     = useStore((s) => s.focusTarget);
  const acknowledgeAlert = useStore((s) => s.acknowledgeAlert);
  const alerts          = useStore((s) => s.alerts);
  const phase           = useStore((s) => s.scenarioPhase);

  const skin = C.skin[def.skinIndex % C.skin.length];

  const walkPath = useMemo<THREE.Vector3[]>(() =>
    (def.walkPath ?? [def.position]).map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    [def]
  );

  // Canvas texture for watch face
  const { watchTex, watchCanvas } = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d')!;
    drawWatchFace(ctx, false, true, undefined);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return { watchTex: tex, watchCanvas: c };
  }, []);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const t        = performance.now() * 0.001;
    const effects  = worker?.effects;
    const isFocused = focusTarget === def.id;

    // ─── Walk loop ────────────────────────────────────────────────────
    if (def.motion === 'walking' && phase === 'idle' && !isFocused) {
      const speed = 0.28;
      walkT.current += delta * speed;
      if (walkT.current >= 1) {
        walkT.current = 0;
        walkIndex.current = (walkIndex.current + 1) % walkPath.length;
      }
      const from = walkPath[walkIndex.current];
      const to   = walkPath[(walkIndex.current + 1) % walkPath.length];
      const pos  = from.clone().lerp(to, walkT.current);
      groupRef.current.position.copy(pos);

      const dir = to.clone().sub(from);
      if (dir.length() > 0.01) {
        const angle = Math.atan2(dir.x, dir.z);
        groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, angle, 0.12);
      }

      const swing = Math.sin(t * 3.5);
      if (leftLegRef.current)  leftLegRef.current.rotation.x  =  swing * 0.42;
      if (rightLegRef.current) rightLegRef.current.rotation.x = -swing * 0.42;
      if (leftArmRef.current)  leftArmRef.current.rotation.x  = -swing * 0.30;
      if (rightArmRef.current) rightArmRef.current.rotation.x =  swing * 0.30;

      if (bodyRef.current) bodyRef.current.position.y = Math.abs(Math.sin(t * 3.5)) * 0.025;
    }

    // ─── Idle breathing ───────────────────────────────────────────────
    if (def.motion !== 'walking') {
      if (bodyRef.current)
        bodyRef.current.position.y = Math.sin(t * 0.9) * 0.003;
    }

    // ─── Head turn ────────────────────────────────────────────────────
    if (def.motion !== 'walking' && headRef.current) {
      headTurnT.current += delta;
      const period = def.motion === 'idle' ? 8 : 10;
      const cycle  = headTurnT.current % period;
      if (cycle < 1.5) {
        headRef.current.rotation.y = THREE.MathUtils.lerp(
          headRef.current.rotation.y,
          Math.sin(headTurnT.current * 0.4) * 0.45,
          0.04,
        );
      }
    }

    // ─── Inspect lean (Omar) ──────────────────────────────────────────
    if (def.motion === 'inspect' && groupRef.current) {
      inspectT.current += delta;
      const leanCycle = inspectT.current % 12;
      const lean = leanCycle < 1.5
        ? THREE.MathUtils.lerp(groupRef.current.rotation.x, 0, 0.05)
        : leanCycle < 4.0
          ? THREE.MathUtils.lerp(groupRef.current.rotation.x, 0, 0.03)
          : THREE.MathUtils.lerp(groupRef.current.rotation.x, -0.08, 0.03);
      groupRef.current.rotation.x = lean;
    }

    // ─── Watch vibration ──────────────────────────────────────────────
    if (effects?.vibrating && watchRef.current) {
      const activeAlert = alerts.find(a => !a.acknowledged);
      const alertActive = !!effects.dangerFlag && !!activeAlert;
      if (alertActive) {
        // Continuous haptic pulse while alert is unacknowledged: 0.4s buzz, 1.6s rest
        const cycle = t % 2.0;
        watchRef.current.position.x = cycle < 0.4
          ? Math.sin(cycle * 80) * 0.004
          : 0;
      } else {
        // One-shot 0.8s buzz on delivery
        vibTimer.current += delta;
        watchRef.current.position.x = vibTimer.current < 0.8
          ? Math.sin(vibTimer.current * 40) * 0.003
          : 0;
      }
    } else {
      vibTimer.current = 0;
      if (watchRef.current) watchRef.current.position.x = 0;
    }

    // ─── Watch glow (alert states) ────────────────────────────────────
    if (watchMatRef.current) {
      if (effects?.dangerFlag) {
        watchMatRef.current.emissive.setRGB(1, 0.15, 0);
        watchMatRef.current.emissiveIntensity = 0.5 + Math.sin(t * 5) * 0.5;
      } else if (effects?.flashing) {
        watchMatRef.current.emissive.setRGB(0.3, 0.5, 1);
        watchMatRef.current.emissiveIntensity = 0.3 + Math.sin(t * 3) * 0.35;
      } else if (effects?.ringPulse) {
        watchMatRef.current.emissive.setRGB(0.1, 0.8, 0.4);
        watchMatRef.current.emissiveIntensity = 0.4 + Math.sin(t * 2) * 0.2;
      } else {
        watchMatRef.current.emissive.set(C.watchGlow);
        watchMatRef.current.emissiveIntensity = 0.5 + Math.sin(t * 1.2) * 0.15;
      }
    }

    // ─── Watch screen glow (emissiveMap = texture, so intensity just scales brightness) ──
    if (watchScreenMatRef.current) {
      if (effects?.dangerFlag && !alerts[0]?.acknowledged) {
        watchScreenMatRef.current.emissiveIntensity = 1.1 + Math.abs(Math.sin(t * 4)) * 0.4;
      } else if (isFocused) {
        watchScreenMatRef.current.emissiveIntensity = 1.3;
      } else {
        watchScreenMatRef.current.emissiveIntensity = 0.9;
      }
    }

    // ─── Watch face texture update ────────────────────────────────────
    const dangerFlag  = !!effects?.dangerFlag;
    const acked       = alerts[0]?.acknowledged ?? true;
    const minTs       = Math.floor(Date.now() / 60_000);
    const st          = lastDrawState.current;
    if (dangerFlag !== st.dangerFlag || acked !== st.acked || (!dangerFlag && minTs !== st.minTs)) {
      lastDrawState.current = { dangerFlag, acked, minTs };
      const ctx = watchCanvas.getContext('2d')!;
      const a0  = alerts[0];
      drawWatchFace(ctx, dangerFlag, acked, a0 ? { type: a0.alertType, asset: a0.assetId, severity: a0.severity } : undefined);
      watchTex.needsUpdate = true;
    }

    // ─── Watch danger ring — glows red around wrist when alerted ──────
    if (watchRingMatRef.current) {
      if (effects?.dangerFlag) {
        const pulse = 0.7 + Math.sin(t * 5) * 0.3;
        watchRingMatRef.current.emissiveIntensity = pulse;
        watchRingMatRef.current.opacity = 0.88;
      } else {
        watchRingMatRef.current.emissiveIntensity = 0;
        watchRingMatRef.current.opacity = 0;
      }
    }

    // ─── Floor ring color + pulse ─────────────────────────────────────
    if (ringMatRef.current && effects) {
      ringMatRef.current.color.set(effects.ringColor);
      ringMatRef.current.emissive.set(effects.ringColor);
      ringMatRef.current.emissiveIntensity = effects.ringPulse
        ? 0.5 + Math.sin(t * 3) * 0.5
        : 0.3;
    }

    // ─── Left arm raise: vibrating OR focused (watch closeup) ─────────
    if ((effects?.vibrating || isFocused) && leftArmRef.current) {
      leftArmRef.current.rotation.x = THREE.MathUtils.lerp(leftArmRef.current.rotation.x, -1.25, 0.055);
      leftArmRef.current.rotation.z = THREE.MathUtils.lerp(leftArmRef.current.rotation.z, -0.25, 0.055);
    } else if (leftArmRef.current && !effects?.vibrating && !isFocused) {
      leftArmRef.current.rotation.x = THREE.MathUtils.lerp(leftArmRef.current.rotation.x, 0, 0.04);
      leftArmRef.current.rotation.z = THREE.MathUtils.lerp(leftArmRef.current.rotation.z, 0, 0.04);
    }

    // ─── Ack arm raise ────────────────────────────────────────────────
    if (effects?.ackArm && rightArmRef.current) {
      rightArmRef.current.rotation.x = THREE.MathUtils.lerp(rightArmRef.current.rotation.x, -0.9, 0.06);
    }

    // ─── Export watch world position for dynamic camera ───────────────
    // CameraRig reads this each frame to aim the closeup camera at the watch face.
    if (isFocused && watchRef.current) {
      watchRef.current.updateWorldMatrix(true, false);
      watchRef.current.getWorldPosition(watchFocusData.watchPos);
      const e = watchRef.current.matrixWorld.elements;
      // Column 2 of a column-major matrix = local Z axis in world space = watch face normal
      watchFocusData.watchNormal.set(e[8], e[9], e[10]).normalize();
      watchFocusData.valid = true;
    }
  });

  // 5 hat colors, one per skinIndex slot
  const hatColors = ['#f59e0b', '#3b82f6', '#ef4444', '#10b981', '#a855f7'];
  const hatColor  = hatColors[def.skinIndex % hatColors.length];

  const latestAlert = alerts[0] ?? null;
  const isDangerNotAcked = !!(worker?.effects.dangerFlag && latestAlert && !latestAlert.acknowledged);

  return (
    <group
      ref={groupRef}
      position={def.position}
      rotation={[0, def.facing, 0]}
      onClick={(e) => { e.stopPropagation(); setFocus(def.id); }}
    >
      {/* Boots */}
      <RoundedBox args={[-0.08, 0.14, 0.2]} radius={0.04} position={[-0.07, 0.07, 0.01]} castShadow>
        <meshStandardMaterial color={C.boots} roughness={0.9} metalness={0.06} />
      </RoundedBox>
      <RoundedBox args={[0.08, 0.14, 0.2]} radius={0.04} position={[0.07, 0.07, 0.01]} castShadow>
        <meshStandardMaterial color={C.boots} roughness={0.9} metalness={0.06} />
      </RoundedBox>

      {/* Legs */}
      <group ref={leftLegRef} position={[-0.08, 0.32, 0]}>
        <mesh position={[0, -0.13, 0]} castShadow>
          <cylinderGeometry args={[0.062, 0.055, 0.34, 9]} />
          <meshStandardMaterial color={C.trousers} roughness={0.88} />
        </mesh>
      </group>
      <group ref={rightLegRef} position={[0.08, 0.32, 0]}>
        <mesh position={[0, -0.13, 0]} castShadow>
          <cylinderGeometry args={[0.062, 0.055, 0.34, 9]} />
          <meshStandardMaterial color={C.trousers} roughness={0.88} />
        </mesh>
      </group>

      {/* Trousers block */}
      <RoundedBox args={[0.30, 0.28, 0.22]} radius={0.06} position={[0, 0.5, 0]} castShadow>
        <meshStandardMaterial color={C.trousers} roughness={0.88} />
      </RoundedBox>

      {/* Body group */}
      <group ref={bodyRef}>
        {/* Torso */}
        <RoundedBox args={[0.38, 0.46, 0.22]} radius={0.09} position={[0, 0.88, 0]} castShadow>
          <meshStandardMaterial color={C.vest} roughness={0.85} />
        </RoundedBox>

        {/* Safety vest stripe */}
        <mesh position={[0, 0.92, 0.112]} castShadow>
          <planeGeometry args={[0.30, 0.06]} />
          <meshStandardMaterial color="#fbbf24" roughness={0.7} emissive="#fbbf24" emissiveIntensity={0.12} side={2} />
        </mesh>

        {/* Neck */}
        <mesh position={[0, 1.14, 0]} castShadow>
          <cylinderGeometry args={[0.065, 0.07, 0.14, 9]} />
          <meshStandardMaterial color={skin} roughness={0.72} />
        </mesh>

        {/* Head */}
        <RoundedBox
          ref={headRef}
          args={[0.24, 0.28, 0.22]}
          radius={0.09}
          position={[0, 1.42, 0]}
          castShadow
        >
          <meshStandardMaterial color={skin} roughness={0.72} />
        </RoundedBox>

        {/* Nose bump */}
        <mesh position={[0, 1.40, 0.112]} castShadow>
          <sphereGeometry args={[0.025, 6, 6]} />
          <meshStandardMaterial color={skin} roughness={0.75} />
        </mesh>

        {/* Hardhat */}
        <RoundedBox args={[0.28, 0.09, 0.26]} radius={0.05} position={[0, 1.60, 0]} castShadow>
          <meshStandardMaterial color={hatColor} roughness={0.78} />
        </RoundedBox>
        {/* Hat brim */}
        <mesh position={[0, 1.555, 0]}>
          <cylinderGeometry args={[0.175, 0.175, 0.018, 16]} />
          <meshStandardMaterial color={hatColor} roughness={0.78} />
        </mesh>

        {/* Left arm */}
        <group ref={leftArmRef} position={[-0.22, 0.86, 0]}>
          {/* Upper arm */}
          <mesh position={[0, -0.13, 0]} castShadow>
            <cylinderGeometry args={[0.058, 0.052, 0.26, 9]} />
            <meshStandardMaterial color={C.vest} roughness={0.85} />
          </mesh>
          {/* Elbow joint */}
          <mesh position={[0, -0.26, 0]} castShadow>
            <sphereGeometry args={[0.055, 8, 8]} />
            <meshStandardMaterial color={C.vest} roughness={0.85} />
          </mesh>
          {/* Lower arm */}
          <mesh position={[0, -0.38, 0]} castShadow>
            <cylinderGeometry args={[0.048, 0.044, 0.22, 9]} />
            <meshStandardMaterial color={skin} roughness={0.72} />
          </mesh>
          {/* Smartwatch body + screen group (moves together for vibration) */}
          <mesh ref={watchRef} position={[0, -0.50, 0.055]} castShadow
            onClick={(e) => { e.stopPropagation(); setFocus(def.id); }}>
            {/* Watch body */}
            <RoundedBox args={[0.085, 0.065, 0.028]} radius={0.012}>
              <meshStandardMaterial
                ref={watchMatRef}
                color="#0d111a"
                emissive={C.watchGlow}
                emissiveIntensity={0.5}
                roughness={0.3}
                metalness={0.5}
              />
            </RoundedBox>
            {/* Watch screen — canvas texture, tap to acknowledge */}
            <mesh
              position={[0, 0, 0.016]}
              onClick={(e) => {
                e.stopPropagation();
                if (isDangerNotAcked) acknowledgeAlert();
                else setFocus(def.id);
              }}
            >
              <planeGeometry args={[0.075, 0.055]} />
              <meshStandardMaterial
                ref={watchScreenMatRef}
                map={watchTex}
                emissiveMap={watchTex}
                emissive="#ffffff"
                emissiveIntensity={1.2}
                roughness={0.05}
                metalness={0}
              />
            </mesh>
          </mesh>
          {/* Watch band */}
          <mesh position={[0, -0.50, 0.01]} castShadow>
            <boxGeometry args={[0.028, 0.09, 0.015]} />
            <meshStandardMaterial color="#1a2535" roughness={0.8} />
          </mesh>
          {/* Watch danger ring — glows red when this worker is alerted */}
          <mesh ref={watchRingRef} position={[0, -0.48, 0.055]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.062, 0.009, 8, 28]} />
            <meshStandardMaterial
              ref={watchRingMatRef}
              color="#ef4444"
              emissive="#ef4444"
              emissiveIntensity={0}
              roughness={0.3}
              transparent
              opacity={0}
              depthWrite={false}
            />
          </mesh>
        </group>

        {/* Right arm */}
        <group ref={rightArmRef} position={[0.22, 0.86, 0]}>
          <mesh position={[0, -0.13, 0]} castShadow>
            <cylinderGeometry args={[0.058, 0.052, 0.26, 9]} />
            <meshStandardMaterial color={C.vest} roughness={0.85} />
          </mesh>
          <mesh position={[0, -0.26, 0]} castShadow>
            <sphereGeometry args={[0.055, 8, 8]} />
            <meshStandardMaterial color={C.vest} roughness={0.85} />
          </mesh>
          <mesh position={[0, -0.38, 0]} castShadow>
            <cylinderGeometry args={[0.048, 0.044, 0.22, 9]} />
            <meshStandardMaterial color={skin} roughness={0.72} />
          </mesh>
        </group>
      </group>

      {/* Name label */}
      <Text
        position={[0, 2.08, 0]}
        fontSize={0.105}
        color="#bfcbd8"
        anchorX="center"
        anchorY="middle"
        renderOrder={1}
      >
        {def.name}
      </Text>

      {/* Base status ring */}
      <mesh ref={ringRef} position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.32, 0.019, 8, 40]} />
        <meshStandardMaterial
          ref={ringMatRef}
          color={C.ringNormal}
          emissive={C.ringNormal}
          emissiveIntensity={0.3}
          roughness={0.5}
          transparent
          opacity={0.85}
        />
      </mesh>
    </group>
  );
}
