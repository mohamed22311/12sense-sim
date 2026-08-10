/**
 * A site is DATA, not code.
 *
 * Six floors, their obstacles, their machines with a floor label and real
 * coordinates, the anchors jobs are drawn toward, and the portals between
 * levels. Everything downstream — the navmesh, pathing, the job pool, the
 * rendered building — is derived from this and knows nothing about which site
 * it is looking at.
 *
 * The test of that separation: adding the construction site in a later phase
 * must mean adding a module beside `factory/` and touching nothing else. If it
 * ever requires a change in `sim/` or `scene/`, something has leaked.
 */

export type Vec2 = { x: number; z: number };

/**
 * An axis-aligned footprint on a floor, in metres. `x`/`z` are its min corner.
 *
 * `kind` exists because pathing and rendering want different answers about the
 * same rectangle. Every machine contributes a footprint so walkers route around
 * it — but the machine is already drawn, and drawing the footprint too buried
 * each one in a grey block. Navmesh takes them all; the renderer takes only
 * `structure`.
 */
export type ObstacleRect = {
  x: number;
  z: number;
  w: number;
  d: number;
  /** defaults to `structure` — an obstacle nothing else draws */
  kind?: 'structure' | 'machine';
  /**
   * How tall it stands, metres. Defaults to waist height, which is right for
   * plant you look over. A lift core or a column runs to the deck above, and
   * drawn at waist height it reads as a crate rather than as structure.
   */
  height?: number;
};

/**
 * An alertable asset. `id` is the `asset_id` sent to the server, so it is a
 * real identifier a dispatcher will read — not a display string.
 */
export type MachineDef = {
  id: string;
  label: string;
  /** matches `Event.floor` on the wire, and the phone's own FloorProvider value */
  floor: string;
  position: Vec2;
  rotationY: number;
  kind: MachineKind;
};

/**
 * What the asset *is* — its silhouette and its failure vocabulary.
 *
 * The first six are the factory's; the rest arrived with the construction
 * site, which shares nothing with a process plant except that both have things
 * that break. A kind is not decoration: it picks the body that gets drawn and
 * the alerts the dialog offers, so a hoist typed as a press would offer to
 * report a light curtain it does not have.
 */
export type MachineKind =
  | 'chiller'
  | 'panel'
  | 'reactor'
  | 'press'
  | 'packer'
  | 'furnace'
  | 'hoist'
  | 'crane'
  | 'pump'
  | 'generator'
  | 'welder';

export type JobAnchorKind = 'stores' | 'terminal' | 'break' | 'inspect' | 'sweep';

/** Somewhere a job can send a worker that is not a machine. */
export type JobAnchor = {
  id: string;
  kind: JobAnchorKind;
  floor: string;
  position: Vec2;
};

/**
 * A way between two floors. Declared once and usable in both directions — a
 * stairwell is not one-way, and duplicating it would let the two copies drift.
 */
export type PortalDef = {
  id: string;
  kind: 'stairs' | 'lift';
  fromFloor: string;
  toFloor: string;
  fromPosition: Vec2;
  toPosition: Vec2;
  travelSeconds: number;
};

export type FloorDef = {
  /** '1'..'6' — the same string that travels as `Event.floor` */
  id: string;
  label: string;
  /** metres; the top surface of this floor's slab */
  elevation: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  obstacles: ObstacleRect[];
  machines: MachineDef[];
  anchors: JobAnchor[];
};

export type SiteDef = {
  id: 'factory' | 'construction';
  label: string;
  /**
   * How the structure is drawn. A finished factory has walls; a building under
   * construction has columns and open edges, and drawing it with walls makes
   * it read as a finished building that happens to contain a crane.
   */
  style: 'enclosed' | 'frame';
  floors: FloorDef[];
  portals: PortalDef[];
  /** metres between floor slabs; the dollhouse stacks on this */
  floorHeight: number;
};
