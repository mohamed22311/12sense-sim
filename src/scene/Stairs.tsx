import { RoundedBox } from '@react-three/drei';

const STEP_COUNT = 7;
const STEP_RISE  = 0.5;   // height per step
const STEP_RUN   = 0.55;  // depth per step
const STAIR_W    = 1.8;   // width of staircase

// Staircase + mezzanine platform on the left wall (x≈-8)
// Stairs go from z=-0.5 (bottom) to z≈-4.4 (top), y=0 → y=3.5
// Mezzanine runs from z=-4.4 to z=-13.5 at y=3.5
export function Stairs() {
  return (
    <group>
      {/* ── Steps ─────────────────────────────────────────────────────── */}
      {Array.from({ length: STEP_COUNT }, (_, i) => (
        <mesh
          key={i}
          position={[
            -7.1,
            i * STEP_RISE + STEP_RISE / 2,
            -0.5 - i * STEP_RUN - STEP_RUN / 2,
          ]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[STAIR_W, STEP_RISE, STEP_RUN]} />
          <meshStandardMaterial color="#8a9aaa" roughness={0.85} metalness={0.12} />
        </mesh>
      ))}

      {/* ── Handrail posts (right edge of stairs) ─────────────────────── */}
      {Array.from({ length: 5 }, (_, i) => {
        const t = i / 4;
        return (
          <mesh
            key={i}
            position={[
              -6.25,
              t * STEP_COUNT * STEP_RISE + 0.55,
              -0.5 - t * STEP_COUNT * STEP_RUN,
            ]}
            castShadow
          >
            <cylinderGeometry args={[0.025, 0.025, 1.0, 8]} />
            <meshStandardMaterial color="#4a5a6a" roughness={0.6} metalness={0.5} />
          </mesh>
        );
      })}

      {/* ── Handrail bar (right side, angled along stair slope) ───────── */}
      <mesh
        position={[-6.25, STEP_COUNT * STEP_RISE * 0.5 + 0.55, -0.5 - STEP_COUNT * STEP_RUN * 0.5]}
        rotation={[Math.atan2(STEP_RISE, STEP_RUN), 0, 0]}
        castShadow
      >
        <cylinderGeometry args={[0.02, 0.02, STEP_COUNT * Math.sqrt(STEP_RISE ** 2 + STEP_RUN ** 2) + 0.2, 8]} />
        <meshStandardMaterial color="#3a4a5a" roughness={0.6} metalness={0.5} />
      </mesh>

      {/* ── Mezzanine platform floor (4 units wide, inner edge at x=-4) ── */}
      <mesh position={[-6.0, 3.5, -9.0]} receiveShadow>
        <boxGeometry args={[4.0, 0.12, 9.5]} />
        <meshStandardMaterial color="#8a9aaa" roughness={0.85} metalness={0.1} />
      </mesh>
      {/* Mezzanine floor edge highlight strip */}
      <mesh position={[-4.03, 3.57, -9.0]}>
        <boxGeometry args={[0.04, 0.02, 9.5]} />
        <meshStandardMaterial color="#f0c020" emissive="#f0c020" emissiveIntensity={0.4} roughness={0.8} />
      </mesh>

      {/* ── Mezzanine safety railing (inner edge at x=-4.05) ─────────── */}
      {/* Horizontal top rail */}
      <mesh position={[-4.05, 4.45, -9.0]}>
        <boxGeometry args={[0.04, 0.04, 9.5]} />
        <meshStandardMaterial color="#4a5a6a" roughness={0.6} metalness={0.5} />
      </mesh>
      {/* Mid rail */}
      <mesh position={[-4.05, 4.10, -9.0]}>
        <boxGeometry args={[0.03, 0.03, 9.5]} />
        <meshStandardMaterial color="#4a5a6a" roughness={0.6} metalness={0.5} />
      </mesh>
      {/* Rail posts */}
      {Array.from({ length: 7 }, (_, i) => (
        <mesh key={i} position={[-4.05, 3.97, -4.8 - i * 1.3]} castShadow>
          <cylinderGeometry args={[0.022, 0.022, 0.9, 8]} />
          <meshStandardMaterial color="#4a5a6a" roughness={0.6} metalness={0.5} />
        </mesh>
      ))}

      {/* ── Mezzanine overhead light fixtures ─────────────────────────── */}
      {([-5.5, -8.5, -12.0] as const).map((z, i) => (
        <group key={i} position={[-6.0, 5.6, z]}>
          <RoundedBox args={[0.28, 0.06, 0.28]} radius={0.02}>
            <meshStandardMaterial color="#2a3040" roughness={0.7} metalness={0.3} />
          </RoundedBox>
          <mesh position={[0, -0.06, 0]}>
            <planeGeometry args={[0.22, 0.22]} />
            <meshStandardMaterial
              color="#fffff0"
              emissive="#fffff0"
              emissiveIntensity={2.0}
              roughness={0.1}
              side={2}
            />
          </mesh>
          <pointLight position={[0, -0.1, 0]} intensity={0.8} distance={5} color="#fffbe0" />
        </group>
      ))}

      {/* ── Structural columns supporting mezzanine ───────────────────── */}
      {([-4.5, -9.5, -13.5] as const).map((z, i) => (
        <mesh key={i} position={[-4.08, 1.75, z]} castShadow>
          <cylinderGeometry args={[0.08, 0.10, 3.5, 10]} />
          <meshStandardMaterial color="#6a7a8a" roughness={0.8} metalness={0.2} />
        </mesh>
      ))}

      {/* ── Yellow anti-slip edge strip on each step ──────────────────── */}
      {Array.from({ length: STEP_COUNT }, (_, i) => (
        <mesh
          key={i}
          position={[
            -7.1,
            i * STEP_RISE + STEP_RISE + 0.008,
            -0.5 - i * STEP_RUN - 0.02,
          ]}
        >
          <boxGeometry args={[STAIR_W, 0.016, 0.07]} />
          <meshStandardMaterial color="#f0c020" emissive="#f0c020" emissiveIntensity={0.25} roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}
