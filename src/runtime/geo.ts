/**
 * Scene metres ↔ WGS-84.
 *
 * The simulator's proximity story only means anything if the coordinates are
 * real: machines carry genuine lat/lon, a worker's GPS fix derives from where
 * they are actually standing, and the vendored `decideProximity` runs the true
 * haversine over both. This module is the whole of that mapping.
 *
 * A local tangent-plane approximation is deliberate and sufficient: a site is
 * a few hundred metres across. The approximation error depends on latitude and
 * angular separation; at site scale (100–200 m), the error against a full
 * geodesic is typically a few centimetres — far below the metre-scale radii
 * the gate compares.
 *
 * Scene convention: +x is east, +z is north, both in metres.
 */

export type LatLon = { latitude: number; longitude: number };

/**
 * Metres per degree of latitude, derived from Earth's mean radius.
 * Must match EARTH_RADIUS_M in @/phone/vendor/realtime/proximity (6_371_008.8 m):
 * METERS_PER_DEG_LAT = 6_371_008.8 * π / 180 ≈ 111_194.93
 *
 * If the vendored radius changes, recalculate this to keep distance agreement tight.
 */
export const METERS_PER_DEG_LAT = 6_371_008.8 * (Math.PI / 180);

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Metres per degree of longitude shrinks with latitude by cos(lat). */
const metersPerDegLon = (latitude: number) =>
  METERS_PER_DEG_LAT * Math.cos(toRad(latitude));

/**
 * Where the site sits on the earth: which scene point maps to which coordinate.
 *
 * Scene coordinates are metres from an arbitrary origin, and that origin has
 * to correspond to *somewhere*. Making it explicit rather than assuming the
 * scene's own (0, 0) is what lets the anchor be moved: put the origin under a
 * particular spot on a floor and the whole site relocates around it, without a
 * single position in the simulation changing. Every phone's distance to every
 * alert is preserved, because a translation preserves all of them.
 */
export type SceneFrame = {
  /** The real-world coordinate `origin` corresponds to. */
  anchor: LatLon;
  /** The scene point that sits at `anchor`, in metres. */
  origin: { x: number; z: number };
};

/** A scene position as a coordinate, through a frame. */
export function frameToLatLon(frame: SceneFrame, x: number, z: number): LatLon {
  return sceneToLatLon(frame.anchor, x - frame.origin.x, z - frame.origin.z);
}

export function sceneToLatLon(anchor: LatLon, x: number, z: number): LatLon {
  const latitude = anchor.latitude + z / METERS_PER_DEG_LAT;
  return { latitude, longitude: anchor.longitude + x / metersPerDegLon(latitude) };
}

export function latLonToScene(anchor: LatLon, at: LatLon): { x: number; z: number } {
  const z = (at.latitude - anchor.latitude) * METERS_PER_DEG_LAT;
  return { x: (at.longitude - anchor.longitude) * metersPerDegLon(at.latitude), z };
}
