import { useEffect, useMemo, useRef, useState } from 'react';
import type { Agents } from '@/sim/agents';
import type { MachineDef } from '@/sites/types';
import { previewReach } from '@/ui/hud/reachPreview';
import {
  ALERT_RADIUS_MAX_M,
  ALERT_RADIUS_MIN_M,
  ALERT_TYPES,
  DEFAULT_ALERT_RADIUS_M,
  raiseAlert,
  type RaiseAlertResult,
  type Severity,
} from '@/net/alerts';
import { frameToLatLon } from '@/runtime/geo';
import { useBuildingStore } from '@/state/buildingStore';

/**
 * Raise an alert on a machine.
 *
 * This dialog is the demo's only piece of pure fiction — a dispatcher would
 * not type this, a sensor would send it. Everything downstream of the button
 * is real: a real event id from the real ingestion pipeline, fanned out over
 * the phones' real sockets, counted by the real analytics.
 *
 * So the dialog's job is to make the *inputs* honest. The alert types are the
 * ones the machine in question could actually raise, the coordinate is the
 * machine's own position resolved against the site anchor, and the floor is
 * the floor it stands on — which means the phones' floor gate is exercised
 * rather than bypassed.
 */

export type MachineDialogProps = {
  machine: MachineDef;
  /** the simulation, for previewing who this alert would reach. Null in `?preview`. */
  agents: Agents | null;
  /** null in `?preview`, where there is no tenant to raise anything into */
  adminToken: string | null;
  onClose(): void;
  onRaised(machineId: string, result: RaiseAlertResult): void;
};

const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];

export function MachineDialog({ machine, agents, adminToken, onClose, onRaised }: MachineDialogProps) {
  const presets = ALERT_TYPES[machine.kind];
  const [presetIndex, setPresetIndex] = useState(0);
  const [severity, setSeverity] = useState<Severity>(presets[0].severity);
  const [message, setMessage] = useState(presets[0].message);
  const [radius, setRadius] = useState(DEFAULT_ALERT_RADIUS_M);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RaiseAlertResult | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Through the same frame the phones use. If the alert were placed against a
  // different origin than the one the phones measure from, every proximity
  // verdict in the demo would be wrong by however far the anchor had moved.
  const origin = useBuildingStore((s) => s.anchorPoint);
  const anchor = useBuildingStore((s) => s.anchorLatLon);
  const coordinate = useMemo(
    () => frameToLatLon({ anchor, origin }, machine.position.x, machine.position.z),
    [machine.position.x, machine.position.z, origin, anchor],
  );

  /*
    Draw the reach on the floor for as long as this dialog is composing an
    alert, and take it away when it closes or the alert has been raised.

    Tied to the dialog's lifetime rather than to the slider being dragged: the
    radius is one of several fields, and an operator who picks a severity after
    setting the radius should not watch the zone vanish because they stopped
    touching it.
  */
  const setRadiusPreview = useBuildingStore((s) => s.setRadiusPreview);
  useEffect(() => {
    if (result) {
      setRadiusPreview(null);
      return;
    }
    setRadiusPreview({
      floorId: machine.floor,
      x: machine.position.x,
      z: machine.position.z,
      radiusM: radius,
    });
  }, [machine.floor, machine.position.x, machine.position.z, radius, result, setRadiusPreview]);

  // Cleared on unmount too — closing with Escape must not leave a red circle
  // burning on the floor of a demo.
  useEffect(() => () => setRadiusPreview(null), [setRadiusPreview]);

  /*
    Who this would reach, recomputed as the radius moves.

    Through the same vendored gate the phones run, so the number shown before
    the alert is the number that happens after it. Workers move, so this is a
    snapshot of the moment it was computed — close enough to answer "is this
    radius the one I want", which is the only question being asked here.
  */
  const preview = useMemo(() => {
    if (!agents) return null;
    return previewReach(
      { floorId: machine.floor, x: machine.position.x, z: machine.position.z, radiusM: radius },
      agents.all(),
      { anchor, origin },
    );
  }, [agents, machine.floor, machine.position.x, machine.position.z, radius, anchor, origin]);

  // Escape closes, and focus moves into the dialog on open — this is a modal
  // over a 3D canvas that otherwise swallows every key and pointer event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const choosePreset = (index: number) => {
    setPresetIndex(index);
    setSeverity(presets[index].severity);
    setMessage(presets[index].message);
  };

  const submit = async () => {
    if (!adminToken || busy) return;
    setBusy(true);
    setError(null);
    try {
      const raised = await raiseAlert(
        {
          assetId: machine.id,
          assetLabel: machine.label,
          floor: machine.floor,
          severity,
          type: presets[presetIndex].type,
          message,
          latitude: coordinate.latitude,
          longitude: coordinate.longitude,
          alertRadiusM: radius,
        },
        adminToken,
      );
      setResult(raised);
      onRaised(machine.id, raised);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-scrim" onClick={onClose}>
      <div
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="machine-dialog-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dialog-head">
          <div>
            <p className="dialog-eyebrow">Floor {machine.floor} · {machine.kind}</p>
            <h2 className="dialog-title" id="machine-dialog-title">{machine.label}</h2>
            <p className="dialog-asset">{machine.id}</p>
          </div>
          <button className="dialog-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        {result ? (
          <div className="dialog-body">
            <p className="dialog-success">Alert raised.</p>
            <dl className="dialog-facts">
              <div><dt>Event</dt><dd className="mono">{result.event_id}</dd></div>
              <div><dt>Delivered over socket</dt><dd>{result.delivered}</dd></div>
              {result.seeded !== undefined && (
                <div><dt>Seeded to roster</dt><dd>{result.seeded}</dd></div>
              )}
            </dl>
            <p className="dialog-note">
              Every phone in range is deciding for itself whether to alarm. Watch the
              watches — the ones that ring are the ones whose own gate said yes.
            </p>
            <div className="dialog-actions">
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </div>
        ) : (
          <div className="dialog-body">
            <fieldset className="field">
              <legend>What happened</legend>
              <div className="chip-row">
                {presets.map((preset, i) => (
                  <button
                    key={preset.type}
                    className={`chip${i === presetIndex ? ' is-on' : ''}`}
                    onClick={() => choosePreset(i)}
                    aria-pressed={i === presetIndex}
                  >
                    {preset.type}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="field">
              <span className="field-label">Message</span>
              <textarea
                className="field-input"
                rows={2}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </label>

            <fieldset className="field">
              <legend>Severity</legend>
              <div className="chip-row">
                {SEVERITIES.map((s) => (
                  <button
                    key={s}
                    className={`chip chip-${s}${s === severity ? ' is-on' : ''}`}
                    onClick={() => setSeverity(s)}
                    aria-pressed={s === severity}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="field">
              <span className="field-label">
                Alert radius <span className="field-value">{radius} m</span>
              </span>
              <input
                className="field-range"
                type="range"
                min={ALERT_RADIUS_MIN_M}
                max={ALERT_RADIUS_MAX_M}
                step={1}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
              />

              {/*
                The count, beside the circle on the floor. Stated before the
                button because raising is irreversible on a live server, and
                "this will reach four of the eleven people on this floor" is
                the fact that decides whether this is the right radius.
              */}
              {preview ? (
                <span className="reach-preview">
                  <span className="reach-preview-lead">
                    <strong>{preview.inRange}</strong> would be alerted
                  </span>
                  {preview.outOfRange > 0 && (
                    <span className="reach-preview-part">
                      {preview.outOfRange} on this floor, outside the circle
                    </span>
                  )}
                  {preview.otherFloor > 0 && (
                    <span className="reach-preview-part">
                      {preview.otherFloor} on other floors, whatever the distance
                    </span>
                  )}
                  {preview.nearestSilentM !== null && preview.nearestSilentM < 15 && (
                    <span className="reach-preview-note">
                      Nearest who would not hear it: {preview.nearestSilentM.toFixed(1)} m away.
                    </span>
                  )}
                </span>
              ) : (
                <span className="field-hint">
                  Each phone measures its own distance from{' '}
                  {coordinate.latitude.toFixed(5)}, {coordinate.longitude.toFixed(5)} and
                  decides alone.
                </span>
              )}
            </label>

            {error && <p className="dialog-error" role="alert">{error}</p>}
            {!adminToken && (
              <p className="dialog-note">
                Preview mode has no tenant — start a session from the setup screen to
                raise a real alert.
              </p>
            )}

            <div className="dialog-actions">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={submit}
                disabled={busy || !adminToken || message.trim().length === 0}
              >
                {busy ? 'Raising…' : 'Raise alert'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
