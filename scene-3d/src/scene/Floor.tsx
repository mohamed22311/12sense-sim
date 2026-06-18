import { useMemo } from 'react';
import * as THREE from 'three';

function buildFloorTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#c4a864';
  ctx.fillRect(0, 0, 512, 512);

  ctx.strokeStyle = 'rgba(100,80,40,0.22)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 512; i += 64) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
  }

  ctx.fillStyle = 'rgba(180,140,80,0.08)';
  for (let i = 0; i < 400; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    ctx.fillRect(x, y, 3, 3);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 4);
  return tex;
}

export function Floor() {
  const tex = useMemo(() => buildFloorTexture(), []);

  return (
    <group>
      {/* Main floor — expanded room 20×24, centered at [0, 0, -4] */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -4]} receiveShadow>
        <planeGeometry args={[20, 24]} />
        <meshStandardMaterial map={tex} roughness={0.90} metalness={0.01} />
      </mesh>

      {/* Caution stripes — CHILLER-07 */}
      <mesh rotation={[-Math.PI / 2, 0,  Math.PI / 4]} position={[-3.5, 0.002, -4.2]}>
        <planeGeometry args={[2.5, 0.18]} />
        <meshStandardMaterial color="#f59e0b" roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, -Math.PI / 4]} position={[-3.5, 0.002, -4.8]}>
        <planeGeometry args={[2.5, 0.18]} />
        <meshStandardMaterial color="#2a2a2a" roughness={0.9} />
      </mesh>

      {/* Caution stripes — PANEL-07 */}
      <mesh rotation={[-Math.PI / 2, 0,  Math.PI / 4]} position={[3.5, 0.002, -4.2]}>
        <planeGeometry args={[2.0, 0.18]} />
        <meshStandardMaterial color="#f59e0b" roughness={0.9} />
      </mesh>

      {/* Caution stripes — FURNACE-03 */}
      <mesh rotation={[-Math.PI / 2, 0,  Math.PI / 4]} position={[-4.0, 0.002, -9.2]}>
        <planeGeometry args={[2.5, 0.18]} />
        <meshStandardMaterial color="#f59e0b" roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, -Math.PI / 4]} position={[-4.0, 0.002, -9.8]}>
        <planeGeometry args={[2.5, 0.18]} />
        <meshStandardMaterial color="#2a2a2a" roughness={0.9} />
      </mesh>

      {/* Caution stripes — COMPRESSOR-01 */}
      <mesh rotation={[-Math.PI / 2, 0,  Math.PI / 4]} position={[4.0, 0.002, -9.2]}>
        <planeGeometry args={[2.0, 0.18]} />
        <meshStandardMaterial color="#f59e0b" roughness={0.9} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, -Math.PI / 4]} position={[4.0, 0.002, -9.8]}>
        <planeGeometry args={[2.0, 0.18]} />
        <meshStandardMaterial color="#2a2a2a" roughness={0.9} />
      </mesh>
    </group>
  );
}
