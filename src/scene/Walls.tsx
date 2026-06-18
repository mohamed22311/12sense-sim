import { useMemo } from 'react';
import * as THREE from 'three';

function buildWallTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f0e4cc';
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = 'rgba(160,130,80,0.2)';
  ctx.lineWidth = 1.5;
  for (let y = 0; y < 256; y += 48) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(160,130,80,0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x < 512; x += 96) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 1);
  return tex;
}

function buildSignTexture(text: string, bg: string, textColor: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 96);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 3;
  ctx.strokeRect(4, 4, 248, 88);
  ctx.fillStyle = textColor;
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 48);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function Walls() {
  const wallTex    = useMemo(() => buildWallTexture(), []);
  const exitTex    = useMemo(() => buildSignTexture('EXIT',         '#1a6a30', '#ffffff'), []);
  const cautionTex = useMemo(() => buildSignTexture('CAUTION',      '#d4820a', '#ffffff'), []);
  const ppeTex     = useMemo(() => buildSignTexture('PPE REQUIRED', '#1a4a8a', '#ffffff'), []);

  // Room is now 20 wide × 24 deep, back wall at z=-14, side walls centered at z=-4
  return (
    <group>
      {/* Back wall */}
      <mesh position={[0, 3, -14]} receiveShadow>
        <planeGeometry args={[20, 6]} />
        <meshStandardMaterial map={wallTex} roughness={0.88} metalness={0.0} />
      </mesh>

      {/* Left wall */}
      <mesh position={[-8, 3, -4]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[24, 6]} />
        <meshStandardMaterial map={wallTex} roughness={0.88} metalness={0.0} />
      </mesh>

      {/* Right wall */}
      <mesh position={[8, 3, -4]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[24, 6]} />
        <meshStandardMaterial map={wallTex} roughness={0.88} metalness={0.0} />
      </mesh>

      {/* Wainscoting — lower wall accent on back wall */}
      <mesh position={[0, 0.5, -13.98]} receiveShadow>
        <planeGeometry args={[20, 1.0]} />
        <meshStandardMaterial color="#d4b88a" roughness={0.9} metalness={0.0} />
      </mesh>

      {/* Factory windows — back wall */}
      {([-4.5, 0, 4.5] as const).map((x, i) => (
        <group key={i} position={[x, 3.6, -13.95]}>
          {/* Glass */}
          <mesh>
            <planeGeometry args={[1.7, 1.9]} />
            <meshStandardMaterial
              color="#78c4f0"
              emissive="#a8dcf8"
              emissiveIntensity={0.85}
              roughness={0.05}
              metalness={0.0}
              transparent
              opacity={0.92}
            />
          </mesh>
          {/* Frame bars — top & bottom */}
          {([-0.97, 0.97] as const).map((dy) => (
            <mesh key={dy} position={[0, dy, 0.015]}>
              <boxGeometry args={[1.82, 0.055, 0.045]} />
              <meshStandardMaterial color="#c09060" roughness={0.8} />
            </mesh>
          ))}
          {/* Frame bars — left & right */}
          {([-0.88, 0.88] as const).map((dx) => (
            <mesh key={dx} position={[dx, 0, 0.015]}>
              <boxGeometry args={[0.055, 1.95, 0.045]} />
              <meshStandardMaterial color="#c09060" roughness={0.8} />
            </mesh>
          ))}
          {/* Centre mullions */}
          <mesh position={[0, 0, 0.018]}>
            <boxGeometry args={[0.042, 1.95, 0.04]} />
            <meshStandardMaterial color="#c09060" roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.12, 0.018]}>
            <boxGeometry args={[1.82, 0.042, 0.04]} />
            <meshStandardMaterial color="#c09060" roughness={0.8} />
          </mesh>
        </group>
      ))}

      {/* Safety signs on back wall */}
      <mesh position={[-6.5, 2.5, -13.95]}>
        <planeGeometry args={[0.9, 0.34]} />
        <meshStandardMaterial map={exitTex} roughness={0.8} emissive="#22c55e" emissiveIntensity={0.2} />
      </mesh>
      <mesh position={[0, 2.0, -13.95]}>
        <planeGeometry args={[0.9, 0.34]} />
        <meshStandardMaterial map={cautionTex} roughness={0.8} emissive="#f59e0b" emissiveIntensity={0.15} />
      </mesh>
      <mesh position={[5.5, 2.5, -13.95]}>
        <planeGeometry args={[0.9, 0.34]} />
        <meshStandardMaterial map={ppeTex} roughness={0.8} emissive="#4e80cc" emissiveIntensity={0.15} />
      </mesh>

      {/* Mid-room divider pipe on left wall */}
      <mesh position={[-7.96, 1.6, -4]} rotation={[0, Math.PI / 2, 0]}>
        <cylinderGeometry args={[0.045, 0.045, 24, 8]} />
        <meshStandardMaterial color="#7a8a9a" roughness={0.7} metalness={0.3} />
      </mesh>
    </group>
  );
}
