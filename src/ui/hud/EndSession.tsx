import { useState } from 'react';
import {
  DemoTenantNotPurgeableError,
  purgeCompany,
  type PurgeCounts,
} from '@/net/provisioning';

/**
 * Ending a demo, and leaving nothing behind.
 *
 * A session writes a real tenant to a shared server: a company, sixty
 * accounts, and every event, response and health alert they generated. Run the
 * demo twice without clearing that and the second run's analytics are the
 * first run's too — which is the one way this simulator can actively mislead
 * someone.
 *
 * `POST /companies/me/purge` is scoped entirely by the admin's own token: no
 * company id travels in the path or the body, and the server refuses anything
 * not created with `is_demo: true`. That is what makes a destructive endpoint
 * safe to expose in a demo tool at all, and it is why this component must
 * never grow a company parameter.
 *
 * It confirms first. Not because the server is at risk — it isn't — but
 * because the operator's own session is, and mid-demo is exactly when a
 * misplaced click happens.
 */

export type EndSessionProps = {
  adminToken: string;
  companyName: string;
  /**
   * The company's enrolment code.
   *
   * Surfaced because it is the only way to put a *real* handset into this demo
   * cleanly. Logging a phone into one of the simulated worker accounts leaves
   * two clients on one identity — the virtual phone and the real one both hold
   * sockets, both report context, and the response row for that worker records
   * whichever posted first. Joining with this code creates a worker the
   * simulator does not drive, so the phone is the only client for it.
   */
  joinCode: string;
  /** called once the tenant is empty, to return to the setup screen */
  onFinished(): void;
};

export function EndSession({ adminToken, companyName, joinCode, onFinished }: EndSessionProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counts, setCounts] = useState<PurgeCounts | null>(null);

  const purge = async () => {
    setBusy(true);
    setError(null);
    try {
      setCounts(await purgeCompany(adminToken));
    } catch (e) {
      setError(
        e instanceof DemoTenantNotPurgeableError
          ? e.message
          : e instanceof Error
            ? e.message
            : String(e),
      );
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  if (counts) {
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    return (
      <section className="hud-card">
        <h2 className="hud-card-title">Session ended</h2>
        <p className="hud-card-note">
          {total} rows removed from {companyName}. Nothing from this run will
          appear in the next one.
        </p>
        <ul className="purge-counts">
          {Object.entries(counts)
            .filter(([, n]) => n > 0)
            .map(([table, n]) => (
              <li key={table}>
                <span>{table.replace(/_/g, ' ')}</span>
                <span className="purge-count">{n}</span>
              </li>
            ))}
        </ul>
        <button className="btn btn-primary" onClick={onFinished}>
          Start a new session
        </button>
      </section>
    );
  }

  return (
    <section className="hud-card">
      <h2 className="hud-card-title">Session</h2>
      <p className="hud-card-note">Join code, for a real phone</p>
      <p className="hud-joincode">{joinCode}</p>

      {confirming ? (
        <>
          <p className="hud-card-note">
            This deletes {companyName} and everything it recorded — the sixty
            accounts, every alert, every response. It cannot be undone, and it
            is the right thing to do before demonstrating to someone else.
          </p>
          {error && <p className="dialog-error" role="alert">{error}</p>}
          <div className="worker-actions">
            <button className="btn" onClick={() => setConfirming(false)} disabled={busy}>
              Keep it
            </button>
            <button className="btn btn-danger" onClick={purge} disabled={busy}>
              {busy ? 'Clearing…' : 'Clear everything'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="hud-card-note">{companyName}</p>
          <button className="btn" onClick={() => setConfirming(true)}>
            End and clear the data
          </button>
        </>
      )}
    </section>
  );
}
