/**
 * The pure half of the setup flow, so the retry rules are testable without a
 * React tree.
 *
 * Resuming matters because registration is the long step, and the server has
 * no delete endpoints: an account that lands is permanent, and `username`/
 * `email` are unique PLATFORM-WIDE (api-contract.md, POST /auth/register).
 * Re-registering an index that already succeeded doesn't just waste a
 * request — it 409s on an identifier that's already taken, and there is no
 * way to clear it. So a retry must resume from the *set* of workers already
 * provisioned, never from a completion count: `done` counts every attempt,
 * successful or not, and is not a contiguous prefix of successes. A failure
 * in the middle of the batch (worker 3 of 10, say) leaves a gap, not a
 * shorter run from the front — resuming from "count 9" would re-attempt
 * index 9 (already done) and skip index 3 (the one that actually failed).
 */
export const MIN_WORKER_COUNT = 1;
export const MAX_WORKER_COUNT = 120;

/**
 * Clamp a raw worker-count input to the provisionable range.
 *
 * `provisionWorkers` registers one permanent account per worker against a
 * shared production server with no delete endpoints, so an unclamped input
 * is a real hazard, not a cosmetic one: typing `500` would provision 500
 * accounts nobody can remove, and clearing the field yields `Number('') ===
 * 0` — zero workers, silently. Both the raw `<input>`'s `NaN` (an empty or
 * non-numeric field) and any out-of-range number are handled here so the
 * component only ever sees a valid count.
 */
export function clampWorkerCount(raw: number): number {
  if (!Number.isFinite(raw)) return MIN_WORKER_COUNT;
  return Math.min(MAX_WORKER_COUNT, Math.max(MIN_WORKER_COUNT, Math.round(raw)));
}

export type SetupPhase =
  | 'idle'
  | 'company'
  | 'workers'
  /** logging an existing company's accounts back in */
  | 'signing-in'
  | 'connecting'
  | 'ready'
  | 'failed';

export type SetupProgress = { done: number; total: number };

export function progressLabel(phase: SetupPhase, progress: SetupProgress): string {
  switch (phase) {
    case 'company':
      return 'Creating the company';
    case 'workers':
      return `Registering workers ${progress.done} / ${progress.total}`;
    case 'signing-in':
      return `Signing workers in ${progress.done} / ${progress.total}`;
    case 'connecting':
      return `Connecting ${progress.total} phones`;
    case 'ready':
      return 'Ready';
    case 'failed':
      return 'Setup failed';
    default:
      return 'Idle';
  }
}

/**
 * The worker indices `1..total` not yet present in `provisioned` — i.e. what
 * a retry must still register. Mirrors the gap-filling `provisionWorkers`
 * already does internally (`src/net/provisioning.ts`) with its own
 * `alreadyProvisioned` parameter; this is the same computation exposed so the
 * setup screen (and its tests) can reason about what's missing without
 * touching the network.
 */
export function missingWorkerIndices(
  total: number,
  provisioned: readonly { index: number }[],
): number[] {
  const done = new Set(provisioned.map((w) => w.index));
  const missing: number[] = [];
  for (let index = 1; index <= total; index++) {
    if (!done.has(index)) missing.push(index);
  }
  return missing;
}

/**
 * A company-phase failure leaves nothing to resume — the tenant may not exist —
 * so it restarts. Later phases keep what they have.
 */
export function nextPhaseAfterFailure(phase: SetupPhase): SetupPhase {
  return phase === 'company' ? 'idle' : phase;
}
