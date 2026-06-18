import * as THREE from 'three';

// Written by Worker.tsx each frame when a worker is focused.
// Read by CameraRig in Scene.tsx (runs before workers, so reads previous frame).
// Plain mutable object — no React state, no re-renders.
export const watchFocusData = {
  valid: false,
  watchPos: new THREE.Vector3(),
  watchNormal: new THREE.Vector3(0, 0, 1),
};
