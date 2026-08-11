import { useEffect, useRef } from 'react';
import { Html, RoundedBox } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { clearWatchAnchor, publishWatchAnchor } from '@/scene/building/watchAnchor';
import type { WatchAlert } from '@/ui/hud/WatchFace';
import { WatchFace } from '@/ui/hud/WatchFace';

/**
 * The watch on a worker's wrist, close enough to read and to press.
 *
 * The screen is real DOM, positioned in 3D by drei's transform mode, rather
 * than a canvas texture painted onto a plane. Two reasons, and the second is
 * the one that decided it: a texture at this size is a blurry approximation of
 * type that the app renders crisply, and a texture cannot be *pressed* — every
 * button would need its own invisible mesh, its own raycast, and its own hover
 * state, reimplementing what a browser already does correctly. What the
 * operator taps here is the same markup the handset would render.
 *
 * `distanceFactor` keeps the screen's apparent size tied to the camera, so the
 * face stays legible while the camera is still flying in rather than starting
 * as a speck and resolving late.
 *
 * Only ever mounted for the one worker in close-up. Sixty of these would be
 * sixty DOM subtrees transformed every frame.
 */

export type WristWatchProps = {
  alert: WatchAlert;
  busy: boolean;
  onAcknowledge(): void;
  onSnooze(minutes: number): void;
  onReject(): void;
  onClose(): void;
};

/**
 * Where the watch sits on the forearm, in the arm group's own space.
 *
 * The arm pivots at the shoulder and hangs down -y, so this is a point along
 * it just short of the glove. Because it is parented to the arm, the raised
 * pose carries it — no offset here has to know that the arm lifts, and the
 * camera reads the result rather than predicting it.
 *
 * The group is deliberately *unrotated*. The arm's own -1.32 rad lift already
 * turns its +z — the glass normal — to point up and slightly forward, which is
 * exactly where a raised forearm puts a watch face: toward the wearer's eyes.
 * An earlier quarter-turn here "to face outward" fought that and left the
 * glass pointing at the worker's ribs, with the camera obediently framing
 * their back.
 */
const ON_FOREARM: [number, number, number] = [0, -0.38, 0.055];

export function WristWatch(props: WristWatchProps) {
  const anchor = useRef<Group>(null);

  // The rig reads this every frame; a stale anchor would leave the camera
  // pointing at a wrist that has walked away.
  useFrame(() => {
    if (anchor.current) publishWatchAnchor(anchor.current);
  });

  useEffect(() => clearWatchAnchor, []);

  return (
    <group ref={anchor} position={ON_FOREARM}>
      {/* The case, at the size a watch actually is — about 42 mm across. It
          was authored at 110 mm, which read as a dark plank strapped to the
          forearm from every angle except the one that framed the screen. */}
      <RoundedBox args={[0.042, 0.05, 0.012]} radius={0.009} smoothness={3} castShadow>
        <meshStandardMaterial color="#23272e" metalness={0.55} roughness={0.35} />
      </RoundedBox>

      {/* the crown */}
      <mesh position={[0.024, 0.008, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.0035, 0.0035, 0.008, 10]} />
        <meshStandardMaterial color="#6b727c" metalness={0.8} roughness={0.3} />
      </mesh>

      {/* the strap, disappearing into the sleeve both ways */}
      {[0.042, -0.042].map((y) => (
        <mesh key={y} position={[0, y, -0.002]}>
          <boxGeometry args={[0.03, 0.036, 0.011]} />
          <meshStandardMaterial color="#1b1f25" roughness={0.85} />
        </mesh>
      ))}

      {/*
        The screen, anchored to the watch but facing the viewer.

        Not `transform` mode. Perspective-mapping the DOM onto the watch face
        is the more literal thing and it did not survive contact with a moving
        character: the face on a raised forearm ends up near edge-on to the
        camera, so the transformed element was correctly positioned, correctly
        sized, and rendered as an invisible sliver — and `occlude` had already
        hidden it once behind the very sleeve it is strapped to.

        Screen-space keeps every property that matters: it tracks the watch as
        the worker walks, it is crisp at any distance, and the buttons are real
        buttons. What it gives up is the perspective skew, which was never the
        point — being able to read the alert and press Acknowledge was.
      */}
      <Html
        center
        position={[0, 0, 0.02]}
        zIndexRange={[100, 0]}
        className="wrist-html"
        // Pointer events must reach the buttons, but the canvas behind must
        // not receive the same click and reframe the camera.
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="wrist-screen">
          <WatchFace {...props} />
        </div>
      </Html>
    </group>
  );
}
