/**
 * A worker's role decides which jobs they will take.
 *
 * Without it, sixty workers perform the same random walk and the site reads as
 * a crowd rather than a workforce. With it, the cleaner sweeps, the inspector
 * visits machines, the materials handler crosses floors and the supervisor
 * patrols — the place looks organised, which is most of what makes it
 * believable at a glance.
 */
export const ROLES = [
  'operator',
  'technician',
  'inspector',
  'materials',
  'supervisor',
  'cleaner',
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Deterministic per worker index, and spread so that any roster of at least
 * `ROLES.length` workers contains every role. Index is 1-based, matching the
 * provisioning identity scheme (`sim-<slug>-w01` is index 1).
 */
export function roleForIndex(index: number): Role {
  return ROLES[(index - 1) % ROLES.length];
}
