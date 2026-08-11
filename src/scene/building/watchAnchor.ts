import * as THREE from 'three';

/**
 * Where the watch actually is, this frame, in world space.
 *
 * Written by the watch itself and read by the camera rig — two components in
 * different subtrees that must agree to within a centimetre or the close-up
 * frames a shoulder.
 *
 * They used to agree by *arithmetic*: the rig recomputed the wrist from the
 * worker's position, facing and a hardcoded arm offset. That is three chances
 * to be wrong about one thing, and it was — the worker's build scales per
 * person and the raised forearm swings the wrist forward by nearly half a
 * metre, so the camera framed the back of a head while the watch hung in front
 * of a face. Reading the real matrix removes the class of bug rather than
 * fixing this instance of it: the watch is parented to the arm, so wherever
 * the animation puts it is where the camera looks.
 *
 * Module-level mutable state, deliberately. This is per-frame data on the
 * render path — routing it through React or a store would re-render the
 * building sixty times a second to move a camera.
 */

export const watchAnchor = {
  /** true only while a watch is mounted and has written a position */
  active: false,
  /** the centre of the watch face */
  position: new THREE.Vector3(),
  /**
   * The watch's full world orientation.
   *
   * A normal alone was not enough: on a raised forearm it points almost
   * straight up, which put the camera directly overhead looking down a
   * near-vertical axis — an angle nobody reads a watch from, and one step from
   * gimbal-flipping `lookAt`. With the whole orientation the rig can express
   * its framing in the watch's own space ("out of the glass, and a little
   * toward the hand"), which stays sane whatever the arm is doing.
   */
  quaternion: new THREE.Quaternion(),
};

/** Called by the watch each frame. */
export function publishWatchAnchor(object: THREE.Object3D): void {
  object.getWorldPosition(watchAnchor.position);
  object.getWorldQuaternion(watchAnchor.quaternion);
  watchAnchor.active = true;
}

/** Called when the watch unmounts, so the rig hands control back. */
export function clearWatchAnchor(): void {
  watchAnchor.active = false;
}
