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
          appear in the next one. The company and this admin login are still
          there — resume with them to seed a fresh set of workers.
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
      {joinCode ? (
        <>
          <p className="hud-card-note">Join code, for a real phone</p>
          <p className="hud-joincode">{joinCode}</p>
        </>
      ) : (
        <p className="hud-card-note">
          No join code on this session. A real handset cannot pair until one is
          created.
        </p>
      )}

      {confirming ? (
        <>
          {/*
            Says what the server actually does. `POST /companies/me/purge`
            deletes the workers, their devices and every operational row, but
            keeps the company and its admins on purpose — so the next demo
            signs in with the same credentials and seeds workers back in. An
            operator who thinks this destroys their login will never press it.
          */}
          <p className="hud-card-note">
            This deletes every worker in {companyName} and everything they
            recorded — each alert, each response. It cannot be undone. The
            company and this admin login survive, so you can sign back in and
            seed a fresh set of workers into it.
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
