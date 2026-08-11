import { decideProximity } from '@/phone/vendor/realtime/proximity';
import { frameToLatLon, type SceneFrame } from '@/runtime/geo';
import type { AgentState } from '@/sim/agent';

/**
 * Who an alert *would* reach, if it were raised right now.
 *
 * Run through the same vendored `decideProximity` the phones run, over the same
 * frame, against the same coordinates — not a second distance formula that
 * happens to agree today. A preview that used its own arithmetic would be
 * exactly as convincing right up until it disagreed with the real thing in
 * front of an audience, and then worse than nothing.
 *
 * The one honest difference: this asks the *simulation* where each worker is,
 * whereas the real gate asks each phone. They read the same positions, so the
 * counts match — but a real handset enrolled into the company is invisible
 * here, because the simulator does not know where it is. `unknownPhones` says
 * so rather than quietly under-counting.
 */

export type ReachPreview = {
  /** would alarm */
  inRange: number;
  /** measured out of range, on the event's own floor */
  outOfRange: number;
  /** on a different floor, so suppressed whatever the distance */
  otherFloor: number;
  /** the closest worker who would NOT alarm, in metres — null if everyone would */
  nearestSilentM: number | null;
  /** clients the simulator cannot see, e.g. an enrolled real handset */
  unknownPhones: number;
};

export type ReachEvent = {
  floorId: string;
  x: number;
  z: number;
  radiusM: number;
};

export function previewReach(
  event: ReachEvent,
  workers: readonly AgentState[],
  frame: SceneFrame,
  unknownPhones = 0,
  nowMs: number = Date.now(),
): ReachPreview {
  const at = frameToLatLon(frame, event.x, event.z);
  let inRange = 0;
  let outOfRange = 0;
  let otherFloor = 0;
  let nearestSilentM: number | null = null;

  for (const worker of workers) {
    const fix = frameToLatLon(frame, worker.position.x, worker.position.z);
    const verdict = decideProximity({
      event: {
        floor: event.floorId,
        latitude: at.latitude,
        longitude: at.longitude,
        alertRadiusM: event.radiusM,
      },
      workerFloor: worker.floorId,
      // A fresh fix: this is a preview of the decision, not a prediction of how
      // stale someone's GPS will be by the time they get it.
      gps: { ...fix, timestamp: nowMs },
      nowMs,
    });

    if (verdict.shouldPop) {
      inRange++;
      continue;
    }

    if (verdict.floorGate === 'mismatch') otherFloor++;
    else outOfRange++;

    // Only measured distances count. A worker suppressed on the floor axis has
    // a real distance too, and it is the more surprising number of the two —
    // "the nearest person who will hear nothing is 3 m away" is the whole point.
    if (verdict.distanceM !== null) {
      nearestSilentM =
        nearestSilentM === null ? verdict.distanceM : Math.min(nearestSilentM, verdict.distanceM);
    }
  }

  return { inRange, outOfRange, otherFloor, nearestSilentM, unknownPhones };
}
