import { memo, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import type { MachineDef } from '@/sites/types';
import {
  furnaceGlow,
  machineGeometry as G,
  machineMaterials,
  siteGeometry as S,
  siteMaterials,
  type MachineMaterials,
  type SitePlantMaterials,
} from '@/scene/building/machineAssets';
import { SIGNAL, themeFor } from '@/styles/theme';
import { useBuildingStore } from '@/state/buildingStore';

/**
 * An alertable asset, drawn as the thing it actually is.
 *
 * Six kinds, six silhouettes. Until now three of them shared a body — a
 * packing line and a chiller were the same box in different places — which
 * matters more than it sounds: the demo's whole claim is that a dispatcher
 * sees *which* asset raised the alert, and a floor of identical boxes makes
 * the label the only thing carrying that. Now the shape carries it, and the
 * label confirms it.
 *
 * Silhouette does the work at distance, so each kind differs in its outline
 * first — the reactor is tall and round, the packer is long and low, the press
 * is a frame with a gap in it — and only then in surface detail.
 *
 * Motion is per-kind and only on the floor being looked at. A fan that spins
 * and a ram that cycles are what tell a running plant from a model of one; on
 * the five floors nobody is watching, they are frozen for free.
 */

export type SiteMachineProps = {
  def: MachineDef;
  /** the floor is the one being looked at: full detail, motion, label */
  active: boolean;
  /** this asset has an open alert — the lamp goes red and pulses */
  alerting?: boolean;
  onSelect?: (machineId: string) => void;
};

/** Where each kind's status lamp sits, and how far up the label floats. */
const LAMP_Y: Record<MachineDef['kind'], number> = {
  reactor: 2.5,
  chiller: 1.48,
  panel: 1.82,
  press: 2.42,
  packer: 1.98,
  furnace: 1.62,
  hoist: 2.4,
  crane: 2.6,
  generator: 1.5,
  pump: 1.4,
  welder: 1.6,
};

const green = new THREE.Color(SIGNAL.green);
const red = new THREE.Color(SIGNAL.red);

function SiteMachineImpl({ def, active, alerting = false, onSelect }: SiteMachineProps) {
  // Cloned per machine because each lamp carries its own state; everything
  // else on the machine is shared.
  const theme = themeFor(useBuildingStore((state) => state.site));
  const M = machineMaterials(theme);
  const SM = siteMaterials(theme);
  const lampMaterial = useMemo(() => M.lamp(), [M]);
  const [hovered, setHovered] = useState(false);
  const lamp = useRef<THREE.Mesh>(null);
  const spinner = useRef<THREE.Group>(null);
  const ram = useRef<THREE.Group>(null);
  const cartons = useRef<THREE.Group>(null);
  const clock = useRef(0);

  useFrame((_, delta) => {
    if (alerting) {
      // A slow pulse rather than a blink: it has to read as "attend to this",
      // not as a fault in the render.
      clock.current += delta * 3.2;
      const t = 0.55 + 0.45 * Math.sin(clock.current);
      lampMaterial.color.copy(red);
      lampMaterial.emissive.copy(red);
      lampMaterial.emissiveIntensity = 0.6 + t * 1.6;
      if (lamp.current) lamp.current.scale.setScalar(1 + t * 0.35);
    } else if (lampMaterial.emissive.equals(red)) {
      lampMaterial.color.copy(green);
      lampMaterial.emissive.copy(green);
      lampMaterial.emissiveIntensity = 1.1;
      if (lamp.current) lamp.current.scale.setScalar(1);
    }

    if (!active) return;
    clock.current += delta;
    if (spinner.current) spinner.current.rotation.z += delta * 7;
    if (ram.current) {
      // Two mechanisms, one ref. A press dwells at the bottom of its stroke;
      // a hoist cage runs the mast and pauses at each end. The kind decides.
      if (def.kind === 'hoist') {
        const t = (Math.sin(clock.current * 0.5) + 1) / 2;
        ram.current.position.y = 0.9 + t * 1.6;
      } else {
        const s = Math.max(0, Math.sin(clock.current * 1.6));
        ram.current.position.y = 1.62 - s * 0.5;
      }
    }
    if (cartons.current) {
      cartons.current.position.x = ((clock.current * 0.42) % 1.4) - 0.7;
    }
  });

  const select = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onSelect?.(def.id);
  };

  return (
    <group
      position={[def.position.x, 0, def.position.z]}
      rotation={[0, def.rotationY, 0]}
      onClick={select}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = '';
      }}
    >
      {def.kind === 'reactor' && <Reactor active={active} m={M} />}
      {def.kind === 'chiller' && <Chiller active={active} m={M} spinner={spinner} />}
      {def.kind === 'panel' && <Panel active={active} m={M} />}
      {def.kind === 'press' && <Press active={active} m={M} ram={ram} />}
      {def.kind === 'packer' && <Packer active={active} m={M} cartons={cartons} />}
      {def.kind === 'furnace' && <Furnace active={active} m={M} />}
      {def.kind === 'hoist' && <Hoist active={active} sm={SM} cage={ram} />}
      {def.kind === 'crane' && <Crane active={active} sm={SM} />}
      {def.kind === 'generator' && <Generator active={active} sm={SM} />}
      {def.kind === 'pump' && <ConcretePump active={active} sm={SM} />}
      {def.kind === 'welder' && <Welder active={active} sm={SM} spinner={spinner} />}

      <mesh ref={lamp} geometry={G.lamp} material={lampMaterial} position={[0, LAMP_Y[def.kind], 0]} />

      {alerting && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.05, 1.25, 32]} />
          <meshBasicMaterial color={SIGNAL.red} transparent opacity={0.65} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/*
        On demand, not always. Four labels a floor collided in screen space —
        the back row's names landed on the front row's — and a permanent field
        of floating text is clutter besides. The name appears when the pointer
        asks for it, and always for a machine in alarm, which is the one moment
        it must be readable without being hunted for. The HUD's machine list
        carries the full roster.
      */}
      {active && (hovered || alerting) && (
        <Text
          position={[0, LAMP_Y[def.kind] + 0.32, 0]}
          // Sized for the overview camera, ~30 m back. At 0.19 m it measured
          // four pixels tall — present in the render, unreadable on screen.
          fontSize={0.42}
          color={alerting ? SIGNAL.red : '#12202c'}
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.03}
          outlineColor="#f2f6fa"
        >
          {def.label}
        </Text>
      )}
    </group>
  );
}

/** Tall, round, domed — the only thing on a floor that breaks head height. */
function Reactor({ active, m }: { active: boolean; m: MachineMaterials }) {
  return (
    <group>
      <mesh geometry={G.skirt} material={m.trim} position={[0, 0.14, 0]} castShadow={active} />
      <mesh geometry={G.vessel} material={m.body} position={[0, 1.28, 0]} castShadow={active} />
      <mesh geometry={G.dome} material={m.body} position={[0, 2.28, 0]} castShadow={active} />
      {/* Risers up the outside, which is what makes a tank read as plumbed in */}
      {[-0.72, 0.72].map((x) => (
        <mesh
          key={x}
          geometry={G.pipe}
          material={m.trim}
          position={[x, 1.1, 0.2]}
          scale={[1, 2.0, 1]}
        />
      ))}
      <mesh
        geometry={G.pipe}
        material={m.trim}
        position={[0, 2.1, 0.55]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[1, 0.9, 1]}
      />
    </group>
  );
}

/** A boxy unit whose fan face is its whole identity. */
function Chiller({
  active,
  m,
  spinner,
}: {
  active: boolean;
  m: MachineMaterials;
  spinner: React.RefObject<THREE.Group>;
}) {
  return (
    <group>
      <mesh geometry={G.chillerBody} material={m.body} position={[0, 0.75, 0]} castShadow={active} />
      <mesh
        geometry={G.plate}
        material={m.rubber}
        position={[0, 0.05, 0]}
        scale={[1.55, 0.1, 1.05]}
      />
      <mesh geometry={G.fanRing} material={m.trim} position={[0, 0.85, 0.52]} />
      <group ref={spinner} position={[0, 0.85, 0.5]}>
        {[0, Math.PI / 3, (2 * Math.PI) / 3].map((r) => (
          <mesh key={r} geometry={G.fanBlade} material={m.panel} rotation={[0, 0, r]} />
        ))}
      </group>
      {/* Condenser fins down the flank */}
      {[-0.3, -0.1, 0.1, 0.3].map((z) => (
        <mesh
          key={z}
          geometry={G.plate}
          material={m.trim}
          position={[-0.76, 0.85, z]}
          scale={[0.02, 0.9, 0.1]}
        />
      ))}
    </group>
  );
}

/** A slim wall cabinet: the one kind that is flat rather than deep. */
function Panel({ active, m }: { active: boolean; m: MachineMaterials }) {
  return (
    <group>
      <mesh geometry={G.cabinet} material={m.panel} position={[0, 0.85, 0]} castShadow={active} />
      <mesh geometry={G.screen} material={m.screen} position={[0, 1.18, 0.19]} />
      {/* Breaker switches — the small repeated detail that says "electrical" */}
      {[0.62, 0.46, 0.3].map((y) => (
        <mesh
          key={y}
          geometry={G.plate}
          material={m.trim}
          position={[0, y, 0.19]}
          scale={[0.7, 0.06, 0.02]}
        />
      ))}
      <mesh
        geometry={G.plate}
        material={m.hazard}
        position={[0, 0.05, 0]}
        scale={[1.15, 0.1, 0.46]}
      />
    </group>
  );
}

/** A heavy frame with a gap in it — the only kind you can see through. */
function Press({ active, m, ram }: { active: boolean; m: MachineMaterials; ram: React.RefObject<THREE.Group> }) {
  return (
    <group>
      <mesh geometry={G.pressFrame} material={m.trim} position={[0, 0.14, 0]} castShadow={active} />
      <mesh geometry={G.bed} material={m.body} position={[0, 0.39, 0]} castShadow={active} />
      {[-0.62, 0.62].map((x) => (
        <mesh key={x} geometry={G.pressColumn} material={m.trim} position={[x, 1.25, 0]} />
      ))}
      <mesh geometry={G.pressFrame} material={m.body} position={[0, 2.26, 0]} castShadow={active} />
      <group ref={ram} position={[0, 1.62, 0]}>
        <mesh geometry={G.ram} material={m.panel} castShadow={active} />
      </group>
      <mesh
        geometry={G.plate}
        material={m.hazard}
        position={[0, 0.01, 0]}
        scale={[1.9, 0.02, 1.5]}
      />
    </group>
  );
}

/** Long and low, with something visibly moving along it. */
function Packer({
  active,
  m,
  cartons,
}: {
  active: boolean;
  m: MachineMaterials;
  cartons: React.RefObject<THREE.Group>;
}) {
  return (
    <group>
      <mesh geometry={G.conveyor} material={m.body} position={[0, 0.62, 0]} castShadow={active} />
      {[-0.9, -0.3, 0.3, 0.9].map((x) => (
        <mesh key={x} geometry={G.post} material={m.trim} position={[x, 0.27, 0]} scale={[1, 0.54, 1]} />
      ))}
      {[-0.85, -0.45, -0.05, 0.35, 0.75].map((x) => (
        <mesh
          key={x}
          geometry={G.roller}
          material={m.trim}
          position={[x, 0.72, 0]}
          rotation={[Math.PI / 2, 0, 0]}
        />
      ))}
      {[-0.68, 0.68].map((x) => (
        <mesh key={x} geometry={G.arch} material={m.panel} position={[x, 1.2, 0]} />
      ))}
      <mesh geometry={G.archTop} material={m.panel} position={[0, 1.85, 0]} castShadow={active} />
      <group ref={cartons}>
        {[-0.7, 0, 0.7].map((x) => (
          <mesh key={x} geometry={G.carton} material={m.hazard} position={[x, 0.83, 0]} castShadow={active} />
        ))}
      </group>
    </group>
  );
}

/** Squat, with a stack — the only kind whose outline goes up in two stages. */
function Furnace({ active, m }: { active: boolean; m: MachineMaterials }) {
  return (
    <group>
      <mesh geometry={G.furnaceBody} material={m.body} position={[0, 0.78, 0]} castShadow={active} />
      <mesh geometry={G.stack} material={m.trim} position={[0, 2.28, -0.3]} castShadow={active} />
      {/* The door glow is the tell: this one is hot, the chiller is not. */}
      <mesh geometry={G.door} material={furnaceGlow} position={[0, 0.68, 0.61]} />
      <mesh
        geometry={G.plate}
        material={m.trim}
        position={[0, 0.68, 0.605]}
        scale={[0.78, 0.62, 0.02]}
      />
      <mesh
        geometry={G.plate}
        material={m.hazard}
        position={[0, 0.02, 0.95]}
        scale={[1.6, 0.02, 0.5]}
      />
    </group>
  );
}

export const SiteMachine = memo(
  SiteMachineImpl,
  (a, b) =>
    a.def === b.def &&
    a.active === b.active &&
    a.alerting === b.alerting &&
    a.onSelect === b.onSelect,
);

/** A mast with a cage that runs it — the only kind that moves vertically. */
function Hoist({ active, sm, cage }: { active: boolean; sm: SitePlantMaterials; cage: React.RefObject<THREE.Group> }) {
  return (
    <group>
      <mesh geometry={S.hoistBase} material={sm.dark} position={[0, 0.12, 0]} castShadow={active} />
      <mesh geometry={S.mast} material={sm.steel} position={[0, 1.94, -0.5]} castShadow={active} />
      {/* Tie brackets back to the structure, at the two heights a real one has */}
      {[1.3, 2.7].map((y) => (
        <mesh key={y} geometry={G.plate} material={sm.steel} position={[0, y, -0.68]} scale={[0.5, 0.08, 0.3]} />
      ))}
      <group ref={cage} position={[0, 0.9, 0]}>
        <mesh geometry={S.cage} material={sm.plant} castShadow={active} />
        {[-0.3, 0, 0.3].map((x) => (
          <mesh key={x} geometry={S.cageBar} material={sm.dark} position={[x, 0, 0.46]} />
        ))}
      </group>
    </group>
  );
}

/** A lattice mast section: open, so you see the deck through it. */
function Crane({ active, sm }: { active: boolean; sm: SitePlantMaterials }) {
  const legs: [number, number][] = [
    [-0.6, -0.6],
    [0.6, -0.6],
    [-0.6, 0.6],
    [0.6, 0.6],
  ];
  return (
    <group>
      <mesh geometry={S.craneBase} material={sm.dark} position={[0, 0.15, 0]} castShadow={active} />
      {legs.map(([x, z]) => (
        <mesh
          key={`${x}:${z}`}
          geometry={S.latticeLeg}
          material={sm.plant}
          position={[x, 2.1, z]}
          castShadow={active}
        />
      ))}
      {/* Diagonal bracing, which is the whole visual signature of a lattice */}
      {[0.7, 1.5, 2.3, 3.1].map((y, i) => (
        <group key={y}>
          <mesh
            geometry={S.latticeBrace}
            material={sm.plant}
            position={[0, y, i % 2 === 0 ? -0.6 : 0.6]}
            rotation={[0, 0, i % 2 === 0 ? 0.5 : -0.5]}
          />
          <mesh
            geometry={S.latticeBrace}
            material={sm.plant}
            position={[i % 2 === 0 ? -0.6 : 0.6, y, 0]}
            rotation={[0, Math.PI / 2, i % 2 === 0 ? 0.5 : -0.5]}
          />
        </group>
      ))}
    </group>
  );
}

/** A canopied set on skids — long, low and closed. */
function Generator({ active, sm }: { active: boolean; sm: SitePlantMaterials }) {
  return (
    <group>
      <mesh geometry={S.skid} material={sm.dark} position={[0, 0.09, 0]} castShadow={active} />
      <mesh geometry={S.canopy} material={sm.plant} position={[0, 0.71, 0]} castShadow={active} />
      {/* Radiator louvres on the end, and a stack — the two things that say
          "this one is running an engine". */}
      {[-0.1, 0, 0.1].map((z) => (
        <mesh key={z} geometry={S.louvre} material={sm.dark} position={[-0.96, 0.71, z * 3]} />
      ))}
      <mesh geometry={S.exhaust} material={sm.steel} position={[0.6, 1.68, -0.3]} castShadow={active} />
    </group>
  );
}

/** A skid with a hopper and a folded boom. */
function ConcretePump({ active, sm }: { active: boolean; sm: SitePlantMaterials }) {
  return (
    <group>
      <mesh geometry={S.skid} material={sm.plant} position={[0, 0.4, 0]} castShadow={active} />
      {/* The hopper is a four-sided cone, so it reads as a funnel not a drum */}
      <mesh
        geometry={S.hopper}
        material={sm.dark}
        position={[-0.55, 0.85, 0]}
        rotation={[0, Math.PI / 4, 0]}
        castShadow={active}
      />
      <mesh
        geometry={S.boom}
        material={sm.steel}
        position={[0.35, 1.0, 0]}
        rotation={[0, Math.PI / 2, 0.28]}
        castShadow={active}
      />
      {[-0.55, 0.55].map((x) => (
        <mesh key={x} geometry={S.outrigger} material={sm.steel} position={[x, 0.22, 0.7]} />
      ))}
    </group>
  );
}

/** A trolley, two bottles and a screen — the smallest thing on the site. */
function Welder({
  active,
  sm,
  spinner,
}: {
  active: boolean;
  sm: SitePlantMaterials;
  spinner: React.RefObject<THREE.Group>;
}) {
  return (
    <group>
      <mesh geometry={S.trolley} material={sm.plant} position={[0, 0.5, 0]} castShadow={active} />
      {[-0.16, 0.16].map((x) => (
        <group key={x} position={[x, 1.2, -0.18]}>
          <mesh geometry={S.bottle} material={sm.bottle} castShadow={active} />
          <mesh geometry={S.bottleCap} material={sm.steel} position={[0, 0.65, 0]} />
        </group>
      ))}
      {[-0.3, 0.3].map((x) => (
        <mesh
          key={x}
          geometry={S.wheel}
          material={sm.dark}
          position={[x, 0.16, 0.2]}
          rotation={[0, 0, Math.PI / 2]}
        />
      ))}
      {/* The welding screen, and behind it the arc: the spinner ref is reused
          as a flicker, which is what an arc actually looks like at distance. */}
      <mesh geometry={S.screen} material={sm.dark} position={[0.75, 0.68, 0]} castShadow={active} />
      <group ref={spinner} position={[0.45, 0.62, 0]}>
        <mesh geometry={G.lamp} material={furnaceGlow} scale={[0.9, 0.9, 0.9]} />
      </group>
    </group>
  );
}
