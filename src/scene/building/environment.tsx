import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
// three-stdlib ships this without a construct signature in its types, so the
// class is imported from three's own examples where it is typed correctly.
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * The reason the scene stopped looking like plastic.
 *
 * Every surface until now was lit by analytic lights only — a key, a fill, a
 * rim and some lamps. Under that alone `metalness` does almost nothing, because
 * a metal's appearance *is* its reflection of the surroundings and there were
 * no surroundings to reflect: a metal with nothing to mirror renders as a dark
 * matte solid. So brushed guards, galvanised rail, painted steel and concrete
 * all resolved to the same flat shading, separated only by base colour. That is
 * the single largest thing that makes a real-time scene read as dated.
 *
 * An environment map fixes it globally. `RoomEnvironment` builds a small lit
 * box in memory — no file, no network, nothing to ship — and PMREM prefilters
 * it into the roughness-aware probe the standard material samples. Rough
 * surfaces pick up a broad wash of it, smooth ones a tight highlight, and the
 * difference between two materials finally shows.
 *
 * It is prefiltered once and disposed on unmount. The generator holds a render
 * target and the environment holds its own geometry; leaving either behind
 * leaks GPU memory across a hot reload, which is exactly when nobody notices.
 */
export function SceneEnvironment({ intensity = 0.55 }: { intensity?: number }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    pmrem.compileEquirectangularShader();

    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    scene.environment = target.texture;
    /*
      Below 1, deliberately. A full-strength probe lights every surface evenly
      and flattens the value structure the palette is built on — the lit deck
      stops being three steps brighter than everything else, which is the one
      thing that tells you where to look. This adds the reflection without
      taking over the lighting.
    */
    scene.environmentIntensity = intensity;

    return () => {
      scene.environment = null;
      target.dispose();
      room.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, intensity]);

  return null;
}
