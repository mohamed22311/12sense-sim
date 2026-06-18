import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { C } from '../styles/palette';
import { useStore } from '../state/store';

// Helper for rounded rects on canvas (no roundRect API needed)
function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
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

interface AlertInfo  { title: string; severity: string; assetId: string; acknowledged: boolean; workOrder?: string }
interface WorkerInfo { name: string; sensors: { heart_rate: number; spo2: number; stress_index: number; motion_state: string; battery: number }; effects: { ringColor: string; dangerFlag: boolean } }

const CW = 1024, CH = 640;

function buildDashTexture(alerts: AlertInfo[], workers: WorkerInfo[]) {
  const canvas = document.createElement('canvas');
  canvas.width = CW; canvas.height = CH;
  const ctx = canvas.getContext('2d')!;

  // ── Background — bright white ─────────────────────────────────────
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CW, CH);

  // ── Header bar ────────────────────────────────────────────────────
  const hasActive = alerts.some(a => !a.acknowledged);
  ctx.fillStyle = hasActive ? '#c02020' : '#1a3a6e';
  ctx.fillRect(0, 0, CW, 48);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('TWELVE SENSES  —  CONTROL ROOM', 16, 32);
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(hasActive ? '● ALERT ACTIVE' : '● ALL CLEAR', CW - 16, 30);
  ctx.textAlign = 'left';

  // ── Stat tiles ────────────────────────────────────────────────────
  const activeAlerts = alerts.filter(a => !a.acknowledged).length;
  const avgHR = workers.length ? Math.round(workers.reduce((s, w) => s + w.sensors.heart_rate, 0) / workers.length) : 0;
  const atRisk = workers.filter(w => w.effects.dangerFlag || w.sensors.battery < 15 || w.sensors.spo2 < 95).length;

  const tiles = [
    { label: 'ACTIVE ALERTS', value: String(activeAlerts), bg: activeAlerts > 0 ? '#fee2e2' : '#dcfce7', fg: activeAlerts > 0 ? '#b91c1c' : '#166534', border: activeAlerts > 0 ? '#f87171' : '#4ade80' },
    { label: 'WORKERS',       value: `${workers.length}`, bg: '#dbeafe', fg: '#1e40af', border: '#60a5fa' },
    { label: 'AT RISK',       value: String(atRisk),      bg: atRisk > 0 ? '#fef9c3' : '#dcfce7', fg: atRisk > 0 ? '#854d0e' : '#166534', border: atRisk > 0 ? '#fbbf24' : '#4ade80' },
    { label: 'AVG HEART RATE', value: `${avgHR} BPM`,    bg: avgHR > 100 ? '#fee2e2' : '#f0f9ff', fg: avgHR > 100 ? '#b91c1c' : '#075985', border: avgHR > 100 ? '#f87171' : '#38bdf8' },
  ];

  tiles.forEach((tile, i) => {
    const x = 12 + i * 250;
    ctx.fillStyle = tile.bg;
    rrect(ctx, x, 60, 234, 80, 10); ctx.fill();
    ctx.strokeStyle = tile.border; ctx.lineWidth = 2.5;
    rrect(ctx, x, 60, 234, 80, 10); ctx.stroke();
    ctx.fillStyle = tile.fg;
    ctx.font = 'bold 38px system-ui, sans-serif';
    ctx.fillText(tile.value, x + 14, 115);
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillStyle = '#6b7280';
    ctx.fillText(tile.label, x + 14, 132);
  });

  // ── Workers section ───────────────────────────────────────────────
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 15px system-ui, sans-serif';
  ctx.fillText('WORKERS', 12, 168);
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(12, 172, CW - 24, 2);

  workers.forEach((w, i) => {
    const y = 178 + i * 52;
    ctx.fillStyle = w.effects.dangerFlag ? '#fff1f2' : '#f9fafb';
    rrect(ctx, 12, y, CW - 24, 44, 8); ctx.fill();
    ctx.strokeStyle = w.effects.dangerFlag ? '#fca5a5' : '#e5e7eb'; ctx.lineWidth = 1.5;
    rrect(ctx, 12, y, CW - 24, 44, 8); ctx.stroke();

    // Status dot
    ctx.fillStyle = w.effects.dangerFlag ? '#ef4444' : '#22c55e';
    ctx.shadowColor = w.effects.dangerFlag ? '#ef4444' : '#22c55e';
    ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(32, y + 22, 8, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#111827';
    ctx.font = 'bold 14px system-ui, sans-serif';
    const short = w.name.split(' ')[0] + ' ' + (w.name.split(' ')[1]?.[0] ?? '') + '.';
    ctx.fillText(short, 50, y + 27);

    // Sensor pills
    const pills = [
      { label: `HR: ${w.sensors.heart_rate}`, bad: w.sensors.heart_rate > 100 },
      { label: `SpO₂: ${w.sensors.spo2}%`,   bad: w.sensors.spo2 < 95 },
      { label: `STR: ${w.sensors.stress_index}`, bad: w.sensors.stress_index > 70 },
      { label: `BAT: ${w.sensors.battery}%`,  bad: w.sensors.battery < 15 },
      { label: w.sensors.motion_state,         bad: false },
    ];
    let px = 220;
    pills.forEach(p => {
      const tw = ctx.measureText(p.label).width + 16;
      ctx.fillStyle = p.bad ? '#fee2e2' : '#f3f4f6';
      rrect(ctx, px, y + 12, tw, 20, 5); ctx.fill();
      ctx.fillStyle = p.bad ? '#b91c1c' : '#374151';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.fillText(p.label, px + 8, y + 25);
      px += tw + 8;
    });
  });

  // ── Alerts section ────────────────────────────────────────────────
  const alertY = 178 + workers.length * 52 + 16;
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 15px system-ui, sans-serif';
  ctx.fillText('RECENT ALERTS', 12, alertY);
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(12, alertY + 4, CW - 24, 2);

  if (alerts.length === 0) {
    ctx.fillStyle = '#dcfce7';
    rrect(ctx, 12, alertY + 10, CW - 24, 36, 8); ctx.fill();
    ctx.fillStyle = '#166534';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText('✓  No active alerts — all systems nominal', 28, alertY + 33);
  } else {
    alerts.slice(0, 3).forEach((a, i) => {
      const y = alertY + 10 + i * 50;
      ctx.fillStyle = a.acknowledged ? '#f0fdf4' : '#fff1f2';
      rrect(ctx, 12, y, CW - 24, 42, 8); ctx.fill();
      ctx.strokeStyle = a.acknowledged ? '#4ade80' : '#f87171'; ctx.lineWidth = 2;
      rrect(ctx, 12, y, CW - 24, 42, 8); ctx.stroke();

      const dot = a.acknowledged ? '#22c55e' : '#ef4444';
      ctx.fillStyle = dot;
      ctx.beginPath(); ctx.arc(28, y + 21, 7, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = a.acknowledged ? '#166534' : '#991b1b';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.fillText(`${a.assetId} — ${a.title}`, 44, y + 18);
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = '#6b7280';
      ctx.fillText(`${a.acknowledged ? '✓ Acknowledged' : '⚠ OPEN'} · ${a.severity.toUpperCase()} · WO: ${a.workOrder ?? '—'}`, 44, y + 34);
    });
  }

  return canvas;
}

export function AdminStation() {
  const texRef       = useRef<THREE.CanvasTexture | null>(null);
  const screenRef    = useRef<THREE.Mesh>(null!);
  const screenMatRef = useRef<THREE.MeshStandardMaterial>(null!);
  const setFocus     = useStore((s) => s.setFocus);
  const alerts       = useStore((s) => s.alerts);
  const workers      = useStore((s) => s.workers);
  const phase        = useStore((s) => s.scenarioPhase);

  const alertsForTex: AlertInfo[]  = alerts.map((a) => ({
    title: a.title, severity: a.severity, assetId: a.assetId,
    acknowledged: a.acknowledged, workOrder: a.workOrder,
  }));
  const workersForTex: WorkerInfo[] = workers.map((w) => ({
    name: w.name,
    sensors: { heart_rate: w.sensors.heart_rate, spo2: w.sensors.spo2,
      stress_index: w.sensors.stress_index, motion_state: w.sensors.motion_state,
      battery: w.sensors.battery },
    effects: { ringColor: w.effects.ringColor, dangerFlag: w.effects.dangerFlag },
  }));

  // Rebuild texture when data changes
  useMemo(() => {
    const canvas = buildDashTexture(alertsForTex, workersForTex);
    if (texRef.current) {
      const ctx = (texRef.current.image as HTMLCanvasElement).getContext('2d')!;
      ctx.drawImage(canvas, 0, 0);
      texRef.current.needsUpdate = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts, workers]);

  // Create initial texture
  useEffect(() => {
    const canvas = buildDashTexture(alertsForTex, workersForTex);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    texRef.current = tex;
    if (screenMatRef.current) {
      screenMatRef.current.map = tex;
      screenMatRef.current.emissiveMap = tex;
      screenMatRef.current.needsUpdate = true;
    }
    return () => { tex.dispose(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame(() => {
    if (!screenMatRef.current) return;
    if (phase === 'acknowledged') {
      const t = performance.now() * 0.001;
      screenMatRef.current.emissiveIntensity = 3.2 + Math.sin(t * 5) * 0.4;
    } else if (phase !== 'idle') {
      screenMatRef.current.emissiveIntensity = 3.6;
    } else {
      screenMatRef.current.emissiveIntensity = 2.8;
    }
  });

  return (
    <group position={[0, 0, 4]} onClick={(e) => { e.stopPropagation(); setFocus('admin'); }}>
      {/* Desk */}
      <RoundedBox args={[3.0, 0.12, 1.2]} radius={0.04} position={[0, 0.82, 0]} castShadow>
        <meshStandardMaterial color={C.deskBody} roughness={0.88} metalness={0.02} />
      </RoundedBox>
      <RoundedBox args={[3.0, 0.80, 0.08]} radius={0.04} position={[0, 0.42, 0.56]} castShadow>
        <meshStandardMaterial color={C.deskBody} roughness={0.88} metalness={0.02} />
      </RoundedBox>
      <RoundedBox args={[1.0, 0.12, 0.8]} radius={0.04} position={[-1.2, 0.82, 0.4]} castShadow>
        <meshStandardMaterial color={C.deskBody} roughness={0.88} metalness={0.02} />
      </RoundedBox>

      {/* Monitor stand */}
      <mesh position={[0, 1.02, -0.1]} castShadow>
        <cylinderGeometry args={[0.05, 0.08, 0.42, 10]} />
        <meshStandardMaterial color="#1a2030" roughness={0.7} metalness={0.2} />
      </mesh>

      {/* Monitor frame — wide, bright dashboard visible from overview */}
      <RoundedBox args={[2.2, 1.42, 0.07]} radius={0.04} position={[0, 1.82, -0.1]} castShadow>
        <meshStandardMaterial color={C.monitorFrame} roughness={0.85} metalness={0.1} />
      </RoundedBox>

      {/* Monitor screen — always-on bright emissive so it's readable from overview */}
      <mesh ref={screenRef} position={[0, 1.82, -0.065]}>
        <planeGeometry args={[2.08, 1.30]} />
        <meshStandardMaterial
          ref={screenMatRef}
          color="#ffffff"
          emissive="#ffffff"
          emissiveIntensity={2.8}
          roughness={0.05}
          metalness={0}
          toneMapped={false}
        />
      </mesh>

      {/* Strong screen glow so it lights the surrounding area */}
      <pointLight position={[0, 1.82, 0.1]} intensity={1.8} distance={5} color="#e8f0ff" />

      {/* Side screen */}
      <mesh position={[-1.2, 1.52, 0.2]} rotation={[0, Math.PI * 0.15, 0]}>
        <planeGeometry args={[0.68, 0.44]} />
        <meshStandardMaterial color="#0d1821" emissive="#4e80cc" emissiveIntensity={0.35} roughness={0.4} />
      </mesh>

      {/* Keyboard */}
      <RoundedBox args={[0.6, 0.02, 0.22]} radius={0.01} position={[0.2, 0.89, 0.25]} castShadow>
        <meshStandardMaterial color="#1a2030" roughness={0.9} />
      </RoundedBox>

      {/* Coffee mug */}
      <mesh position={[1.1, 0.96, -0.05]} castShadow>
        <cylinderGeometry args={[0.05, 0.045, 0.10, 12]} />
        <meshStandardMaterial color="#2a3040" roughness={0.8} />
      </mesh>
    </group>
  );
}
