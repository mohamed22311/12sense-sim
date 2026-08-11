/**
 * What the camera is looking at, and how hard the renderer is working.
 *
 * The two pure helpers below carry the only logic worth testing — validating a
 * floor against the site, and stepping up or down without falling off the ends
 * — so they can be exercised without a store or a renderer.
 */
import { create } from 'zustand';
import type { SiteDef } from '@/sites/types';
import { FACTORY } from '@/sites/factory';
import { SITE_ANCHOR } from '@/sites/anchor';
import type { LatLon } from '@/runtime/geo';
import { DEFAULT_ALERT_RADIUS_M } from '@/net/alerts';

export type QualityTier = 'high' | 'medium' | 'low';

export function isFloorActive(floorId: string, activeFloorId: string): boolean {
  return floorId === activeFloorId;
}

/**
 * The floor `delta` levels away, clamped at both ends. Clamping rather than
 * wrapping: pressing "up" on the top floor should do nothing, not teleport the
 * camera to the ground.
 */
export function nextFloorId(site: SiteDef, floorId: string, delta: number): string {
  const at = site.floors.findIndex((f) => f.id === floorId);
  if (at < 0) return floorId;
  const target = Math.min(site.floors.length - 1, Math.max(0, at + delta));
  return site.floors[target].id;
}

type BuildingState = {
  /**
   * The site being looked at. Held here rather than imported, because the
   * simulator now has two of them and every consumer below used to reach for
   * the factory by name — which is exactly the coupling the site data model
   * was written to avoid.
   */
  site: SiteDef;
  activeFloorId: string;
  qualityTier: QualityTier;
  /** a worker index, a machine id, or null for the overview */
  focus: string | null;
  /** the machine whose alert dialog is open, if any */
  selectedMachineId: string | null;
  /** the worker whose watch and vitals are open, if any */
  selectedWorkerIndex: number | null;
  /**
   * Alerts currently open, each pairing the asset with the event it raised.
   *
   * The event id is what makes this honest. Holding only asset ids left the
   * list a record of what this browser raised rather than of what is actually
   * open — and those drift apart the moment anyone acknowledges, because an
   * alert resolves on the *first* ack and that can happen on a phone.
   */
  openAlerts: readonly { assetId: string; eventId: string }[];
  /**
   * The scene point that corresponds to the site's real-world coordinate, and
   * the floor it was placed on (for drawing only — a coordinate has no floor).
   *
   * Moving it relocates the whole site on the earth without moving anybody in
   * it, which is what makes it possible to say "the real phone is standing
   * *there*" by pointing rather than by typing numbers.
   */
  anchorPoint: { floorId: string; x: number; z: number };
  /**
   * The real-world coordinate the anchor point corresponds to.
   *
   * Separate from the point itself, because they answer different questions:
   * the point says *which spot in the building* is the known one, and this
   * says *where on earth* that spot is. A demo only needs the second when a
   * physical handset is involved — until then the default is as good as any
   * coordinate, because every distance in the simulation is relative.
   */
  anchorLatLon: LatLon;
  /** How that coordinate was obtained, so the interface can say so. */
  /**
   * Where the anchor's coordinate came from.
   *
   * `manual` is the operator placing it on a map, which is the normal case:
   * "use my location" only ever answers where *this laptop* is, and the demo
   * is usually of a site somewhere else entirely.
   */
  anchorSource: 'default' | 'device' | 'manual';
  /** True while the operator is choosing where the anchor goes. */
  placingAnchor: boolean;
  /**
   * The anchor rides the driven worker.
   *
   * This is what makes a *physical* handset respond to the simulation. A real
   * phone reports its own GPS and runs the gate on its own device, so nothing
   * the simulator does can move it — but the gate compares the phone's fixed
   * position against the *alert's* coordinate, and the alert's coordinate comes
   * from the site frame. Pinning the frame's origin to the driven worker means
   * he always stands exactly where the phone is, so walking him toward a
   * machine walks that machine toward the phone. The distance the handset
   * computes changes because the site moved under it.
   */
  anchorFollowsControlled: boolean;

  setRadiusPreview(preview: BuildingState['radiusPreview']): void;

  /**
   * The worker whose wrist the camera is inside.
   *
   * Set by clicking a worker who is currently alarming; cleared by the red X
   * on the watch. While it is set the camera abandons the dollhouse framing
   * and flies to the raised forearm, and that worker's watch renders a
   * readable screen with the app's own buttons on it.
   *
   * In the store rather than in the HUD because three unrelated things need
   * it — the camera rig, the worker's pose, and the panel that opened it —
   * and threading it through the scene graph would mean re-rendering the
   * building to change a camera.
   */
  closeUpIndex: number | null;
  setCloseUp(index: number | null): void;

  /**
   * The radius being chosen right now, drawn on the floor as a red zone.
   *
   * Set while the machine dialog's radius control is open, cleared when it
   * closes. It exists because the number on a slider is not an answer to the
   * question the operator is actually asking — *who will this reach?* — and on
   * a 16 m floor the difference between 8 m and 20 m is the difference between
   * three people and everybody. Showing the circle answers it before the alert
   * is real and irreversible.
   */
  radiusPreview: { floorId: string; x: number; z: number; radiusM: number } | null;

  /**
   * The radius a new alert opens on, in metres.
   *
   * In the store rather than local to the machine dialog because the map
   * picker sets it too — an operator who has just drawn a 30 m circle over
   * real streets means that to be the radius, not a number the next dialog
   * forgets.
   */
  alertRadiusM: number;
  setAlertRadiusM(radiusM: number): void;
  setSite(site: SiteDef): void;
  setActiveFloor(floorId: string): void;
  stepFloor(delta: number): void;
  setQualityTier(tier: QualityTier): void;
  setFocus(focus: string | null): void;
  selectMachine(machineId: string | null): void;
  selectWorker(index: number | null): void;
  setOpenAlerts(alerts: readonly { assetId: string; eventId: string }[]): void;
  setAnchorPoint(point: { floorId: string; x: number; z: number }): void;
  setPlacingAnchor(placing: boolean): void;
  setAnchorFollowsControlled(following: boolean): void;
  setAnchorLatLon(at: LatLon, source: BuildingState['anchorSource']): void;
  reset(): void;
};

const INITIAL = {
  site: FACTORY as SiteDef,
  activeFloorId: FACTORY.floors[0].id,
  qualityTier: 'high' as QualityTier,
  focus: null as string | null,
  selectedMachineId: null as string | null,
  selectedWorkerIndex: null as number | null,
  openAlerts: [] as readonly { assetId: string; eventId: string }[],
  anchorPoint: { floorId: FACTORY.floors[0].id, x: 0, z: 0 },
  anchorLatLon: SITE_ANCHOR,
  anchorSource: 'default' as 'default' | 'device' | 'manual',
  placingAnchor: false,
  anchorFollowsControlled: false,
  radiusPreview: null as BuildingState['radiusPreview'],
  closeUpIndex: null as number | null,
  alertRadiusM: DEFAULT_ALERT_RADIUS_M,
};

export const useBuildingStore = create<BuildingState>((set, get) => ({
  ...INITIAL,

  setSite(site) {
    // Everything selected belongs to the old site, so it all goes: a machine
    // id from the factory names nothing in the construction site, and a stale
    // floor id would render an empty building.
    set({
      site,
      activeFloorId: site.floors[0].id,
      selectedMachineId: null,
      selectedWorkerIndex: null,
      openAlerts: [],
      // The anchor was placed on the other site's floor plan; keeping it would
      // put the origin somewhere that no longer means anything.
      anchorPoint: { floorId: site.floors[0].id, x: 0, z: 0 },
      placingAnchor: false,
      anchorFollowsControlled: false,
      closeUpIndex: null,
    });
  },

  setActiveFloor(floorId) {
    // Validated against the site rather than trusted: the floor id travels
    // from click handlers and from event payloads, and a bad one would render
    // an empty building rather than failing loudly.
    if (!get().site.floors.some((f) => f.id === floorId)) return;
    set({ activeFloorId: floorId });
  },

  stepFloor(delta) {
    set((s) => ({ activeFloorId: nextFloorId(s.site, s.activeFloorId, delta) }));
  },

  setQualityTier(qualityTier) {
    set({ qualityTier });
  },

  setRadiusPreview(radiusPreview) {
    set({ radiusPreview });
  },

  setAlertRadiusM(alertRadiusM) {
    set({ alertRadiusM });
  },

  setCloseUp(closeUpIndex) {
    // Selecting the worker too, so leaving the close-up lands on that worker's
    // panel rather than on whatever was selected before.
    set(
      closeUpIndex === null
        ? { closeUpIndex: null }
        : { closeUpIndex, selectedWorkerIndex: closeUpIndex, selectedMachineId: null },
    );
  },

  setFocus(focus) {
    set({ focus });
  },

  selectMachine(machineId) {
    if (machineId === null) {
      set({ selectedMachineId: null });
      return;
    }
    // Same reasoning as `setActiveFloor`: the id arrives from a click handler
    // and would otherwise open a dialog for a machine that does not exist.
    const floor = get().site.floors.find((f) => f.machines.some((m) => m.id === machineId));
    if (!floor) return;
    // Opening a machine closes a worker: they occupy the same panel, and two
    // things claiming it at once is how a panel starts flickering.
    set({ selectedMachineId: machineId, selectedWorkerIndex: null, activeFloorId: floor.id });
  },

  selectWorker(index) {
    // Selecting a worker closes any open machine dialog, for the same reason.
    // Clearing it unconditionally is right: on deselect there is nothing open
    // to preserve either.
    set({ selectedWorkerIndex: index, selectedMachineId: null });
  },

  setOpenAlerts(openAlerts) {
    set({ openAlerts });
  },

  setAnchorPoint(point) {
    if (!get().site.floors.some((f) => f.id === point.floorId)) return;
    set({ anchorPoint: point, placingAnchor: false });
  },

  setPlacingAnchor(placingAnchor) {
    // Placing by hand and following the worker are two ways to say where the
    // origin is; turning one on has to turn the other off.
    set({ placingAnchor, anchorFollowsControlled: placingAnchor ? false : get().anchorFollowsControlled });
  },

  setAnchorFollowsControlled(anchorFollowsControlled) {
    set({ anchorFollowsControlled, placingAnchor: false });
  },

  setAnchorLatLon(anchorLatLon, anchorSource) {
    set({ anchorLatLon, anchorSource });
  },

  /**
   * Back to the overview of the *current* site, not back to the factory.
   * Ending a session should not silently switch which building is on screen.
   */
  reset() {
    set((s) => ({ ...INITIAL, site: s.site, activeFloorId: s.site.floors[0].id }));
  },
}));

/**
 * Dev convenience — drive the camera from the console or a Playwright probe,
 * mirroring what `state/store.ts` already exposes. Also genuinely useful in a
 * demo: jumping straight to a floor without hunting for its slab.
 */
if (typeof window !== 'undefined') {
  (window as unknown as { __building: unknown }).__building = {
    setFloor: (id: string) => useBuildingStore.getState().setActiveFloor(id),
    stepFloor: (delta: number) => useBuildingStore.getState().stepFloor(delta),
    setQuality: (tier: QualityTier) => useBuildingStore.getState().setQualityTier(tier),
    state: () => useBuildingStore.getState(),
  };
}
