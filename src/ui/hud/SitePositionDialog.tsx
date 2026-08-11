import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import {
  MAX_RADIUS_M,
  MIN_RADIUS_M,
  formatLatLon,
  formatRadius,
  normalizeLat,
  normalizeLon,
  normalizeRadius,
  parseZone,
  type Zone,
} from '@/lib/geo';

/**
 * Where the site is, set by hand.
 *
 * The anchor decides where every machine and every worker in this simulation
 * actually is on the earth, which is the number a real handset's GPS gets
 * compared against. It could previously only be the built-in default or
 * whatever the browser reported for *this* machine — no use at all when the
 * demo is of a plant in another country, or when the presenter is at a desk
 * and the story is about a site they are not standing in.
 *
 * The number fields are the real inputs. The map is a way of filling them in.
 * That ordering is deliberate: it is what lets the picker survive a blocked
 * tile host, and what makes it usable by keyboard.
 */

// Fetched only when someone opens this dialog. The scene is already the heavy
// thing on the page; Leaflet has no business in its initial bundle.
const ZoneMap = lazy(() => import('@/ui/map/ZoneMap').then((m) => ({ default: m.ZoneMap })));

export type SitePositionDialogProps = {
  /** where the site sits now, and how far its alerts reach */
  zone: Zone;
  onApply(zone: Zone): void;
  onClose(): void;
};

/** Radii worth one tap, spanning "this machine" to "this whole site". */
const RADIUS_PRESETS = [12, 30, 75, 250];

/**
 * A number field whose *text* is the state while it is being edited.
 *
 * Binding an input straight to a clamping function makes it hostile: clearing
 * it, or typing the `-` of a southern latitude, produces NaN and the field
 * fights back mid-keystroke. The committed number only moves when what is
 * typed parses; on blur the field shows what was actually committed.
 */
function useNumberField(external: number, commit: (value: number) => void) {
  const [text, setText] = useState(String(external));
  const [editing, setEditing] = useState(false);

  // Re-sync when something else moves the value — a map drag, a preset.
  useEffect(() => {
    if (!editing) setText(String(external));
  }, [external, editing]);

  return {
    value: text,
    onFocus: () => setEditing(true),
    onBlur: () => {
      setEditing(false);
      setText(String(external));
    },
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value;
      setText(next);
      const parsed = Number(next);
      if (next.trim() !== '' && Number.isFinite(parsed)) commit(parsed);
    },
  };
}

export function SitePositionDialog({ zone: initial, onApply, onClose }: SitePositionDialogProps) {
  const [zone, setZone] = useState<Zone>(initial);
  const [focusToken, setFocusToken] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  const focusZone = () => setFocusToken((token) => token + 1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lat = useNumberField(zone.lat, (value) =>
    setZone((z) => ({ ...z, lat: normalizeLat(value) })),
  );
  const lon = useNumberField(zone.lon, (value) =>
    setZone((z) => ({ ...z, lon: normalizeLon(value) })),
  );
  const radius = useNumberField(zone.radiusM, (value) =>
    setZone((z) => ({ ...z, radiusM: normalizeRadius(value, initial.radiusM) })),
  );

  // The same parser the fields feed. A zone that will not parse cannot be
  // applied, and saying so here beats moving sixty workers to NaN.
  const parsed = parseZone({
    lat: String(zone.lat),
    lon: String(zone.lon),
    radiusM: String(zone.radiusM),
  });

  return (
    <div className="dialog-scrim" onClick={onClose}>
      <div
        ref={dialogRef}
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="site-position-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dialog-head">
          <div>
            <p className="dialog-eyebrow">Site anchor</p>
            <h2 className="dialog-title" id="site-position-title">
              Where this site is
            </h2>
            <p className="dialog-asset">{formatLatLon(zone.lat, zone.lon)}</p>
          </div>
          <button className="dialog-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="dialog-body">
          <Suspense
            fallback={
              <div className="zone-map zone-map-failed">
                <p>Loading map…</p>
              </div>
            }
          >
            <ZoneMap
              zone={zone}
              onChange={setZone}
              focusToken={focusToken}
              fallbackRadiusM={initial.radiusM}
            />
          </Suspense>

          <div className="zone-fields">
            <label className="field">
              <span className="field-label">Latitude</span>
              {/*
                `type="text"`, not `type="number"`. A number input sanitises its
                own value, so while you are part way through typing a southern
                latitude the lone `-` is not a number: the DOM reports "" and
                the character is discarded before any handler sees it.
                `inputMode="decimal"` still raises the numeric keypad.
              */}
              <input
                className="field-input"
                type="text"
                inputMode="decimal"
                pattern="-?\d*\.?\d*"
                autoComplete="off"
                spellCheck={false}
                {...lat}
              />
            </label>

            <label className="field">
              <span className="field-label">Longitude</span>
              <input
                className="field-input"
                type="text"
                inputMode="decimal"
                pattern="-?\d*\.?\d*"
                autoComplete="off"
                spellCheck={false}
                {...lon}
              />
            </label>

            <label className="field">
              <span className="field-label">Alert radius (m)</span>
              <input
                className="field-input"
                type="number"
                step="1"
                min={MIN_RADIUS_M}
                max={MAX_RADIUS_M}
                {...radius}
              />
            </label>
          </div>

          <div className="chip-row">
            {RADIUS_PRESETS.map((preset) => (
              <button
                key={preset}
                className={`chip${zone.radiusM === preset ? ' is-on' : ''}`}
                aria-pressed={zone.radiusM === preset}
                onClick={() => {
                  setZone((z) => ({ ...z, radiusM: preset }));
                  // A 250 m circle does not fit a street-level view.
                  focusZone();
                }}
              >
                {formatRadius(preset)}
              </button>
            ))}
            <button className="chip" onClick={focusZone}>
              Go there
            </button>
          </div>

          <p className="dialog-note">
            <strong>{formatLatLon(zone.lat, zone.lon)}</strong> · {formatRadius(zone.radiusM)}
          </p>

          {/*
            The rule stated, rather than left for the circle to imply. The first
            surprise anyone has with this feature is a phone outside the circle
            alarming anyway.
          */}
          <p className="dialog-note">
            The circle is <strong>the gate each phone runs</strong>, not a filter on who is
            sent the alert. Every phone in the company receives it and compares its
            own position and floor against this circle. A phone that cannot prove it is
            outside — no location permission, no fix, or a fix older than two minutes —
            alarms anyway. So a tight circle is never a guarantee of silence outside it.
          </p>

          {parsed === null && (
            <p className="dialog-error" role="alert">
              That position is not usable — check the latitude, longitude and radius.
            </p>
          )}

          <div className="dialog-actions">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={parsed === null}
              onClick={() => {
                if (parsed) onApply(parsed);
              }}
            >
              Put the site here
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
