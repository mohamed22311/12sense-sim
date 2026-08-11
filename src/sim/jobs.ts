/**
 * What a worker does next.
 *
 * A job is a destination, an activity and a dwell time — and nothing about how
 * to get there, which belongs to pathing. Keeping the two apart is what lets a
 * job be chosen without a navmesh, and a route be found without knowing why.
 *
 * `pickJob` takes its randomness as a parameter rather than calling
 * `Math.random` itself, so a worker's behaviour is reproducible in a test and
 * varied in a demo.
 */
import type { FloorDef, JobAnchor, JobAnchorKind, SiteDef, Vec2 } from '@/sites/types';
import type { Role } from '@/sim/roles';

export type Activity =
  | 'walking'
  | 'operating'
  | 'inspecting'
  | 'carrying'
  | 'logging'
  | 'talking'
  | 'resting'
  | 'sweeping'
  | 'climbing';

export type JobKind =
  | 'inspect'
  | 'operate'
  | 'fetch'
  | 'carry'
  | 'log'
  | 'meet'
  | 'break'
  | 'sweep'
  | 'patrol';

export type Job = {
  /** '<kind>:<targetId>' — stable enough to tell two jobs apart in a test */
  id: string;
  kind: JobKind;
  activity: Activity;
  target: { floorId: string; position: Vec2 };
  /** how long the worker stays put once they arrive, ms */
  dwellMs: number;
  label: string;
};

const ROLE_JOBS: Record<Role, readonly JobKind[]> = {
  operator: ['operate', 'log', 'meet', 'break'],
  technician: ['inspect', 'operate', 'fetch', 'log', 'break'],
  inspector: ['inspect', 'log', 'patrol', 'break'],
  materials: ['fetch', 'carry', 'log', 'break'],
  supervisor: ['patrol', 'meet', 'log', 'inspect'],
  cleaner: ['sweep', 'fetch', 'break'],
};

export function jobsForRole(role: Role): readonly JobKind[] {
  return ROLE_JOBS[role];
}

/**
 * Dwell ranges in ms — long enough to read as work rather than a twitch, short
 * enough that the floor keeps moving while someone watches it.
 */
const DWELL: Record<JobKind, readonly [number, number]> = {
  inspect: [8_000, 20_000],
  operate: [12_000, 30_000],
  fetch: [4_000, 9_000],
  carry: [4_000, 9_000],
  log: [6_000, 14_000],
  meet: [8_000, 18_000],
  break: [20_000, 45_000],
  sweep: [10_000, 22_000],
  patrol: [2_000, 6_000],
};

const ACTIVITY: Record<JobKind, Activity> = {
  inspect: 'inspecting',
  operate: 'operating',
  fetch: 'carrying',
  carry: 'carrying',
  log: 'logging',
  meet: 'talking',
  break: 'resting',
  sweep: 'sweeping',
  patrol: 'walking',
};

/** Which anchor kind a non-machine job is drawn toward. */
const ANCHOR_FOR: Record<Exclude<JobKind, 'inspect' | 'operate'>, JobAnchorKind> = {
  fetch: 'stores',
  carry: 'stores',
  log: 'terminal',
  meet: 'terminal',
  break: 'break',
  sweep: 'sweep',
  patrol: 'inspect',
};

/**
 * How often a job is on the worker's current floor.
 *
 * This applies to *every* job kind, which it did not used to. Machine work
 * carried a local bias and anchor work carried none at all, so a fetch, a
 * terminal entry, a sweep or a break was drawn uniformly from all six floors —
 * five times in six it required a stair trip. Since most job kinds are anchor
 * jobs, the result was a workforce that mostly commuted: sampling thirty
 * workers found nineteen of them on a staircase at once.
 *
 * It is now absolute: **a worker never leaves the floor they start on.**
 *
 * That is a demo decision, and it is the right one. A worker in transit is a
 * worker whose floor is ambiguous — `floorId` only changes on *arrival*, so
 * someone drawn halfway up a stairwell still reports the floor they left, and
 * the floor gate correctly used a value the screen appeared to contradict. Add
 * that the roster is inspected seconds after an alert fires, by which time
 * people have moved, and the demo's clearest claim — "this worker's own phone
 * decided, on its own floor" — became impossible to check by looking.
 *
 * The floor gate is still exercised, and better: every alert is raised on one
 * floor while five other floors of people stay put and stay silent.
 */
const LOCAL_JOB_ONLY = true;

/**
 * Pick one. Throws on an empty pool rather than returning `undefined`, because
 * the caller would then read `.id` off nothing and fail one frame later with
 * no clue which pool was empty. The site model's whole promise is that adding
 * a site means adding data — so a site missing an anchor kind must say so, by
 * name, the moment it is used.
 */
const choose = <T,>(items: readonly T[], rand: () => number, what: string): T => {
  if (items.length === 0) throw new Error(`no ${what} available on this site`);
  return items[Math.min(items.length - 1, Math.floor(rand() * items.length))];
};

const between = ([lo, hi]: readonly [number, number], rand: () => number) =>
  Math.round(lo + rand() * (hi - lo));

function anchorsOfKind(site: SiteDef, kind: JobAnchorKind): JobAnchor[] {
  return site.floors.flatMap((f) => f.anchors.filter((a) => a.kind === kind));
}

/** The anchors of a kind on one floor. Every floor carries every kind. */
function localAnchorsOfKind(
  site: SiteDef,
  kind: JobAnchorKind,
  floorId: string,
): JobAnchor[] {
  return site.floors.find((f) => f.id === floorId)?.anchors.filter((a) => a.kind === kind) ?? [];
}

/**
 * Where to actually stand, given where the job is.
 *
 * Every worker on a floor draws from the same handful of anchors and four
 * machines, and `nearestWalkable` snaps a target inside a machine's footprint
 * to one specific cell — so ten people sent to inspect the same press all
 * converged on the same half-metre square and stood inside one another. It
 * looked like a rendering fault and it made the crowd unclickable: the worker
 * you meant was behind two others occupying his exact position.
 *
 * So a job's target is a *spot near* the thing, not the thing. The offset is
 * drawn from the agent's own generator, which keeps a run reproducible, and is
 * at least three navmesh cells so two workers cannot round to the same one.
 */
const STAND_MIN_M = 1.5;
const STAND_SPREAD_M = 1.6;

/**
 * The golden angle, in radians.
 *
 * Consecutive workers placed at multiples of it never bunch: it is the same
 * property that makes a sunflower's seeds even. A random angle per worker
 * looked right in isolation and still collided — ten draws from a uniform
 * circle put two people 41 cm apart, which is inside one navmesh cell and
 * therefore inside each other.
 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Kept off the walls, so a clamped spot is still somewhere a person can stand. */
const WALL_MARGIN_M = 0.8;

function boundsOf(site: SiteDef, floorId: string): FloorDef['bounds'] {
  const floor = site.floors.find((f) => f.id === floorId);
  if (!floor) throw new Error(`no floor "${floorId}" on this site`);
  return floor.bounds;
}

function standingSpot(
  target: Vec2,
  rand: () => number,
  bounds: FloorDef['bounds'],
  index: number,
): Vec2 {
  // Their place in the ring comes from who they are, so two workers cannot be
  // dealt the same one. The jitter keeps it from reading as a parade formation
  // without ever being large enough to close the gap.
  const angle = index * GOLDEN_ANGLE + (rand() - 0.5) * 0.5;
  const distance = STAND_MIN_M + (((index * 0.618) % 1) + (rand() - 0.5) * 0.15) * STAND_SPREAD_M;
  // Clamped, because an anchor near a wall would otherwise scatter people
  // through it — and a target outside the floor is a route that cannot be
  // planned, which strands the worker rather than moving them.
  return {
    x: clamp(target.x + Math.cos(angle) * distance, bounds.minX, bounds.maxX, WALL_MARGIN_M),
    z: clamp(target.z + Math.sin(angle) * distance, bounds.minZ, bounds.maxZ, WALL_MARGIN_M),
  };
}

const clamp = (value: number, lo: number, hi: number, margin: number) =>
  Math.max(lo + margin, Math.min(hi - margin, value));

export function pickJob(
  site: SiteDef,
  role: Role,
  currentFloorId: string,
  rand: () => number,
  /** who is being sent — decides their place in the ring around the target */
  index = 0,
): Job {
  const kind = choose(ROLE_JOBS[role], rand, `job kinds for role ${role}`);

  if (kind === 'inspect' || kind === 'operate') {
    // This floor's machines only. `all` remains the fallback for the case a
    // floor genuinely has none — a worker with no work is worse than a worker
    // who travels, and the site tests do not require machines on every floor.
    const local = site.floors.find((f) => f.id === currentFloorId)?.machines ?? [];
    const all = site.floors.flatMap((f) => f.machines);
    const pool = LOCAL_JOB_ONLY && local.length > 0 ? local : all;
    const machine = choose(pool, rand, 'machines');
    return {
      id: `${kind}:${machine.id}`,
      kind,
      activity: ACTIVITY[kind],
      // Around the machine, not inside it — see `standingSpot`.
      target: {
        floorId: machine.floor,
        position: standingSpot(machine.position, rand, boundsOf(site, machine.floor), index),
      },
      dwellMs: between(DWELL[kind], rand),
      label: `${kind === 'inspect' ? 'Inspecting' : 'Operating'} ${machine.label}`,
    };
  }

  // Every floor is required to carry stores / terminal / break anchors (the
  // site tests enforce it), so `terminal` is a fallback that cannot itself be
  // empty — it is here for a site that omits an optional kind, not for one
  // that is malformed.
  const wanted = ANCHOR_FOR[kind];
  // Same rule as machine work: this floor's anchors, falling back to the whole
  // site only when this floor carries none of that kind.
  const local = localAnchorsOfKind(site, wanted, currentFloorId);
  const everywhere = anchorsOfKind(site, wanted);
  const preferred = LOCAL_JOB_ONLY && local.length > 0 ? local : everywhere;
  const anchor = choose(
    preferred.length > 0 ? preferred : anchorsOfKind(site, 'terminal'),
    rand,
    `${wanted} anchors (nor any terminal anchor to fall back to)`,
  );

  return {
    id: `${kind}:${anchor.id}`,
    kind,
    activity: ACTIVITY[kind],
    target: {
      floorId: anchor.floor,
      position: standingSpot(anchor.position, rand, boundsOf(site, anchor.floor), index),
    },
    dwellMs: between(DWELL[kind], rand),
    label: LABELS[kind](anchor.id),
  };
}

const LABELS: Record<Exclude<JobKind, 'inspect' | 'operate'>, (id: string) => string> = {
  fetch: () => 'Fetching parts from stores',
  carry: () => 'Carrying material',
  log: () => 'Logging at a terminal',
  meet: () => 'Talking with a colleague',
  break: () => 'Taking a break',
  sweep: () => 'Sweeping the floor',
  patrol: () => 'Walking the floor',
};
