import { Vector3 } from 'three';

/**
 * Requests to move the camera, from anywhere to the rig.
 *
 * Same channel pattern as `watchAnchor`, and for the same reason: the thing
 * that knows *where a machine is* is a panel or a mesh, and the thing that
 * moves the camera is the rig. Routing a world position between them through
 * React would re-render the building to move a camera.
 *
 * **Its own module, deliberately.** This lived in `Scene.tsx`, which `App.tsx`
 * imports as `./scene/Scene` and the machine dialog imports as
 * `@/scene/Scene`. Those are the same file and, in dev, two module instances —
 * so the dialog bumped a token on a copy of this object that the rig was not
 * reading, and "Go to it" moved nothing. A module with one obvious specifier
 * cannot be imported two ways by accident, and UI code has no business
 * importing the Scene component just to reach a function.
 */

export const cameraFocus = {
  /** bumped on each request, so the rig can tell a new one from a repeat */
  token: 0,
  target: new Vector3(),
  /** how close to sit, in metres */
  distance: 4,
};

/** Fly the camera to a point and hold there. */
export function focusCameraOn(x: number, y: number, z: number, distance = 4): void {
  cameraFocus.target.set(x, y, z);
  cameraFocus.distance = distance;
  cameraFocus.token += 1;
}

/** Hand the camera back to the dollhouse framing. */
export const cameraReset = { token: 0 };

export function resetCamera(): void {
  cameraReset.token += 1;
}
