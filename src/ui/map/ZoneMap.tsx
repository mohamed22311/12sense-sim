import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import type { Circle, Map as LeafletMap, Marker } from 'leaflet';
import {
  distanceM,
  edgeOf,
  formatRadius,
  normalizeLat,
  normalizeLon,
  normalizeRadius,
  zoomForRadius,
  type Zone,
} from '@/lib/geo';

/**
 * Pick a point on the earth by hand.
 *
 * The site's anchor decides where every machine and every worker in this
 * simulation actually *is* — it is the number a real handset's GPS is compared
 * against. Until now the only ways to set it were to accept a hardcoded
 * default or to press "use my location", which is no use at all when the
 * demo is of a factory in another country.
 *
 * Leaflet is loaded inside an effect, never at module scope, and this whole
 * module is behind a `lazy()` so the map is fetched only when someone opens
 * the picker. The 3D scene is already the heavy thing on this page.
 *
 * The map is an *enhancement*. Everything it sets is also typed into the
 * number fields beside it, which are the real inputs — if the tiles are
 * blocked or the import fails, the picker still works.
 */

export type ZoneMapProps = {
  zone: Zone;
  onChange(zone: Zone): void;
  disabled?: boolean;
  /**
   * Incremented by the parent on a deliberate "take me there" — never on an
   * ordinary edit. See the focus effect below for why that distinction is the
   * whole design.
   */
  focusToken?: number;
  /** the smallest radius this picker will produce, for the fallback path */
  fallbackRadiusM: number;
};

/** Roughly the dialog's transition, after which the container has a size. */
const SIZE_SETTLE_MS = 220;

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Required by OpenStreetMap's terms. Do not remove. */
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * Leaflet exposes no public "is this marker being dragged" flag, and the sync
 * effect needs one — see its comment. Reaching into the private field is
 * deliberate and is guarded so a Leaflet upgrade degrades to a stutter rather
 * than a crash.
 */
function isDragging(marker: Marker): boolean {
  const dragging = (marker as unknown as { dragging?: { _draggable?: { _moving?: boolean } } })
    .dragging;
  return Boolean(dragging?._draggable?._moving);
}

export function ZoneMap({
  zone,
  onChange,
  disabled = false,
  focusToken = 0,
  fallbackRadiusM,
}: ZoneMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const circleRef = useRef<Circle | null>(null);
  const centreRef = useRef<Marker | null>(null);
  const handleRef = useRef<Marker | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  /*
    The latest props, readable from Leaflet's callbacks without re-binding them
    on every render. This is the structural decision the whole component rests
    on: if the init effect depended on `zone`, every frame of a drag would tear
    the map down and rebuild it, and the drag would fight itself.
  */
  const zoneRef = useRef(zone);
  zoneRef.current = zone;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const fallbackRef = useRef(fallbackRadiusM);
  fallbackRef.current = fallbackRadiusM;

  // Created exactly once. See the note above about the empty dependency array.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        // Inside the effect, never at module scope: Leaflet touches `window`
        // the moment it is imported.
        const L = await import('leaflet');
        if (cancelled || !hostRef.current) return;

        const start = zoneRef.current;
        const map = L.map(hostRef.current, {
          center: [start.lat, start.lon],
          zoom: zoomForRadius(start.radiusM, start.lat),
          zoomControl: true,
          attributionControl: true,
        });

        L.tileLayer(TILE_URL, {
          attribution: TILE_ATTRIBUTION,
          maxZoom: 19,
          crossOrigin: true,
        }).addTo(map);

        // `L.circle`'s radius is in metres — unlike `L.circleMarker`, whose is
        // in pixels. That is what keeps the circle honest at every zoom.
        const circle = L.circle([start.lat, start.lon], {
          radius: start.radiusM,
          className: 'zone-circle',
        }).addTo(map);

        /*
          Both handles are CSS-only div icons. Leaflet's default marker icon
          resolves image URLs in a way that breaks under bundlers — the classic
          missing-marker bug — and a span inherits this app's own tokens.
        */
        const pin = (kind: 'pin' | 'handle') =>
          L.divIcon({
            className: '',
            html: `<span class="zone-${kind}" aria-hidden="true"></span>`,
            iconSize: kind === 'pin' ? [18, 18] : [16, 16],
            iconAnchor: kind === 'pin' ? [9, 9] : [8, 8],
          });

        const centre = L.marker([start.lat, start.lon], {
          icon: pin('pin'),
          draggable: true,
          keyboard: true,
          title: 'The site’s position — drag to move',
        }).addTo(map);

        const edge = edgeOf(start);
        const handle = L.marker([edge.lat, edge.lon], {
          icon: pin('handle'),
          draggable: true,
          keyboard: true,
          title: 'Drag to resize the alert radius',
        }).addTo(map);

        const emit = (next: Zone) => {
          if (disabledRef.current) return;
          onChangeRef.current(next);
        };

        // `drag`, not `dragend`: the circle must track the pin continuously
        // rather than jumping when it is released.
        centre.on('drag', () => {
          const { lat, lng } = centre.getLatLng();
          emit({ ...zoneRef.current, lat: normalizeLat(lat), lon: normalizeLon(lng) });
        });

        handle.on('drag', () => {
          const { lat, lng } = handle.getLatLng();
          const current = zoneRef.current;
          emit({
            ...current,
            radiusM: normalizeRadius(
              distanceM({ lat: current.lat, lon: current.lon }, { lat, lon: lng }),
              fallbackRef.current,
            ),
          });
        });

        // Clicking anywhere moves the site — the fastest way to place one.
        map.on('click', (event) => {
          emit({
            ...zoneRef.current,
            lat: normalizeLat(event.latlng.lat),
            lon: normalizeLon(event.latlng.lng),
          });
        });

        mapRef.current = map;
        circleRef.current = circle;
        centreRef.current = centre;
        handleRef.current = handle;
        setStatus('ready');

        // The map is created inside a dialog that is still animating open, so
        // its container has no size yet and Leaflet paints a grey box.
        setTimeout(() => map.invalidateSize(), SIZE_SETTLE_MS);
      } catch {
        if (!cancelled) setStatus('failed');
      }
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      circleRef.current = null;
      centreRef.current = null;
      handleRef.current = null;
    };
  }, []);

  // Push changes from the fields, the presets and the map's own drags back
  // into the layers.
  useEffect(() => {
    circleRef.current?.setLatLng([zone.lat, zone.lon]);
    circleRef.current?.setRadius(zone.radiusM);

    /*
      The `isDragging` guards are the fix for a stutter, not a nicety. A drag
      calls `onChange`, the parent re-renders with a new zone, and this effect
      would then `setLatLng` the marker *underneath the pointer* — the pin
      snaps and the radius handle jitters as its edge position is recomputed.
      Skipping a marker that is mid-drag lets Leaflet's own drag own the
      position until release.
    */
    const centre = centreRef.current;
    if (centre && !isDragging(centre)) centre.setLatLng([zone.lat, zone.lon]);

    const handle = handleRef.current;
    if (handle && !isDragging(handle)) {
      const edge = edgeOf(zone);
      handle.setLatLng([edge.lat, edge.lon]);
    }
  }, [zone]);

  /*
    The viewport moves only when the operator asks for it.

    Not on every zone change: the zone changes on every frame of a drag and
    every keystroke in the coordinate fields, and panning underneath either of
    those fights the person doing it. The parent increments `focusToken` on a
    deliberate command — a preset, or a typed coordinate committed with the
    "Go there" button — and only that moves the map.

    `flyToBounds` on the circle rather than `setView` on the centre, so the
    whole zone is framed: a 1 km circle centred at street zoom is still
    entirely off screen.
  */
  useEffect(() => {
    if (!focusToken) return; // 0 is the initial value; never fly on mount
    const map = mapRef.current;
    const circle = circleRef.current;
    if (!map || !circle) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    map.flyToBounds(circle.getBounds(), {
      padding: [40, 40],
      maxZoom: 18,
      animate: !reduced,
      duration: 0.6,
    });
  }, [focusToken]);

  if (status === 'failed') {
    return (
      <div className="zone-map zone-map-failed">
        <p>
          The map could not load. The coordinates and radius below still work —
          the map is only a way of choosing them.
        </p>
      </div>
    );
  }

  return (
    <div className={`zone-map${disabled ? ' is-disabled' : ''}`}>
      {/*
        A pointing device for the fields below, which carry the same values as
        text. Screen-reader and keyboard users get the labelled number inputs,
        which are the real and always-sufficient path.
      */}
      <div className="zone-map-host" ref={hostRef} role="presentation" />

      {status === 'loading' && (
        <div className="zone-map-overlay">
          <p>Loading map…</p>
        </div>
      )}

      <p className="zone-map-hint">
        Click to move · drag the ring to resize · {formatRadius(zone.radiusM)}
      </p>
    </div>
  );
}
