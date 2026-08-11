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
 * The screen is real DOM, mapped onto the watch face in 3D. It is the app's own
 * markup — same copy, same buttons — because a viewer told "this is what the
 * worker sees" should be looking at what the worker sees, and because a texture
 * cannot be *pressed* without reimplementing hit-testing a browser already does.
 *
 * **The scale is a deliberate cheat, and here is the arithmetic.** A real 42 mm
 * watch face viewed from a comfortable 40 cm occupies about a tenth of the
 * frame — perhaps seventy pixels tall. Nobody can read an alert in that, and
 * the honest fix (put the camera 9 cm away) frames a wrist and no person. So
 * the device is a chunky 70 mm industrial wearable, which real rugged wrist
 * units genuinely are, and the camera sits close. That buys a screen filling
 * most of the frame's height with the hand and sleeve still around it.
 *
 * The previous attempt got both halves of this wrong: it asked for a 21 cm
 * screen on a 4 cm case, so the DOM floated over the worker's chest with no
 * apparent connection to the wrist at all.
 *
 * The watch lies flat on the forearm and does not turn. With the arm raised,
 * its glass already points up and slightly forward — which is where a person's
 * eyes are when they check the time — so the camera goes *there*, above the
 * wrist looking down, rather than the watch swivelling to meet the lens.
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
const ON_FOREARM: [number, number, number] = [0, -0.36, 0.05];

/**
 * CSS pixels per world metre, expressed the way drei wants it.
 *
 * In transform mode drei scales the DOM by `400 / distanceFactor`, so a
 * `distanceFactor` of 0.124 maps the 200px-wide screen to about 62 mm — the
 * glass of a 70 mm case. Getting this wrong is not subtle: at the previous
 * 0.42 the same div spanned 21 cm.
 */
const SCREEN_DISTANCE_FACTOR = 0.124;

export function WristWatch(props: WristWatchProps) {
  const anchor = useRef<Group>(null);

  // The rig reads this every frame; a stale anchor would leave the camera
  // pointing at a wrist that has walked away.
  useFrame(() => {
    const group = anchor.current;
    if (!group) return;
    // Left lying on the forearm, where a watch lives. It used to turn to face
    // the camera each frame, which kept the screen square to the lens and made
    // the device look pasted on rather than worn — the camera goes to the
    // watch now instead of the watch coming to the camera.
    publishWatchAnchor(group);
  });

  useEffect(() => clearWatchAnchor, []);

  return (
    <group ref={anchor} position={ON_FOREARM}>
      {/* The case, at the size a watch actually is — about 42 mm across. It
          was authored at 110 mm, which read as a dark plank strapped to the
          forearm from every angle except the one that framed the screen. */}
      <RoundedBox args={[0.07, 0.082, 0.018]} radius={0.014} smoothness={4} castShadow>
        <meshStandardMaterial color="#23272e" metalness={0.55} roughness={0.35} />
      </RoundedBox>

      {/* the crown */}
      <mesh position={[0.039, 0.012, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.006, 0.006, 0.012, 12]} />
        <meshStandardMaterial color="#6b727c" metalness={0.8} roughness={0.3} />
      </mesh>

      {/* the strap, disappearing into the sleeve both ways */}
      {[0.068, -0.068].map((y) => (
        <mesh key={y} position={[0, y, -0.004]}>
          <boxGeometry args={[0.05, 0.058, 0.016]} />
          <meshStandardMaterial color="#1b1f25" roughness={0.85} />
        </mesh>
      ))}

      {/*
        The screen, mapped onto the glass.

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
        transform
        distanceFactor={SCREEN_DISTANCE_FACTOR}
        position={[0, 0, 0.0105]}
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
