import { useRef, useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Building } from '@/scene/building/Building';
import type { Agents } from '@/sim/agents';
import type { WatchBinding } from '@/scene/building/Building';
import { watchAnchor } from '@/scene/building/watchAnchor';
import type { SiteDef } from '@/sites/types';
import { BUILDING_CAMERA, buildingCamera } from '@/scene/building/camera';
import { themeFor } from '@/styles/theme';
import { useBuildingStore } from '@/state/buildingStore';
import { SceneEnvironment } from '@/scene/building/environment';
import { PostFx } from '@/scene/building/PostFx';
import { Surroundings } from '@/scene/building/Surroundings';

// Shared drag-vs-click state between CameraRig and Scene (same module)
const _dragState = { wasDragging: false };

/**
 * Lighting a building rather than a room.
 *
 * The previous rig put every point light at y≈5, which lit one floor and left
 * the other five in shadow. Each floor now carries its own pair of ceiling
 * lights at its own elevation, so the stack is legible top to bottom — and the
 * key light's shadow frustum is widened to cover the full height, or floors
 * above the old 14 m box would have cast nothing.
 */
function Lights({ site }: { site: SiteDef }) {
  const activeFloorId = useBuildingStore((s) => s.activeFloorId);
  const theme = themeFor(site);
  const topElevation = site.floors[site.floors.length - 1].elevation;
  const activeIndex = Math.max(0, site.floors.findIndex((f) => f.id === activeFloorId));

  return (
    <>
      {/*
        Daylight, not a dark room.

        The rig is built the way an exterior actually works: one hard sun doing
        nearly all the modelling, a broad sky term filling the shadows from
        above, and a bounce off the ground filling them from below. That is what
        makes a scene read as outdoors — a shadow that is *blue* because the sky
        is what fills it, not merely darker than the lit side.

        The sun sits high and slightly to one side so the building's own
        floors cast across each other and the depth of a deck is legible from
        the shadow its ceiling throws.
      */}
      <hemisphereLight args={[theme.skyLight, theme.groundBounce, 0.8]} />
      <ambientLight intensity={theme.ambientIntensity} color={theme.ambient} />
      <directionalLight
        position={[-22, topElevation + 26, 24]}
        intensity={theme.sunIntensity}
        color={theme.sunColor}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0006}
        shadow-camera-near={0.5}
        shadow-camera-far={160}
        // Tight to the building. Widening this to cover the city spread the
        // same 2048 map over four times the area and softened the one shadow
        // that matters.
        shadow-camera-left={-26}
        shadow-camera-right={26}
        shadow-camera-top={topElevation + 18}
        shadow-camera-bottom={-10}
      />
      {/* A cool bounce from the open front, so the cutaway face is not flat. */}
      <directionalLight position={[16, topElevation * 0.5, 30]} intensity={0.4} color={theme.skyLight} />

      {site.floors.map((floor, i) => (
        <group key={floor.id} position={[0, floor.elevation, 0]}>
          {/*
            Interior lamps, much dimmer than they were against a dark sky.

            In daylight these are not what makes a floor visible — the sun is.
            Their job is to warm the deck being looked at so it separates from
            the ones above and below, and at the old intensity they blew it out.
          */}
          <pointLight
            position={[0, 2.9, -6]}
            intensity={i === activeIndex ? theme.lampIntensity * 2.6 : theme.lampIntensity}
            distance={i === activeIndex ? 26 : 20}
            color={theme.lampColor}
          />
        </group>
      ))}
    </>
  );
}

/** Roughly a standing person's eye height above a slab. */
const EYE_HEIGHT = 2.4;

/** How far the view may swing off the cutaway face, radians. */
const MAX_AZIMUTH = 1.26;

/**
 * How much of the driven worker's x the camera takes up. Full tracking made
 * the building slide across the frame every time he stepped sideways; a
 * fraction keeps him in shot without the structure appearing to move.
 */
const FOLLOW_X = 0.55;

/**
 * Where the camera sits when it is looking at a worker's watch.
 *
 * Read off the watch's own world matrix rather than recomputed from the
 * worker's position and a hardcoded arm offset. That earlier arithmetic had
 * three chances to disagree with the animation — build scale, the raised
 * forearm's forward swing, and the facing rotation — and it disagreed by
 * enough to frame the back of a head.
 */

/**
 * How the close-up is framed.
 *
 * Position comes from the watch's real world matrix. *Direction* is the
 * horizontal vector from the worker's own feet out to the watch, extended —
 * so the camera is always on the far side of the wrist from the body, and the
 * worker can never be standing between the lens and their own screen.
 *
 * Two earlier attempts failed on exactly that. Backing off along the glass
 * normal parked the camera overhead, because a raised forearm points its face
 * at the sky. Backing off along the worker's heading put it *inside their
 * torso*, since which side of the body the wrist is on is not something a
 * heading tells you. The body-to-wrist vector answers the question directly
 * and needs no convention to be right about.
 */

/**
 * How far past the watch the camera sits, in metres.
 *
 * Close. The screen has to fill enough of the frame to be read, and the
 * arithmetic for that is in `WristWatch` — this is the other half of it. Far
 * enough that the hand and sleeve are still in shot, near enough that the
 * alert is legible.
 */
const CLOSE_UP_OUT = 0.19;

/** How much of the framing comes from the watch's own upward normal. */
const OVERHEAD = 0.94;

/** And how much leans away from the body, to keep the chest out of shot. */
const LEAN = 0.34;

/** Squared metres within which the camera stops easing and simply arrives. */
const SETTLE_EPSILON = 0.0004;

function CameraRig({
  follow,
  closeUpRoot,
}: {
  follow: (() => { x: number; z: number; floorId: string } | null) | null;
  /** where the close-up worker is standing, or null when there is no close-up */
  closeUpRoot: (() => { x: number; z: number; facing: number } | null) | null;
}) {
  const { gl } = useThree();
  const site = useBuildingStore((s) => s.site);
  const activeFloorId = useBuildingStore((s) => s.activeFloorId);
  const framing = useMemo(() => buildingCamera(site), [site]);

  // Scratch vectors for the close-up framing, reused rather than allocated
  // sixty times a second.
  const closeUpNormal = useRef(new THREE.Vector3()).current;
  const closeUpDir = useRef(new THREE.Vector3()).current;
  const closeUpUp = useRef(new THREE.Vector3()).current;

  const targetPos   = useRef(new THREE.Vector3(...BUILDING_CAMERA.position));
  const targetLook  = useRef(new THREE.Vector3(...BUILDING_CAMERA.target));
  const currentLook = useRef(new THREE.Vector3(...BUILDING_CAMERA.target));

  // Zoom (scroll wheel, overview only)
  const zoomRef = useRef(1.0);

  // Spherical orbit around the active floor. The elevation starts nearly level
  // so the camera looks INTO a floor rather than down onto its ceiling.
  const azimuthRef   = useRef(0);
  const elevationRef = useRef(0.10);

  useEffect(() => {
    const canvas = gl.domElement;
    let isDragging = false;
    let dragDist   = 0;
    let lastX      = 0;
    let lastY      = 0;

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      dragDist = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      _dragState.wasDragging = false;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      dragDist += Math.sqrt(dx * dx + dy * dy);
      lastX = e.clientX;
      lastY = e.clientY;

      if (dragDist > 5) _dragState.wasDragging = true;

      // Only rotate in overview mode and once past small threshold
      if (dragDist > 3) {
        /*
          Clamped, because there is nothing behind a cutaway.

          The dollhouse dims every floor except the one in focus, so from
          behind the building is five dark walls and no interior at all — the
          dimming that makes the front readable is exactly what makes the back
          useless. Orbiting far enough to lose the open face was never a view
          worth having; ±72° gives the parallax that makes the stack read as
          solid while keeping every floor's contents in sight.
        */
        azimuthRef.current = Math.max(
          -MAX_AZIMUTH,
          Math.min(MAX_AZIMUTH, azimuthRef.current - dx * 0.005),
        );
        // Drag up (dy < 0) = camera elevates higher → elevation increases
        elevationRef.current  = Math.max(0.05, Math.min(1.2, elevationRef.current - dy * 0.004));
      }
    };

    const onPointerUp = () => { isDragging = false; };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomRef.current = Math.max(0.45, Math.min(2.2, zoomRef.current + e.deltaY * 0.0007));
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup',   onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup',   onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [gl]);

  useFrame(({ camera }) => {
    // Per-target focus (a worker's watch, a machine close-up) was a table of
    // hand-placed camera positions for a fixed cast in a single room. Workers
    // move now and there are sixty of them, so focus is rebuilt in Phase 2B
    // against live agent positions rather than resurrected from a table.
    {
      /*
        The camera rides the active floor, roughly at eye level with it.

        Framing the whole stack from above looked correct in a still and was
        useless in motion: viewed from above the mid-line, every floor's back
        half is hidden by the slab above it, so half the workers were behind a
        ceiling. Sitting level with the active floor opens it up completely,
        and the floors above and below stay in frame as context — which is what
        makes clicking one of them mean something.
      */
      /*
        While somebody is being driven the camera follows him, because a
        character you can walk out of frame is a character you lose. It follows
        in x only and keeps the framing rules otherwise — swinging the whole
        rig to chase him would throw away the dollhouse read that makes the
        stack legible.
      */
      /*
        Close-up wins over everything else.

        Computed each frame rather than once on entry, because the worker keeps
        living — they finish a job, they turn — and a camera that locked to
        where they were standing a second ago would drift off the watch it was
        summoned to look at.
      */
      const near = closeUpRoot?.() ?? null;
      if (near && watchAnchor.active) {
        /*
          Above the wrist, looking down — the angle a person reads their own
          watch from.

          The direction is mostly the glass's own normal, which a raised
          forearm already points skyward, plus a lean away from the body. The
          lean is doing two jobs: it keeps the worker's own chest out of the
          shot, and it stops the view being exactly vertical, where `lookAt`
          has no stable idea of which way is up and the frame can roll.
        */
        closeUpNormal.set(0, 0, 1).applyQuaternion(watchAnchor.quaternion);

        const outX = watchAnchor.position.x - near.x;
        const outZ = watchAnchor.position.z - near.z;
        const spread = Math.hypot(outX, outZ);
        const awayX = spread > 0.05 ? outX / spread : Math.sin(near.facing);
        const awayZ = spread > 0.05 ? outZ / spread : Math.cos(near.facing);

        closeUpDir
          .set(
            closeUpNormal.x * OVERHEAD + awayX * LEAN,
            closeUpNormal.y * OVERHEAD,
            closeUpNormal.z * OVERHEAD + awayZ * LEAN,
          )
          .normalize();

        targetLook.current.copy(watchAnchor.position);
        targetPos.current
          .copy(watchAnchor.position)
          .addScaledVector(closeUpDir, CLOSE_UP_OUT);

        // Snappier than the overview lerp: this is a deliberate move to a
        // specific thing, and easing in over two seconds reads as a bug.
        camera.position.lerp(targetPos.current, 0.12);
        currentLook.current.lerp(targetLook.current, 0.12);

        /*
          And then it actually lands.

          A lerp approaches asymptotically and never arrives, so the watch
          screen — real DOM anchored to a projected point — drifted by a
          fraction of a pixel every frame, forever. That is invisible and it
          matters: Playwright refuses to click a target whose box changes
          between frames, which is a fair description of what a person
          experiences trying to press a button that will not hold still.
        */
        if (camera.position.distanceToSquared(targetPos.current) < SETTLE_EPSILON) {
          camera.position.copy(targetPos.current);
          currentLook.current.copy(targetLook.current);
        }

        /*
          The camera rolls to match the watch, not the world.

          A watch lies on a forearm at whatever angle the arm is holding, so
          looking straight down at one with a world-up camera renders the
          screen on the diagonal — the text ran corner to corner, which is
          nobody's idea of reading their wrist. Taking the up vector from the
          watch's own local up puts the display upright in frame however the
          arm is turned.
        */
        closeUpUp.set(0, 1, 0).applyQuaternion(watchAnchor.quaternion);
        camera.up.copy(closeUpUp);
        camera.lookAt(currentLook.current);
        return;
      }

      // Back to world up for every other framing — a rolled overview would be
      // the close-up leaking out of itself.
      camera.up.set(0, 1, 0);

      const driven = follow?.() ?? null;
      const activeFloor =
        site.floors.find((f) => f.id === (driven?.floorId ?? activeFloorId)) ??
        site.floors[0];
      /*
        Tracking the active floor exactly put the building against the top of
        the frame on floor 1 and the bottom on floor 6, with a third of the
        viewport empty on the other side. Pulling the look-point partway back
        toward the middle of the stack keeps the composition centred while
        still moving nearly ten metres across the range — the camera visibly
        rides the floor you picked, it just does not abandon the building.
      */
      const look = new THREE.Vector3(
        driven ? driven.x * FOLLOW_X : framing.target[0],
        THREE.MathUtils.lerp(
          framing.stackMidHeight,
          activeFloor.elevation + EYE_HEIGHT,
          0.22,
        ),
        framing.target[2],
      );
      const dist = framing.distance * zoomRef.current;

      const az = azimuthRef.current;
      const el = elevationRef.current;
      const dir = new THREE.Vector3(
        Math.sin(az) * Math.cos(el),
        Math.sin(el),
        Math.cos(az) * Math.cos(el),
      );

      targetPos.current.copy(look).addScaledVector(dir, dist);
      targetLook.current.copy(look);
    }

    camera.position.lerp(targetPos.current, 0.055);
    currentLook.current.lerp(targetLook.current, 0.055);
    camera.lookAt(currentLook.current);
  });

  return null;
}

/**
 * Dev handle on the render tree, beside `__building` and `__sim`.
 *
 * Added because a frame-time regression could not be bisected from outside:
 * without a way to hide one group and re-measure, diagnosing "what costs
 * 12 ms" is guesswork, and I had already spent two wrong guesses on it.
 */
function DevSceneHandle() {
  const { scene, gl, camera } = useThree();
  useEffect(() => {
    (window as unknown as { __scene: unknown }).__scene = { scene, gl, camera, watchAnchor };
    return () => {
      delete (window as unknown as { __scene?: unknown }).__scene;
    };
  }, [scene, gl]);
  return null;
}

function SceneContents({
  agents,
  controlled,
  watch,
}: {
  agents: Agents | null;
  controlled: { index: number; name: string } | null;
  watch: WatchBinding | null;
}) {
  const site = useBuildingStore((s) => s.site);
  const theme = themeFor(site);
  // Read on the frame rather than passed as a value: his position changes
  // sixty times a second and must never go through React.
  const follow = useMemo(() => {
    if (!agents || !controlled) return null;
    return () => {
      const state = agents.controlledState();
      return state
        ? { x: state.position.x, z: state.position.z, floorId: state.floorId }
        : null;
    };
  }, [agents, controlled]);

  /*
    The close-up worker's heading, read on the frame — they keep turning while
    the camera flies in. Where the watch *is* comes from `watchAnchor`, written
    by the watch itself, so the two can never drift apart.
  */
  const closeUpIndex = useBuildingStore((s) => s.closeUpIndex);
  const closeUpRoot = useMemo(() => {
    if (!agents || closeUpIndex === null) return null;
    return () => {
      const state = agents.stateFor(closeUpIndex);
      return state
        ? { x: state.position.x, z: state.position.z, facing: state.facing }
        : null;
    };
  }, [agents, closeUpIndex]);

  return (
    <>
      <color attach="background" args={[theme.sky]} />
      {/* Fog to the theme's haze rather than the sky, so distant blocks fade
          into atmosphere instead of dissolving into the backdrop. */}
      <fog attach="fog" args={[theme.haze, 70, 240]} />
      <SceneEnvironment intensity={theme.envIntensity} />
      <Lights site={site} />
      <CameraRig follow={follow} closeUpRoot={closeUpRoot} />
      {/*
        The building replaces the single-room factory entirely. Until agents
        exist — the setup screen has not finished provisioning — the site is
        still drawn, so the scene is never blank while sixty accounts register.
      */}
      <DevSceneHandle />
      <Surroundings site={site} />
      <Building site={site} agents={agents} controlled={controlled} watch={watch} />
      <PostFx />
    </>
  );
}

export function Scene({
  agents,
  watch,
  controlled,
}: {
  agents: Agents | null;
  controlled: { index: number; name: string } | null;
  watch: WatchBinding | null;
}) {
  return (
    <Canvas
      camera={{ position: BUILDING_CAMERA.position as [number,number,number], fov: 58,
        /*
          Two centimetres, not ten. The watch close-up puts the camera about
          19 cm from a 7 cm device, and at the old near plane the near edge of
          the case sat right on it — the glass clipped away as the camera
          settled.
        */
        near: 0.02,
        far: 260 }}
      /*
        Tone mapping is the single largest visual change available here.

        Without it three.js writes linear radiance straight to an 8-bit
        buffer, so anything the lights push past 1.0 clips to flat white and
        everything below sits in a narrow, chalky band — which is most of why
        a lit scene reads as "computer graphics". ACES filmic rolls the
        highlights off instead of cutting them, and the exposure is set below 1
        because the rig is deliberately bright: the lit deck should be the
        brightest thing in frame, not the only thing that survives.
      */
      gl={{
        antialias: true,
        alpha: false,
        toneMapping: THREE.ACESFilmicToneMapping,
        // Per theme: the two worlds are lit differently and want different
        // exposure. Read once at mount, which is when the site is already
        // chosen, and the canvas is not rebuilt mid-session.
        toneMappingExposure: themeFor(useBuildingStore.getState().site).exposure,
      }}
      shadows={{ type: THREE.PCFSoftShadowMap }}
      style={{
        background: themeFor(useBuildingStore.getState().site).sky,
        width: '100%',
        height: '100%',
      }}
      onPointerMissed={() => {
        _dragState.wasDragging = false;
      }}
    >
      <SceneContents agents={agents} controlled={controlled} watch={watch} />
    </Canvas>
  );
}
