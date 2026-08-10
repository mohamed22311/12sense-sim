import type { LatLon } from '@/runtime/geo';

/**
 * Where the site stands on the earth.
 *
 * One constant, because two consumers have to agree exactly: the fleet
 * converts every phone's scene position to a coordinate against this anchor,
 * and a machine's alert is raised at a coordinate derived the same way. If
 * they drift apart, every phone measures its distance to the alert from the
 * wrong origin and the proximity gate — the behaviour this demo exists to
 * show — quietly produces the wrong answer.
 *
 * Cairo, near the Nile: an unremarkable choice, but a real place, so the
 * coordinates in the server's own records read as coordinates rather than as
 * `0, 0`.
 */
export const SITE_ANCHOR: LatLon = { latitude: 30.04412, longitude: 31.23571 };
