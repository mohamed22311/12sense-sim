import { useMemo } from 'react';
import * as THREE from 'three';
import type { SiteDef } from '@/sites/types';
import { themeFor } from '@/styles/theme';
import { roundedBox } from '@/scene/building/roundedBox';

/**
 * The city the building stands in.
 *
 * It began as a ground plane and six grey slabs, which grounded the stack but
 * did not place it anywhere — a building alone on a pad reads as a model, and
 * the demo is meant to read as a site. What makes somewhere look like a real
 * district is not detail on any one block: it is that the blocks differ in
 * height, depth, colour and *setback*, that roads run between them, and that
 * the far ones fade into haze rather than ending at a hard edge.
 *
 * Everything here is still deliberately quiet. The moment a neighbouring tower
 * is interesting enough to look at, it is competing with the sixty people the
 * demo is actually about, so the city stays low in saturation and reads as
 * context in peripheral vision.
 */

/** Deterministic 0..1, so the skyline is identical every run. */
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

type Block = { x: number; z: number; w: number; d: number; h: number; tone: number };

/**
 * A ring of blocks around the site, denser and taller further back.
 *
 * Placed on a grid with a jittered setback rather than at random: a real
 * district has streets, and blocks that ignore them read as scattered boxes.
 * Nothing is placed in front of the cutaway face — that view is the whole
 * product and must never have anything standing in it.
 */
function layout(top: number): Block[] {
  const blocks: Block[] = [];
  let n = 0;

  /*
    Two rings, not three.

    Measured rather than guessed: bisecting the scene by hiding groups showed
    the surroundings' 34 meshes costing as much per frame as the building's
    905. That is fill rate, not geometry — large surfaces covering the whole
    screen — so the fix is less area, not fewer objects. A third ring sat
    almost entirely behind the second and cost a full screen of overdraw for a
    skyline you cannot pick out.
  */
  for (let ring = 0; ring < 2; ring++) {
    const radius = 48 + ring * 34;
    const count = 9 + ring * 5;
    for (let i = 0; i < count; i++) {
      n += 1;
      const angle = (i / count) * Math.PI * 2 + hash(n) * 0.22;
      // Only behind and to the sides: the open face looks down +z.
      const x = Math.sin(angle) * radius * (0.9 + hash(n + 100) * 0.3);
      const z = Math.cos(angle) * radius * (0.9 + hash(n + 200) * 0.3) - 20;
      if (z > -14 && Math.abs(x) < 34) continue;

      // Taller further out, so the skyline builds rather than walling the site.
      const height = top * (0.4 + hash(n + 300) * 0.95) * (1 + ring * 0.4);
      blocks.push({
        x,
        z,
        w: 10 + hash(n + 400) * 16,
        d: 10 + hash(n + 500) * 16,
        h: height,
        tone: Math.floor(hash(n + 600) * 3),
      });
    }
  }
  return blocks;
}

export function Surroundings({ site }: { site: SiteDef }) {
  const theme = themeFor(site);
  const { minX, maxX, minZ, maxZ } = site.floors[0].bounds;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;
  const top = site.floors[site.floors.length - 1].elevation + site.floorHeight;

  const blocks = useMemo(() => layout(top), [top]);

  const materials = useMemo(() => {
    const tones = theme.neighbours.map(
      (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.92 }),
    );
    return {
      tones,
      ground: new THREE.MeshStandardMaterial({ color: theme.ground, roughness: 0.97 }),
      apron: new THREE.MeshStandardMaterial({ color: theme.apron, roughness: 0.94 }),
      road: new THREE.MeshStandardMaterial({ color: theme.roadway, roughness: 0.96 }),
    };
  }, [theme]);

  // One geometry per block, built once — thirty-odd boxes that never change.
  const geometries = useMemo(
    () => blocks.map((b) => roundedBox(b.w, b.h, b.d, 0.3)),
    [blocks],
  );

  return (
    <group>
      {/*
        The wider ground, which does NOT receive shadows.

        It fills most of the screen, and a shadow-receiving fragment pays for a
        filtered shadow-map lookup — turning it on here cost 12 ms a frame for
        shadows falling on distant tarmac nobody looks at. The apron below does
        receive, because that is where the building's own shadow actually lands
        and that shadow is what grounds the stack.
      */}
      <mesh position={[midX, -0.42, midZ - 30]} rotation={[-Math.PI / 2, 0, 0]}>
        {/* Sized to what the camera can actually see. At 420 it was covering
            the screen several times over in overdraw for no visible gain. */}
        <planeGeometry args={[230, 230]} />
        <primitive object={materials.ground} attach="material" />
      </mesh>

      {/* Two roads crossing in front of and beside the site, which is what
          turns a field of blocks into a district. */}
      <mesh position={[midX, -0.39, maxZ + 16]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[210, 13]} />
        <primitive object={materials.road} attach="material" />
      </mesh>
      <mesh
        position={[minX - 22, -0.39, midZ - 20]}
        rotation={[-Math.PI / 2, 0, Math.PI / 2]}
      >
        <planeGeometry args={[170, 11]} />
        <primitive object={materials.road} attach="material" />
      </mesh>

      {/* The yard immediately around the footprint, so the building meets a
          hardstanding rather than an edge. */}
      <mesh position={[midX, -0.36, midZ]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width + 22, depth + 22]} />
        <primitive object={materials.apron} attach="material" />
      </mesh>

      {blocks.map((b, i) => (
        <mesh
          key={i}
          geometry={geometries[i]}
          material={materials.tones[b.tone]}
          position={[b.x, b.h / 2 - 0.4, b.z]}
          /*
            No shadows on the city, deliberately.

            Every caster is re-rendered into the shadow map, and thirty blocks
            took the frame from 17 ms to 30 ms for shadows that fall on distant
            ground nobody is looking at. The building still casts — that shadow
            is what grounds it — and the map's resolution now goes entirely to
            the thing the demo is about.
          */
        />
      ))}
    </group>
  );
}
