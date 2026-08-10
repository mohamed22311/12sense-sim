import { RoundedBox } from '@react-three/drei';
import type { FloorDef } from '@/sites/types';
import { SiteMachine } from '@/scene/building/SiteMachine';
import { useBuildingStore } from '@/state/buildingStore';
import { themeFor } from '@/styles/theme';
import {
  BEAM_FRACTIONS,
  PILASTER_FRACTIONS,
  RAIL_HEIGHT,
  dressingGeometry,
  dressingMaterials,
  obstacleCap,
  structureGeometry,
} from '@/scene/building/floorDressing';

/** Where the guard-rail posts sit along the open edge, as a fraction of width. */
const RAIL_POST_FRACTIONS = [0.02, 0.2, 0.4, 0.6, 0.8, 0.98];

/**
 * One floor of the dollhouse.
 *
 * `active` is the only visual switch, and it is deliberately coarse: the lit
 * floor gets full material detail and casts shadows, every other floor drops to
 * flat materials and stops casting. Sixty workers across six fully-lit floors
 * is six times the shading work for five floors nobody is looking at.
 *
 * The front wall (`maxZ`) is omitted on every floor. That omission IS the
 * cutaway — without it the stack is six sealed boxes.
 */

/** Waist height: right for plant you look over, wrong for a core wall. */
const DEFAULT_OBSTACLE_HEIGHT = 1.1;

const SLAB_THICKNESS = 0.18;
const WALL_HEIGHT = 3.2;
const WALL_THICKNESS = 0.14;

export type FloorSlabProps = {
  floor: FloorDef;
  active: boolean;
  /**
   * `enclosed` walls a finished building; `frame` leaves the deck open and
   * stands columns at its corners instead. A construction site drawn with
   * walls reads as a finished building that happens to contain a crane.
   */
  style: 'enclosed' | 'frame';
  onSelect?: (floorId: string) => void;
  /**
   * Where on the slab the click landed, in site coordinates. Only meaningful
   * while somebody is being driven — it is how you send him somewhere without
   * holding a key down.
   */
  onWalkTo?: (floorId: string, at: { x: number; z: number }) => void;
};

/** Where a frame's perimeter columns stand, as a fraction of the footprint. */
const COLUMN_FRACTIONS = [0.03, 0.5, 0.97];

export function FloorSlab({ floor, active, style, onSelect, onWalkTo }: FloorSlabProps) {
  const theme = themeFor(useBuildingStore((s) => s.site));
  const dressing = dressingMaterials(theme);
  const selectMachine = useBuildingStore((s) => s.selectMachine);
  const openAlerts = useBuildingStore((s) => s.openAlerts);
  const { minX, maxX, minZ, maxZ } = floor.bounds;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;

  const slabColor = active ? theme.floor : theme.floorDim;
  const wallColor = active ? theme.wall : theme.wallDim;

  return (
    <group position={[0, floor.elevation, 0]}>
      {/* Slab — also the click target for selecting this floor */}
      <mesh
        position={[midX, -SLAB_THICKNESS / 2, midZ]}
        receiveShadow={active}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.(floor.id);
          // `point` is the world-space hit. The building group is untranslated
          // in x and z, so it is already in site coordinates.
          onWalkTo?.(floor.id, { x: e.point.x, z: e.point.z });
        }}
      >
        <boxGeometry args={[width, SLAB_THICKNESS, depth]} />
        {/* Opaque, always. A translucent slab let the floor below show
            through, so workers appeared to stand inside each other's ceilings
            — which reads as a rendering fault, not as a cutaway. The cutaway
            is the missing front wall, and it does not need help. */}
        <meshStandardMaterial color={slabColor} roughness={0.94} metalness={0.02} />
      </mesh>

      {style === 'enclosed' ? (
        <>
          {/* Back wall */}
          <mesh position={[midX, WALL_HEIGHT / 2, minZ]} receiveShadow={active}>
            <boxGeometry args={[width, WALL_HEIGHT, WALL_THICKNESS]} />
            <meshStandardMaterial color={wallColor} roughness={0.92} />
          </mesh>

          {/* Side walls, kept low so the cutaway stays readable from the front */}
          {[minX, maxX].map((x) => (
            <mesh key={x} position={[x, WALL_HEIGHT / 2, midZ]} receiveShadow={active}>
              <boxGeometry args={[WALL_THICKNESS, WALL_HEIGHT, depth]} />
              <meshStandardMaterial
                color={wallColor}
                roughness={0.92}
                transparent
                opacity={active ? 0.55 : 0.3}
              />
            </mesh>
          ))}
        </>
      ) : (
        // A frame: columns on a grid and nothing between them. The deck above
        // has to be held up by something visible, or the stack reads as
        // floating slabs rather than as a structure.
        COLUMN_FRACTIONS.flatMap((tx) =>
          COLUMN_FRACTIONS.map((tz) => (
            <mesh
              key={`${tx}:${tz}`}
              position={[minX + width * tx, WALL_HEIGHT / 2, minZ + depth * tz]}
              castShadow={active}
              receiveShadow={active}
            >
              <boxGeometry args={[0.34, WALL_HEIGHT, 0.34]} />
              <meshStandardMaterial color={wallColor} roughness={0.94} />
            </mesh>
          )),
        )
      )}

      {/* Structure only. A machine's own footprint is an obstacle too, but the
          machine is standing on it — drawing both put every machine inside a
          grey block. */}
      {/*
        Structure only, and in two parts.

        A single box was the largest object on every floor and the blandest —
        an untreated grey slab with nothing to catch light. Capping it reads as
        construction rather than as a placeholder: in a factory the cap is the
        deck plate on a plant base, on a frame it is the head of a concrete
        core. One extra mesh each, off shared geometry.
      */}
      {floor.obstacles.filter((o) => o.kind !== 'machine').map((o, i) => {
        const height = o.height ?? DEFAULT_OBSTACLE_HEIGHT;
        const body =
          style === 'frame'
            ? active
              ? theme.wall
              : theme.wallDim
            : active
              ? theme.plant
              : theme.plantDim;
        return (
          <group key={i} position={[o.x + o.w / 2, 0, o.z + o.d / 2]}>
            <RoundedBox
              args={[o.w, height, o.d]}
              radius={0.06}
              position={[0, height / 2, 0]}
              castShadow={active}
              receiveShadow={active}
            >
              <meshStandardMaterial color={body} roughness={0.94} />
            </RoundedBox>
            <mesh
              geometry={obstacleCap}
              material={active ? dressing.beam : dressing.beamDim}
              position={[0, height + 0.02, 0]}
              scale={[o.w + 0.12, 1, o.d + 0.12]}
              castShadow={active}
            />
          </group>
        );
      })}

      {floor.machines.map((m) => (
        <SiteMachine
          key={m.id}
          def={m}
          active={active}
          alerting={openAlerts.some((a) => a.assetId === m.id)}
          onSelect={selectMachine}
        />
      ))}

      {/*
        The open edge is a working edge, not a cut. A hazard stripe and a guard
        rail are what an actual mezzanine has there, and without them the
        cutaway reads as a sliced model rather than a floor someone stands on.
      */}
      <mesh
        geometry={dressingGeometry.stripe}
        material={active ? dressing.hazard : dressing.hazardDim}
        position={[midX, 0.01, maxZ - 0.17]}
        scale={[width, 1, 1]}
        receiveShadow={active}
      />

      {[RAIL_HEIGHT, RAIL_HEIGHT * 0.55].map((y) => (
        <mesh
          key={y}
          geometry={dressingGeometry.railBar}
          material={active ? dressing.rail : dressing.railDim}
          position={[midX, y, maxZ - 0.06]}
          rotation={[0, 0, Math.PI / 2]}
          scale={[1, width, 1]}
        />
      ))}
      {RAIL_POST_FRACTIONS.map((t) => (
        <mesh
          key={t}
          geometry={dressingGeometry.railPost}
          material={active ? dressing.rail : dressing.railDim}
          position={[minX + width * t, RAIL_HEIGHT / 2, maxZ - 0.06]}
        />
      ))}

      {/*
        Downstand beams under the slab above.

        They do the most work of anything here: a sixteen-metre ceiling with
        nothing on it is a flat plane that light falls across evenly, which
        reads as a backdrop. Four beams break it into bays, catch the ceiling
        lights along their edges, and give the space a scale — you can see how
        deep a floor is because you can count them.
      */}
      {BEAM_FRACTIONS.map((t) => (
        <mesh
          key={t}
          geometry={structureGeometry.beam}
          material={active ? dressing.beam : dressing.beamDim}
          position={[midX, WALL_HEIGHT - 0.15, minZ + depth * t]}
          rotation={[0, Math.PI / 2, 0]}
          scale={[1, 1, width]}
          castShadow={active}
        />
      ))}

      {/* Pilasters up the back wall, for the same reason at the other angle. */}
      {style === 'enclosed' &&
        PILASTER_FRACTIONS.map((t) => (
          <mesh
            key={t}
            geometry={structureGeometry.pilaster}
            material={active ? dressing.pilaster : dressing.pilasterDim}
            position={[minX + width * t, WALL_HEIGHT / 2, minZ + 0.12]}
            scale={[1, WALL_HEIGHT, 1]}
            castShadow={active}
          />
        ))}

      {/* A painted walkway down the spine of the floor, so the empty middle
          reads as circulation space rather than as unfinished. */}
      <mesh
        geometry={dressingGeometry.walkway}
        material={dressing.walkway}
        position={[midX, 0.008, midZ + 1.2]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[1.6, depth * 0.62, 1]}
      />
    </group>
  );
}
