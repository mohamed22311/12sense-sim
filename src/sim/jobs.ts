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
import type { JobAnchor, JobAnchorKind, SiteDef, Vec2 } from '@/sites/types';
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
 * workers found nineteen of them on a staircase at once, and the site read as
 * a stairwell with a factory attached.
 *
 * At 0.85 a floor's own people mostly stay on it and work, and cross-floor
 * traffic is a steady trickle rather than the main activity — which is both
 * what a real site looks like and what still exercises the floor gate.
 */
const LOCAL_JOB_BIAS = 0.85;

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

export function pickJob(
  site: SiteDef,
  role: Role,
  currentFloorId: string,
  rand: () => number,
): Job {
  const kind = choose(ROLE_JOBS[role], rand, `job kinds for role ${role}`);

  if (kind === 'inspect' || kind === 'operate') {
    // Prefer this floor, but not exclusively — a site whose workers never
    // changed level would never exercise the stairs, and the floor gate is one
    // of the things the demo exists to show.
    const local = site.floors.find((f) => f.id === currentFloorId)?.machines ?? [];
    const all = site.floors.flatMap((f) => f.machines);
    const pool = local.length > 0 && rand() < LOCAL_JOB_BIAS ? local : all;
    const machine = choose(pool, rand, 'machines');
    return {
      id: `${kind}:${machine.id}`,
      kind,
      activity: ACTIVITY[kind],
      target: { floorId: machine.floor, position: machine.position },
      dwellMs: between(DWELL[kind], rand),
      label: `${kind === 'inspect' ? 'Inspecting' : 'Operating'} ${machine.label}`,
    };
  }

  // Every floor is required to carry stores / terminal / break anchors (the
  // site tests enforce it), so `terminal` is a fallback that cannot itself be
  // empty — it is here for a site that omits an optional kind, not for one
  // that is malformed.
  const wanted = ANCHOR_FOR[kind];
  // Same bias as machine work. Without it every anchor job was a trip.
  const local = localAnchorsOfKind(site, wanted, currentFloorId);
  const everywhere = anchorsOfKind(site, wanted);
  const preferred = local.length > 0 && rand() < LOCAL_JOB_BIAS ? local : everywhere;
  const anchor = choose(
    preferred.length > 0 ? preferred : anchorsOfKind(site, 'terminal'),
    rand,
    `${wanted} anchors (nor any terminal anchor to fall back to)`,
  );

  return {
    id: `${kind}:${anchor.id}`,
    kind,
    activity: ACTIVITY[kind],
    target: { floorId: anchor.floor, position: anchor.position },
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
