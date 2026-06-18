export function Ceiling() {
  return (
    <group>
      {/* Ceiling plane — expanded 20×24, centered at [0, 5.5, -4] */}
      <mesh position={[0, 5.5, -4]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[20, 24]} />
        <meshStandardMaterial color="#f4ecd8" roughness={0.92} metalness={0.0} />
      </mesh>

      {/* Timber beams — front half */}
      {([-3, 0, 3] as const).map((z, i) => (
        <mesh key={`f${i}`} position={[0, 5.4, z]} castShadow>
          <boxGeometry args={[18, 0.22, 0.28]} />
          <meshStandardMaterial color="#c09060" roughness={0.88} metalness={0.02} />
        </mesh>
      ))}

      {/* Timber beams — back half */}
      {([-9, -12] as const).map((z, i) => (
        <mesh key={`b${i}`} position={[0, 5.4, z]} castShadow>
          <boxGeometry args={[18, 0.22, 0.28]} />
          <meshStandardMaterial color="#c09060" roughness={0.88} metalness={0.02} />
        </mesh>
      ))}

      {/* Fluorescent fixtures — front section */}
      {([-4, 0, 4] as const).map((x) =>
        ([-2, 2] as const).map((z, j) => (
          <mesh key={`lf-${x}-${j}`} position={[x, 5.36, z]}>
            <boxGeometry args={[1.2, 0.07, 0.24]} />
            <meshStandardMaterial color="#f8f4e8" emissive="#fffbe8" emissiveIntensity={1.2} roughness={0.2} />
          </mesh>
        ))
      )}

      {/* Fluorescent fixtures — back section */}
      {([-4, 0, 4] as const).map((x) =>
        ([-8, -12] as const).map((z, j) => (
          <mesh key={`lb-${x}-${j}`} position={[x, 5.36, z]}>
            <boxGeometry args={[1.2, 0.07, 0.24]} />
            <meshStandardMaterial color="#f8f4e8" emissive="#fffbe8" emissiveIntensity={1.2} roughness={0.2} />
          </mesh>
        ))
      )}

      {/* Cable trays */}
      <mesh position={[0, 4.8, -7]}>
        <boxGeometry args={[14, 0.07, 0.28]} />
        <meshStandardMaterial color="#7a6a50" roughness={0.88} metalness={0.2} />
      </mesh>
      <mesh position={[0, 4.8, -13]}>
        <boxGeometry args={[14, 0.07, 0.28]} />
        <meshStandardMaterial color="#7a6a50" roughness={0.88} metalness={0.2} />
      </mesh>
    </group>
  );
}
