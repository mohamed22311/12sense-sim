import { memo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { Activity } from '@/sim/jobs';
import { C } from '@/styles/palette';
import {
  buildBucketFor,
  buildScale,
  hashUnit,
  workerGeometry,
  workerMaterials,
} from '@/scene/building/workerAssets';

/**
 * A worker's body.
 *
 * Geometry and materials are shared through `workerAssets` — that was the
 * dominant renderer cost, ~480 unshared objects for sixty people. Variation
 * comes from three build buckets, five skin tones, and a per-worker gait phase,
 * which is where the eye actually reads difference.
 *
 * **The limbs animate imperatively.** A walk cycle at sixty frames a second
 * cannot go through React, so this component reads its own worker's live state
 * through `getSpeed` and writes limb rotations straight onto the meshes. React
 * re-renders it only when the activity or level of detail changes — a handful
 * of times a minute.
 *
 * The pose targets are approached rather than snapped, so a worker who stops
 * walking settles out of the stride instead of freezing mid-step.
 */

export type SimWorkerProps = {
  index: number;
  activity: Activity;
  /** dim floors drop the extra geometry and stop casting shadows */
  detailed: boolean;
  /** live metres-per-second for this worker; drives the stride */
  getSpeed: () => number;
  /** picked out of the crowd — carries a ground ring and an overhead marker */
  selected?: boolean;
  /**
   * This is the worker being driven. He keeps his marker permanently and
   * carries his name on it, the way a controlled player is tagged in a
   * football game — because in a crowd of sixty identically-dressed people,
   * "which one am I" has to be answerable without hunting.
   */
  controlledName?: string | null;
};

/** Torso lean and body drop per activity — what the worker is doing, at rest. */
const POSE: Record<Activity, { lean: number; crouch: number; armLift: number }> = {
  walking: { lean: 0.06, crouch: 0, armLift: 0 },
  climbing: { lean: 0.2, crouch: 0.06, armLift: 0.25 },
  carrying: { lean: 0.1, crouch: 0.03, armLift: -0.9 },
  operating: { lean: 0.16, crouch: 0.02, armLift: -0.75 },
  inspecting: { lean: 0.24, crouch: 0.05, armLift: -0.5 },
  logging: { lean: 0.14, crouch: 0, armLift: -0.85 },
  sweeping: { lean: 0.3, crouch: 0.09, armLift: -0.6 },
  talking: { lean: -0.04, crouch: 0, armLift: -0.1 },
  resting: { lean: -0.09, crouch: 0.14, armLift: -0.05 },
};

/** The driven worker's marker colour — deliberately not the site's orange. */
const MARKER_CONTROLLED = '#5a8fd4';

/** Radians of leg swing at full walking pace. */
const STRIDE = 0.62;

/** How quickly a pose change is taken up. Higher settles faster. */
const POSE_LERP = 6;

const approach = (current: number, target: number, dt: number) =>
  current + (target - current) * Math.min(1, POSE_LERP * dt);

function SimWorkerImpl({
  index,
  activity,
  detailed,
  getSpeed,
  selected = false,
  controlledName = null,
}: SimWorkerProps) {
  const controlled = controlledName !== null;
  const marked = selected || controlled;
  const bucket = buildBucketFor(index);
  const geometry = workerGeometry(bucket);
  const build = buildScale(bucket);
  const skin = workerMaterials.skin(index);
  const vest = workerMaterials.vestFor(index);
  const helmet = workerMaterials.helmetFor(index);
  const pose = POSE[activity];

  // Groups rather than meshes: a limb is several parts now — a leg carries its
  // boot, an arm its cuff and glove — and they have to swing together.
  const legL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const torso = useRef<THREE.Mesh>(null);

  // Every worker starts its cycle somewhere different, so sixty people are not
  // stepping in unison — the most obvious tell of a crowd of clones.
  const phase = useRef(hashUnit(index, 3) * Math.PI * 2);
  const bob = useRef(0);
  const marker = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    const speed = getSpeed();
    // Stride frequency scales with pace: a walking worker takes about two
    // steps a second, and stopping winds the cycle down rather than cutting it.
    phase.current += delta * (2.6 + speed * 1.4);

    const swing = Math.sin(phase.current) * STRIDE * Math.min(1, speed / 1.3);
    const lift = Math.abs(Math.sin(phase.current)) * 0.035 * Math.min(1, speed / 1.3);
    bob.current = approach(bob.current, lift, delta);

    if (legL.current) legL.current.rotation.x = approach(legL.current.rotation.x, swing, delta);
    if (legR.current) legR.current.rotation.x = approach(legR.current.rotation.x, -swing, delta);
    // Arms counter-swing to the legs, damped — the detail that separates a
    // walk from a shuffle.
    if (armL.current) {
      armL.current.rotation.x = approach(armL.current.rotation.x, -swing * 0.7 + pose.armLift, delta);
    }
    if (armR.current) {
      armR.current.rotation.x = approach(armR.current.rotation.x, swing * 0.7 + pose.armLift, delta);
    }
    if (torso.current) {
      torso.current.rotation.x = approach(torso.current.rotation.x, pose.lean, delta);
      torso.current.position.y = 0.9 * build - pose.crouch + bob.current;
    }

    // The marker hovers rather than sitting still, because a static shape over
    // one head in a crowd of sixty is easy to lose and a moving one is not.
    if (marker.current) {
      marker.current.position.y = 1.86 * build + Math.sin(phase.current * 0.8) * 0.06;
      marker.current.rotation.y += delta * 1.1;
    }
  });

  const hipY = 0.62 * build;

  return (
    <group>
      {marked && (
        <>
          {/* Ground ring — reads at any camera angle, including from above
              where an overhead marker is foreshortened to nothing. */}
          <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.36, 0.46, 24]} />
            <meshBasicMaterial
              color={controlled ? MARKER_CONTROLLED : C.vest}
              transparent
              opacity={0.85}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          {/* An overhead chevron, pointing down at whoever is selected. */}
          <mesh ref={marker} position={[0, 1.86 * build, 0]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.15, 0.26, 4]} />
            <meshStandardMaterial
              color={controlled ? MARKER_CONTROLLED : C.vest}
              emissive={new THREE.Color(controlled ? MARKER_CONTROLLED : C.vest)}
              emissiveIntensity={controlled ? 0.7 : 0.45}
              roughness={0.4}
            />
          </mesh>

          {/* The name rides above the chevron and always faces the camera, so
              it stays readable however the building is orbited. */}
          {controlled && (
            <Billboard position={[0, 2.34 * build, 0]}>
              <Text
                // Same reasoning as the machine labels: at overview distance a
                // 0.34 m glyph is six pixels tall. This is the one label that
                // must be readable without hunting.
                fontSize={0.46}
                color="#f2f5f8"
                anchorX="center"
                anchorY="bottom"
                outlineWidth={0.028}
                outlineColor="#1b212a"
              >
                {controlledName}
              </Text>
            </Billboard>
          )}
        </>
      )}
      {/* Legs pivot at the hip, so the geometry hangs below its own origin.
          The boot rides with the leg — a limb that ends in mid-air is the
          fastest way to make a figure read as unfinished. */}
      <group position={[-0.11, hipY - pose.crouch, 0]}>
        <group ref={legL}>
          <mesh
            geometry={geometry.leg}
            material={workerMaterials.trousers}
            position={[0, -0.29 * build, 0]}
            castShadow={detailed}
          />
          {detailed && (
            <mesh
              geometry={geometry.boot}
              material={workerMaterials.boots}
              position={[0, -0.6 * build, 0.03]}
              castShadow
            />
          )}
        </group>
      </group>
      <group position={[0.11, hipY - pose.crouch, 0]}>
        <group ref={legR}>
          <mesh
            geometry={geometry.leg}
            material={workerMaterials.trousers}
            position={[0, -0.29 * build, 0]}
            castShadow={detailed}
          />
          {detailed && (
            <mesh
              geometry={geometry.boot}
              material={workerMaterials.boots}
              position={[0, -0.6 * build, 0.03]}
              castShadow
            />
          )}
        </group>
      </group>

      {/* Hips bridge the trousers and the vest, so the two do not meet at a
          hard seam that reads as a join between two separate objects. */}
      <mesh
        geometry={geometry.hips}
        material={workerMaterials.trousers}
        position={[0, hipY + 0.03 - pose.crouch, 0]}
        castShadow={detailed}
      />

      <mesh
        ref={torso}
        geometry={geometry.torso}
        material={vest}
        position={[0, 0.9 * build - pose.crouch, 0]}
        castShadow={detailed}
      />

      {detailed && (
        <mesh
          geometry={geometry.neck}
          material={skin}
          position={[0, 1.14 * build - pose.crouch, pose.lean * 0.2]}
        />
      )}

      <mesh
        geometry={geometry.head}
        material={skin}
        position={[0, 1.26 * build - pose.crouch, pose.lean * 0.3]}
        castShadow={detailed}
      />

      {/* The hard hat is the strongest silhouette cue at distance, so it stays
          on dim floors while everything else simplifies. The brim does not —
          it is a detail you read up close, and it casts the shadow across the
          face that sells the hat as a hat. */}
      <mesh
        geometry={detailed ? geometry.helmet : geometry.helmetLow}
        material={helmet}
        position={[0, 1.4 * build - pose.crouch, pose.lean * 0.3]}
        castShadow={detailed}
      />
      {detailed && (
        <mesh
          geometry={geometry.helmetBrim}
          material={helmet}
          position={[0, 1.4 * build - pose.crouch, pose.lean * 0.3 + 0.02]}
          castShadow
        />
      )}

      {detailed && (
        <>
          {/* Arms pivot at the shoulder, same reason as the hips, and each
              carries a cuff and a glove. The cuff is what makes a swinging arm
              read at distance: it is the only part of the limb bright enough
              to track against the vest. */}
          <group position={[-0.27 * build, 1.06 * build - pose.crouch, 0]}>
            <group ref={armL}>
              <mesh geometry={geometry.arm} material={vest} position={[0, -0.21, 0]} castShadow />
              <mesh
                geometry={geometry.armBand}
                material={workerMaterials.band}
                position={[0, -0.34, 0]}
              />
              <mesh
                geometry={geometry.glove}
                material={workerMaterials.glove}
                position={[0, -0.46, 0]}
                castShadow
              />
            </group>
          </group>
          <group position={[0.27 * build, 1.06 * build - pose.crouch, 0]}>
            <group ref={armR}>
              <mesh geometry={geometry.arm} material={vest} position={[0, -0.21, 0]} castShadow />
              <mesh
                geometry={geometry.armBand}
                material={workerMaterials.band}
                position={[0, -0.34, 0]}
              />
              <mesh
                geometry={geometry.glove}
                material={workerMaterials.glove}
                position={[0, -0.46, 0]}
                castShadow
              />
            </group>
          </group>

          {/* Two torso bands, not one. A single stripe reads as a belt; a pair
              reads as workwear, and a pair is what a real vest carries. */}
          <mesh
            geometry={geometry.band}
            material={workerMaterials.band}
            position={[0, 0.86 * build - pose.crouch, 0]}
            rotation={[pose.lean, 0, 0]}
          />
          <mesh
            geometry={geometry.band}
            material={workerMaterials.band}
            position={[0, 0.75 * build - pose.crouch, 0]}
            rotation={[pose.lean, 0, 0]}
          />
        </>
      )}
    </group>
  );
}

export const SimWorker = memo(
  SimWorkerImpl,
  (a, b) =>
    a.index === b.index &&
    a.activity === b.activity &&
    a.detailed === b.detailed &&
    a.selected === b.selected &&
    a.controlledName === b.controlledName,
);
