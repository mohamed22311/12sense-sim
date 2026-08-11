import { useEffect, useRef } from 'react';
import { useBuildingStore } from '@/state/buildingStore';
import { formatLatLon } from '@/lib/geo';

/**
 * Putting a real handset into the running demo.
 *
 * This was the most-asked question about the simulator and the one the UI
 * answered worst: everything needed was present — a join code on one card, an
 * anchor on another, a radius inside a dialog — and nothing said they were
 * three parts of one job, or which of them was currently wrong.
 *
 * So it is a checklist that reads live state rather than a page of
 * instructions. Each step says what it needs, what it currently is, and can
 * fix itself where fixing is a single decision. A step that is already
 * satisfied says so and gets out of the way.
 *
 * The thing worth understanding, and the reason the copy leads with it:
 * **delivery is not a location problem.** The server broadcasts every event to
 * every phone in the company, so an enrolled handset receives the alert
 * whatever its coordinates — the app posts `received` before it even asks for
 * a GPS fix. Location only decides whether that phone *alarms*. Operators
 * consistently expect the opposite, and then read a silent phone as a broken
 * socket rather than a working gate.
 */

/**
 * The radius below which a real handset is being judged on GPS error rather
 * than on where it is standing.
 *
 * Phone GPS is 5–10 m out in the open and considerably worse under a roof. The
 * simulated fleet has exact positions and 12 m separates a floor nicely; a real
 * phone inside a 12 m circle can measure itself outside it while standing
 * still.
 */
export const PHONE_SAFE_RADIUS_M = 30;

export type RealPhoneDialogProps = {
  joinCode: string | null;
  onOpenMap(): void;
  onClose(): void;
};

export function RealPhoneDialog({ joinCode, onOpenMap, onClose }: RealPhoneDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const anchorLatLon = useBuildingStore((s) => s.anchorLatLon);
  const anchorSource = useBuildingStore((s) => s.anchorSource);
  const radiusM = useBuildingStore((s) => s.alertRadiusM);
  const setRadiusM = useBuildingStore((s) => s.setAlertRadiusM);
  const activeFloorId = useBuildingStore((s) => s.activeFloorId);
  const site = useBuildingStore((s) => s.site);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const activeFloor = site.floors.find((f) => f.id === activeFloorId) ?? site.floors[0];
  /*
    The app offers B1 / Ground / 1 / 2 / 3 as one-tap chips and a free-text box
    for anything else. Worth saying which of the two this floor needs, because
    a worker hunting for "4" among five chips concludes the feature is broken.
  */
  const isPresetFloor = ['b1', 'ground', '1', '2', '3'].includes(
    activeFloor.id.trim().toLowerCase(),
  );

  const anchorPlaced = anchorSource !== 'default';
  const radiusOk = radiusM >= PHONE_SAFE_RADIUS_M;

  return (
    <div className="dialog-scrim" onClick={onClose}>
      <div
        ref={dialogRef}
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="real-phone-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dialog-head">
          <div>
            <p className="dialog-eyebrow">Real phone</p>
            <h2 className="dialog-title" id="real-phone-title">
              Put a handset in this demo
            </h2>
          </div>
          <button className="dialog-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="dialog-body">
          <p className="dialog-note">
            The server broadcasts every alert to <strong>every phone in the company</strong>,
            so an enrolled handset receives it wherever it is — the app records the
            delivery before it even asks for a location. Position and floor only decide
            whether it <strong>alarms</strong>. These four steps are what make that
            decision come out the way you intend.
          </p>

          <ol className="steps">
            <li className={`step${joinCode ? ' is-done' : ' is-blocked'}`}>
              <h3 className="step-title">1 · Enrol with the join code</h3>
              {joinCode ? (
                <>
                  <p className="step-value mono">{joinCode}</p>
                  <p className="step-note">
                    In the app: <strong>Register → I have a join code</strong>. Do{' '}
                    <strong>not</strong> sign in as one of the <code>w01</code>–
                    <code>w60</code> accounts — the simulator is already running a
                    phone for each of those, and two clients on one identity makes
                    every result ambiguous. The code creates a worker nothing else
                    is driving.
                  </p>
                </>
              ) : (
                <p className="step-note">
                  This session has no join code, so a handset cannot pair with it.
                  Start a new company, or log in again — logging in recovers the
                  company&rsquo;s existing code.
                </p>
              )}
            </li>

            <li className={`step${anchorPlaced ? ' is-done' : ' is-todo'}`}>
              <h3 className="step-title">2 · Put the site where the phone is</h3>
              <p className="step-value">
                {formatLatLon(anchorLatLon.latitude, anchorLatLon.longitude)}{' '}
                <span className="step-source">
                  {anchorSource === 'default' ? 'still the built-in default' : anchorSource === 'device' ? 'from this device' : 'set by hand'}
                </span>
              </p>
              <p className="step-note">
                Every machine&rsquo;s coordinate is derived from this one. Until it
                sits where the handset actually is, the phone will measure itself
                hundreds of kilometres away and stay silent — correctly.
              </p>
              <button className="btn" onClick={onOpenMap}>
                Set it on a map
              </button>
            </li>

            <li className={`step${radiusOk ? ' is-done' : ' is-todo'}`}>
              <h3 className="step-title">3 · Widen the alert radius</h3>
              <p className="step-value">
                {radiusM} m{' '}
                <span className="step-source">
                  {radiusOk ? 'roomy enough for GPS error' : `tight for a real handset`}
                </span>
              </p>
              <p className="step-note">
                Phone GPS is 5–10 m out in the open and worse under a roof. 12 m is
                right for the simulated fleet, which knows exactly where it is; a
                real phone inside a 12 m circle can measure itself outside it
                without moving.
              </p>
              {!radiusOk && (
                <button className="btn" onClick={() => setRadiusM(PHONE_SAFE_RADIUS_M)}>
                  Use {PHONE_SAFE_RADIUS_M} m
                </button>
              )}
            </li>

            <li className="step is-todo">
              <h3 className="step-title">4 · Tell the phone its floor</h3>
              <p className="step-value">
                {activeFloor.label} <span className="step-source">floor “{activeFloor.id}”</span>
              </p>
              <p className="step-note">
                In the app: <strong>Settings → My floor</strong>
                {isPresetFloor
                  ? ' — it is one of the one-tap options.'
                  : ' — type it into the box; the chips only cover B1, Ground, 1, 2 and 3.'}{' '}
                Then raise an alert from a machine on this floor. The floor gate is
                the half of this that works reliably indoors, because it is a value
                the worker sets rather than a measurement.
              </p>
            </li>
          </ol>

          {/*
            Stated plainly, because the first surprise anyone has is a phone
            that alarms when they expected silence, and the second is a locked
            phone that stays dark.
          */}
          <h3 className="step-title">What will surprise you</h3>
          <p className="dialog-note">
            A phone that <em>cannot</em> prove it is outside the circle alarms anyway
            — no location permission, no fix, or a fix older than two minutes. Indoors
            that is the common case, so a tight circle is never a guarantee of silence.
            And push to a <strong>locked</strong> phone is unverified on this
            deployment: keep the app in the foreground, or test that case yourself
            before promising it.
          </p>

          <div className="dialog-actions">
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
