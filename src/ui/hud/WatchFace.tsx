import { useState } from 'react';
import type { Modality } from '@/api/types';
import { SNOOZE_OPTS, snoozeLabel, DEFAULT_SNOOZE_MINS } from '@/ui/hud/snoozeOptions';

/**
 * The alert as it renders on the watch, and nothing else.
 *
 * Pulled out of the close-up so the *screen* is one thing with one definition.
 * It is mounted inside the 3D scene now — on the actual watch on the actual
 * worker's wrist — and the thing that makes that worth doing is that it is not
 * a picture of the app's surface but the surface itself: the same markup, the
 * same copy, the same three actions, and buttons that post real responses.
 *
 * Lifted from `Thalamus/src/app/alert.tsx` and `theme/tokens.ts`. The one
 * honest difference is the typeface — the app bundles Space Grotesk and IBM
 * Plex Mono, this simulator ships no webfonts, and naming a face we do not
 * load would make the design intentional in a stylesheet and arbitrary on
 * screen. Weights, sizes, colours and rhythm match.
 */

/** Straight from the app: what the eyebrow says at each severity. */
const EYEBROW: Record<string, string> = {
  low: 'GROUP ALERT · LOW',
  medium: 'GROUP ALERT · MEDIUM',
  high: 'GROUP ALERT · HIGH',
  critical: 'FULL-SCREEN INTENT · CRITICAL',
};

const HEADING: Record<string, string> = {
  low: 'Operational event',
  medium: 'Operational event',
  high: 'Urgent event',
  critical: 'Critical event',
};

/**
 * The two things a watch can be showing.
 *
 * A group alert is an event somebody else raised, with a response deadline and
 * three answers. A health alert is this worker's own body, raised by the risk
 * engine on their own phone, and the app deliberately gives it no
 * ack/snooze/reject state machine — it is analytics-only, and the single
 * action is acknowledging the advice. Rendering both through one component
 * would mean inventing controls the handset does not have.
 */
export type WatchAlert =
  | {
      kind: 'group';
      message: string;
      assetLabel: string | null;
      severity: string;
      modality: Modality;
      distanceM: number | null;
      /** the worker's floor when their phone decided — not their floor now */
      workerFloor: string | null;
      eventFloor: string | null;
    }
  | {
      kind: 'health';
      band: 'caution' | 'danger';
      title: string;
      reason: string;
      /** what the delivery plan turned on, for the "delivered to wrist" line */
      vibrate: boolean;
      hr: number | null;
      spo2: number | null;
    };

export type WatchFaceProps = {
  alert: WatchAlert;
  busy: boolean;
  onAcknowledge(): void;
  onSnooze(minutes: number): void;
  onReject(): void;
  /** leaves the close-up; rendered as the red × in the corner of the screen */
  onClose(): void;
};

export function WatchFace({
  alert,
  busy,
  onAcknowledge,
  onSnooze,
  onReject,
  onClose,
}: WatchFaceProps) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [snoozeMins, setSnoozeMins] = useState(DEFAULT_SNOOZE_MINS);

  /*
    The health surface, which the handset draws from `health-alert.tsx`.

    Deliberately one button. The app calls a personal health alert
    analytics-only and gives it no ack/snooze/reject machine — the worker is
    being told to stop, not asked to dispatch. Offering Snooze here would be
    inventing a control the product does not have, on the screen whose whole
    claim is that it is the product's screen.
  */
  if (alert.kind === 'health') {
    return (
      <div className={`face face-health is-${alert.band}`}>
        <button className="face-exit" onClick={onClose} aria-label="Back to the site">
          ×
        </button>

        <p className="face-eyebrow">
          {alert.band === 'danger'
            ? 'FULL-SCREEN INTENT · PERSONAL · DANGER'
            : 'PERSONAL · CAUTION'}
        </p>

        <div className="face-pulse" aria-hidden="true">
          <span className="face-pulse-ring" />
          <span className="face-pulse-core face-pulse-heart">♥</span>
        </div>

        <p className="face-heading">{alert.title}</p>
        <p className="face-message">{alert.reason}</p>

        <p className="face-vitals">
          {alert.hr ?? '—'} bpm · SpO₂ {alert.spo2 === null ? '—' : Math.round(alert.spo2)}%
        </p>

        <p className="face-delivered">
          Delivered to wrist{alert.vibrate ? ' · vibrating' : ''}
        </p>

        <div className="face-actions">
          <button className="face-btn face-btn-ack" onClick={onAcknowledge} disabled={busy}>
            {busy ? 'Sending…' : 'Got it — I’m resting'}
          </button>
        </div>
      </div>
    );
  }

  const severity = alert.severity in EYEBROW ? alert.severity : 'high';

  if (snoozeOpen) {
    return (
      <div className="sheet">
        <p className="sheet-title">Snooze for</p>
        <ul className="sheet-list">
          {SNOOZE_OPTS.map((option) => (
            <li key={option.m}>
              <button
                className={`sheet-option${option.m === snoozeMins ? ' is-on' : ''}`}
                onClick={() => setSnoozeMins(option.m)}
                aria-pressed={option.m === snoozeMins}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
        <div className="sheet-actions">
          <button
            className="face-btn face-btn-ghost"
            onClick={() => setSnoozeOpen(false)}
            disabled={busy}
          >
            Back
          </button>
          <button
            className="face-btn face-btn-snooze"
            onClick={() => {
              setSnoozeOpen(false);
              onSnooze(snoozeMins);
            }}
            disabled={busy}
          >
            Snooze {snoozeLabel(snoozeMins)}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="face">
      {/*
        The way out, on the screen itself.

        Not a chrome button somewhere off the watch: the close-up fills the
        frame, so the only obvious place to look for "take me back" is the
        thing being looked at. Red because leaving is the one action here that
        is not a response — an operator must never reach for it meaning ack.
      */}
      <button className="face-exit" onClick={onClose} aria-label="Back to the site">
        ×
      </button>

      <p className="face-eyebrow">{EYEBROW[severity]}</p>

      <div className="face-pulse" aria-hidden="true">
        <span className="face-pulse-ring" />
        <span className="face-pulse-core">!</span>
      </div>

      <p className="face-heading">{HEADING[severity]}</p>

      <p className="face-message">
        {alert.message}
        {alert.assetLabel && <span className="face-asset"> — {alert.assetLabel}</span>}
      </p>

      <p className="face-delivered">
        Delivered to wrist{alert.modality.haptic ? ' · vibrating' : ''}
      </p>

      <div className="face-actions">
        <button className="face-btn face-btn-ack" onClick={onAcknowledge} disabled={busy}>
          {busy ? 'Sending…' : 'Acknowledge'}
        </button>
        <div className="face-btn-row">
          <button
            className="face-btn face-btn-ghost"
            onClick={() => setSnoozeOpen(true)}
            disabled={busy}
          >
            Snooze
          </button>
          <button className="face-btn face-btn-ghost" onClick={onReject} disabled={busy}>
            Can&apos;t act
          </button>
        </div>
      </div>
    </div>
  );
}
