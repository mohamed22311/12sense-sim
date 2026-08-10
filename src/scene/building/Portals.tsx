import type { PortalDef, SiteDef } from '@/sites/types';
import { C } from '@/styles/palette';

/**
 * The stairs and lifts, drawn from portal data rather than hand-placed.
 *
 * They matter beyond decoration: a worker crossing floors walks to one of
 * these and disappears into it for a few seconds. If the shafts were not drawn
 * where the portals actually are, cross-floor travel would read as teleporting.
 */

const STAIR_STEPS = 8;

/** Rungs up a hoist mast, per storey. Fixed, so every mast section matches. */
const RUNGS = 6;
const SHAFT_WIDTH = 1.6;

function Stairs({ portal, rise }: { portal: PortalDef; rise: number }) {
  const { x, z } = portal.fromPosition;
  const stepRise = rise / STAIR_STEPS;
  const stepRun = 0.42;

  return (
    <group position={[x, 0, z]}>
      {Array.from({ length: STAIR_STEPS }, (_, i) => (
        <mesh
          key={i}
          position={[0, (i + 0.5) * stepRise, -i * stepRun + (STAIR_STEPS * stepRun) / 2]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[SHAFT_WIDTH, stepRise, stepRun]} />
          <meshStandardMaterial color={C.beam} roughness={0.9} />
        </mesh>
      ))}
      {/* handrail, so a flight reads as a flight and not a ramp of blocks */}
      <mesh position={[SHAFT_WIDTH / 2, rise * 0.6, 0]} rotation={[Math.atan2(rise, STAIR_STEPS * stepRun), 0, 0]}>
        <boxGeometry args={[0.06, 0.06, Math.hypot(rise, STAIR_STEPS * stepRun)]} />
        <meshStandardMaterial color={C.machineTrim} roughness={0.6} metalness={0.3} />
      </mesh>
    </group>
  );
}

function LiftShaft({ portal, rise }: { portal: PortalDef; rise: number }) {
  const { x, z } = portal.fromPosition;
  return (
    <group position={[x, 0, z]}>
      {/* Open-fronted cage: solid enough to read as a lift, transparent enough
          not to hide the floor behind it in a cutaway. */}
      {[-SHAFT_WIDTH / 2, SHAFT_WIDTH / 2].map((offset) => (
        <mesh key={offset} position={[offset, rise / 2, 0]}>
          <boxGeometry args={[0.08, rise, SHAFT_WIDTH]} />
          <meshStandardMaterial color={C.machinePanel} roughness={0.7} metalness={0.25} transparent opacity={0.75} />
        </mesh>
      ))}
      <mesh position={[0, rise / 2, -SHAFT_WIDTH / 2]}>
        <boxGeometry args={[SHAFT_WIDTH, rise, 0.08]} />
        <meshStandardMaterial color={C.machinePanel} roughness={0.7} metalness={0.25} transparent opacity={0.55} />
      </mesh>
      {/* car, parked at the lower landing */}
      <mesh position={[0, 1.1, 0]} castShadow>
        <boxGeometry args={[SHAFT_WIDTH - 0.24, 2.2, SHAFT_WIDTH - 0.24]} />
        <meshStandardMaterial color={C.machineBody} roughness={0.75} metalness={0.15} />
      </mesh>
    </group>
  );
}

/**
 * The same portal, drawn as what a construction site actually has.
 *
 * The data calls it a lift because that is what it is to the pathfinder — a
 * ride you wait for rather than a climb. On a frame it is an external mast
 * with a cage bolted to the outside of the structure, which looks nothing
 * like a glazed lift shaft and would otherwise make the site read as a
 * finished building.
 */
function HoistMast({ portal, rise }: { portal: PortalDef; rise: number }) {
  const { x, z } = portal.fromPosition;
  return (
    <group position={[x, 0, z]}>
      {/* The mast: two legs and rungs between them, standing proud of the deck */}
      {[-0.34, 0.34].map((offset) => (
        <mesh key={offset} position={[offset, rise / 2, -0.3]} castShadow>
          <boxGeometry args={[0.14, rise, 0.14]} />
          <meshStandardMaterial color={C.caution} roughness={0.66} metalness={0.14} />
        </mesh>
      ))}
      {Array.from({ length: RUNGS }, (_, i) => (
        <mesh key={i} position={[0, (i + 0.5) * (rise / RUNGS), -0.3]}>
          <boxGeometry args={[0.68, 0.07, 0.07]} />
          <meshStandardMaterial color={C.caution} roughness={0.66} />
        </mesh>
      ))}
      {/* The cage, parked at the lower landing */}
      <mesh position={[0, 1.05, 0.28]} castShadow>
        <boxGeometry args={[1.1, 2.1, 1.0]} />
        <meshStandardMaterial color="#a8871f" roughness={0.7} transparent opacity={0.85} />
      </mesh>
      <mesh position={[0, 0.05, 0.28]}>
        <boxGeometry args={[1.3, 0.1, 1.2]} />
        <meshStandardMaterial color={C.machineTrim} roughness={0.5} metalness={0.4} />
      </mesh>
    </group>
  );
}

export function Portals({ site }: { site: SiteDef }) {
  return (
    <group>
      {site.portals.map((portal) => {
        const from = site.floors.find((f) => f.id === portal.fromFloor);
        const to = site.floors.find((f) => f.id === portal.toFloor);
        if (!from || !to) return null;
        const rise = Math.abs(to.elevation - from.elevation);
        const base = Math.min(from.elevation, to.elevation);
        return (
          <group key={portal.id} position={[0, base, 0]}>
            {portal.kind === 'stairs' ? (
              <Stairs portal={portal} rise={rise} />
            ) : site.style === 'frame' ? (
              <HoistMast portal={portal} rise={rise} />
            ) : (
              <LiftShaft portal={portal} rise={rise} />
            )}
          </group>
        );
      })}
    </group>
  );
}
