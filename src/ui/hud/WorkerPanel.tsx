import { useEffect, useState } from 'react';
import type { VirtualPhone } from '@/phone/VirtualPhone';
import type { VitalsBuffer } from '@/phone/vitalsBuffer';
import type { Activity } from '@/sim/jobs';
import type { RiskBand } from '@/api/types';
import { BACKFILL_MS } from '@/phone/vitalsBuffer';

/**
 * One worker, up close: what they are doing, what their watch is showing, and
 * the two dials that make something happen to them.
 *
 * The watch half is a readout, not a control surface for the alert — the
 * *phone* decided whether to alarm and which channels to use, on its own, from
 * this worker's own position and floor. All this panel does is show that
 * verdict and offer the two answers a real watch offers: acknowledge, or
 * snooze. Both post to the server exactly as the app does.
 *
 * The vitals half is the opposite: it is an input. Dragging heart rate up and
 * sending rewrites the trailing minutes of this worker's buffer, and then the
 * **unmodified** risk engine reads that buffer on its next poll and decides for
 * itself whether to raise. Nothing here fakes an alert — it makes one true.
 */

export type WorkerSample = {
  index: number;
  name: string;
  activity: Activity;
  floorId: string;
  hr: number | null;
  spo2: number | null;
  riskBand: RiskBand;
  alert: { message: string; assetLabel: string | null; modality: string[]; distanceM: number | null } | null;
  /** the last health alert this worker's own phone raised, if any */
  health: { band: 'caution' | 'danger'; reason: string; at: number } | null;
  /**
   * The same alert as the worker's watch shows it.
   *
   * The app wakes the worker for these — a titled notification on an
   * alarm-grade channel, a full-screen surface for danger, vibration on every
   * variant — so the simulated watch shows it too rather than only moving the
   * band chip.
   */
  healthAlert: {
    band: 'caution' | 'danger';
    title: string;
    reason: string;
    channels: string[];
    acknowledged: boolean;
  } | null;
  online: boolean;
};

export type WorkerPanelProps = {
  sample: WorkerSample;
  /**
   * This worker's phone, or null in `?preview` where no account exists. The
   * panel takes the phone and the buffer directly rather than the fleet: they
   * are the only two things it touches, and naming them makes it obvious that
   * the panel cannot reach past this worker into anyone else's.
   */
  phone: VirtualPhone | null;
  buffer: VitalsBuffer | null;
  /** Answer a health alert. Routed through the seam, because in preview there
      is no phone and the standalone engine holds the alert instead. */
  onAcknowledgeHealth(): Promise<void>;
  /** this worker is the one being driven */
  controlled: boolean;
  onToggleControl(): void;
  onMoveToFloor(floorId: string): void;
  floors: ReadonlyArray<{ id: string; label: string }>;
  /**
   * Remove this worker from the company. Absent in `?preview`, where there is
   * no tenant and nobody to remove.
   */
  onOffboard?: () => Promise<{ devices_removed: number; sockets_closed: number }>;
  onClose(): void;
};

/** Snooze length offered on the watch, matching the app's own. */
const SNOOZE_MS = 5 * 60_000;

const ACTIVITY_COPY: Record<Activity, string> = {
  walking: 'Walking',
  climbing: 'On the stairs',
  carrying: 'Carrying stock',
  operating: 'Operating a machine',
  inspecting: 'Inspecting',
  logging: 'At a terminal',
  sweeping: 'Sweeping',
  talking: 'Talking with a colleague',
  resting: 'On a break',
};

const BAND_COPY: Record<RiskBand, string> = {
  normal: 'Normal',
  caution: 'Caution',
  danger: 'Danger',
};

export function WorkerPanel({
  sample,
  phone,
  buffer,
  onAcknowledgeHealth,
  controlled,
  onToggleControl,
  onMoveToFloor,
  floors,
  onOffboard,
  onClose,
}: WorkerPanelProps) {
  const [hr, setHr] = useState(sample.hr ?? 78);
  // Rounded on the way in: the physiology writes a fractional saturation, and
  // a slider stepping in whole percent would jump on first drag otherwise.
  const [spo2, setSpo2] = useState(Math.round(sample.spo2 ?? 98));
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOffboard, setConfirmOffboard] = useState(false);
  const [offboarded, setOffboarded] = useState<{ sockets: number } | null>(null);

  // A different worker in the same panel starts from that worker's numbers,
  // not from the last one's — otherwise clicking through a crowd carries a
  // stale reading from person to person.
  useEffect(() => {
    setConfirmOffboard(false);
    setOffboarded(null);
    setHr(sample.hr ?? 78);
    setSpo2(Math.round(sample.spo2 ?? 98));
    setSent(false);
    setError(null);
  }, [sample.index]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A health alert the worker has not answered yet. */
  const unansweredHealth = sample.healthAlert !== null && !sample.healthAlert.acknowledged;

  const acknowledgeHealth = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAcknowledgeHealth();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const offboard = async () => {
    if (!onOffboard || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onOffboard();
      setOffboarded({ sockets: result.sockets_closed });
      setConfirmOffboard(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const respond = async (action: 'ack' | 'snooze') => {
    if (!phone || busy) return;
    setBusy(true);
    setError(null);
    try {
      const now = Date.now();
      if (action === 'ack') await phone.ack(now);
      else await phone.snooze(now + SNOOZE_MS, now);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sendVitals = () => {
    if (!buffer) return;
    const now = Date.now();
    // The trailing window, not one reading: every rule the engine applies is a
    // *sustained* one, so a single spiked sample would be filtered out as
    // noise — correctly. Rewriting the run is what a genuinely elevated
    // worker's history looks like.
    buffer.backfillHr(hr, BACKFILL_MS, now);
    buffer.setSpo2(spo2, now);
    setSent(true);
  };

  return (
    <section className="hud-card worker-card">
      <header className="worker-head">
        <div>
          <h2 className="hud-card-title">Worker {sample.index}</h2>
          {/* Only when there is a real one. In preview the roster is empty and
              the fallback is "Worker 19", which the heading already says. */}
          {sample.name !== `Worker ${sample.index}` && (
            <p className="worker-name">{sample.name}</p>
          )}
        </div>
        <button className="dialog-close" onClick={onClose} aria-label="Close">×</button>
      </header>

      <p className="worker-doing">
        {ACTIVITY_COPY[sample.activity]} · Floor {sample.floorId}
      </p>

      {/*
        Driving him. The button is here rather than in a mode switch because
        taking control is a thing you do *to a worker*, and this is the panel
        that is already about one.
      */}
      <div className="worker-control">
        <button
          className={`btn${controlled ? ' btn-primary' : ''}`}
          onClick={onToggleControl}
        >
          {controlled ? 'Release control' : 'Take control'}
        </button>
        {controlled && (
          <>
            <p className="worker-note">W A S D, arrows, or click a spot on his floor.</p>
            <label className="field">
              <span className="field-label">Move to floor</span>
              <select
                className="field-input"
                value={sample.floorId}
                onChange={(e) => onMoveToFloor(e.target.value)}
              >
                {floors.map((floor) => (
                  <option key={floor.id} value={floor.id}>
                    {floor.id} · {floor.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>

      {/*
        The watch. Its face is the phone's verdict, rendered.

        Three states, in the order the worker would experience them: a group
        alert wins the face because it is the one with a response deadline; an
        unanswered health alert takes it next, because the app wakes the worker
        for those rather than filing them silently; otherwise the resting face.
      */}
      <div
        className={`watch${sample.alert ? ' is-alerting' : ''}${
          !sample.alert && unansweredHealth ? ` is-health-${sample.healthAlert!.band}` : ''
        }`}
      >
        <div className="watch-face">
          {sample.alert ? (
            <>
              <p className="watch-alert-label">{sample.alert.assetLabel ?? 'Alert'}</p>
              <p className="watch-alert-message">{sample.alert.message}</p>
              <ul className="watch-modality">
                {sample.alert.modality.map((channel) => (
                  <li key={channel} className={`watch-channel is-${channel}`}>{channel}</li>
                ))}
              </ul>
              {sample.alert.distanceM !== null && (
                <p className="watch-distance">{Math.round(sample.alert.distanceM)} m away</p>
              )}
            </>
          ) : unansweredHealth ? (
            <>
              <p className="watch-alert-label">{sample.healthAlert!.title}</p>
              <p className="watch-alert-message">{sample.healthAlert!.reason}</p>
              <ul className="watch-modality">
                {sample.healthAlert!.channels.map((channel) => (
                  <li key={channel} className={`watch-channel is-${channel}`}>{channel}</li>
                ))}
              </ul>
              <p className="watch-distance">
                {sample.hr ?? '—'} bpm · SpO₂{' '}
                {sample.spo2 === null ? '—' : Math.round(sample.spo2)}%
              </p>
            </>
          ) : (
            <>
              <p className="watch-vital">
                {sample.hr ?? '—'}<span className="watch-vital-unit">bpm</span>
              </p>
              <p className={`watch-band is-${sample.riskBand}`}>{BAND_COPY[sample.riskBand]}</p>
              <p className="watch-vital-small">
                SpO₂ {sample.spo2 === null ? '—' : Math.round(sample.spo2)}%
              </p>
            </>
          )}
        </div>
      </div>

      {!sample.alert && unansweredHealth ? (
        <div className="worker-actions">
          {/* A health alert has no ack/snooze/reject state machine — the app
              calls it analytics-only, and the single action is acknowledging
              the advice. So there is one button, and it says what it means. */}
          <button className="btn btn-primary" onClick={acknowledgeHealth} disabled={busy}>
            Got it — I’m resting
          </button>
        </div>
      ) : sample.alert ? (
        <div className="worker-actions">
          <button
            className="btn btn-primary"
            onClick={() => respond('ack')}
            disabled={busy || !phone}
          >
            Acknowledge
          </button>
          <button className="btn" onClick={() => respond('snooze')} disabled={busy || !phone}>
            Snooze 5 min
          </button>
        </div>
      ) : (
        <div className="worker-vitals">
          <label className="field">
            <span className="field-label">
              Heart rate <span className="field-value">{hr} bpm</span>
            </span>
            <input
              className="field-range"
              type="range"
              min={50}
              max={190}
              value={hr}
              onChange={(e) => {
                setHr(Number(e.target.value));
                setSent(false);
              }}
            />
          </label>
          <label className="field">
            <span className="field-label">
              SpO₂ <span className="field-value">{spo2}%</span>
            </span>
            <input
              className="field-range"
              type="range"
              min={85}
              max={100}
              value={spo2}
              onChange={(e) => {
                setSpo2(Number(e.target.value));
                setSent(false);
              }}
            />
          </label>
          <button className="btn btn-primary" onClick={sendVitals} disabled={!buffer}>
            {sent ? 'Sent — engine is deciding' : 'Send to the watch'}
          </button>

          {/* What the engine did with it. Shown under the dials rather than on
              the watch face, because a health alert is not a thing the worker
              acknowledges — it goes to the dashboard, not to their wrist. */}
          {sample.health && (
            <p className={`worker-raised is-${sample.health.band}`}>
              <strong>{sample.health.band === 'danger' ? 'Danger' : 'Caution'} raised.</strong>{' '}
              {sample.health.reason}
            </p>
          )}
          <p className="worker-note">
            Rewrites the last twenty minutes, then leaves it to the app’s own
            risk engine.
          </p>
        </div>
      )}

      {/*
        Offboarding. Last in the panel and behind a confirm, because it ends
        this worker's access at every surface at once — their token, their
        login, their refresh and the socket they are holding — and mid-demo is
        exactly when a misplaced click happens. Their history is untouched:
        the server sets a status rather than deleting the row, so the alerts
        they already answered still say so.
      */}
      {onOffboard && (
        <div className="worker-offboard">
          {offboarded ? (
            <p className="worker-note">
              Offboarded. {offboarded.sockets === 0
                ? 'No socket was open.'
                : `${offboarded.sockets} socket${offboarded.sockets === 1 ? '' : 's'} closed.`}{' '}
              History intact.
            </p>
          ) : confirmOffboard ? (
            <>
              <p className="worker-note">
                Ends their access everywhere at once. Their history stays.
              </p>
              <div className="worker-actions">
                <button className="btn" onClick={() => setConfirmOffboard(false)} disabled={busy}>
                  Keep them
                </button>
                <button className="btn btn-danger" onClick={offboard} disabled={busy}>
                  {busy ? 'Removing…' : 'Offboard'}
                </button>
              </div>
            </>
          ) : (
            <button className="btn" onClick={() => setConfirmOffboard(true)}>
              Offboard this worker
            </button>
          )}
        </div>
      )}

      {error && <p className="dialog-error" role="alert">{error}</p>}
      {!phone && (
        <p className="worker-note">
          Preview — no account, so nothing posts. The dials still drive the
          risk engine.
        </p>
      )}
    </section>
  );
}
