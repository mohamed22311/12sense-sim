/**
 * The gate in front of the scene.
 *
 * Provisioning writes accounts to a shared production server that has no
 * delete endpoints, so it never happens on page load — only when someone
 * presses Start. A stray refresh costing another dead company is exactly the
 * failure this screen prevents.
 *
 * `provisionWorkers` never rejects on an individual registration failure; it
 * returns the workers that landed alongside the indices that didn't. This
 * screen accumulates the successful ones across attempts (`workers` state
 * below) so pressing Retry passes them back in as `alreadyProvisioned` and
 * only the still-missing indices are registered again — never re-registering
 * one that already succeeded, and never losing one that did.
 *
 * The screen states what it is about to do before doing it. Not politeness:
 * the action is irreversible on someone else's server, and a control that
 * spends real, undeletable resources should say so above the button, not in a
 * comment nobody reads.
 */
import { useCallback, useState } from 'react';
import {
  DEMO_PASSWORD,
  adminUsername as adminNameFor,
  companyNameFor,
  passwordProblem,
  resumeSession,
  slugProblem,
  workerIdentity,
} from '@/net/provisioning';
import {
  forgetSession,
  recentSessions,
  rememberSession,
  type RecentSession,
} from '@/ui/recentSessions';
import { FACTORY } from '@/sites/factory';
import { CONSTRUCTION } from '@/sites/construction';
import { useBuildingStore } from '@/state/buildingStore';
import type { SiteDef } from '@/sites/types';
import {
  provisionCompany,
  provisionWorkers,
  type ProvisionedSession,
  type ProvisionedWorker,
} from '@/net/provisioning';
import {
  MAX_WORKER_COUNT,
  MIN_WORKER_COUNT,
  clampWorkerCount,
  missingWorkerIndices,
  nextPhaseAfterFailure,
  progressLabel,
  type SetupPhase,
  type SetupProgress,
} from '@/ui/setupState';

export type SetupResult = { session: ProvisionedSession; workers: ProvisionedWorker[] };

/** Rough provisioning throughput, measured on the deployed server: ~2.8 workers/s. */
const WORKERS_PER_SECOND = 2.8;

function estimatedSeconds(count: number): number {
  return Math.max(5, Math.round(count / WORKERS_PER_SECOND));
}

/** The sites a session can be run on, in the order they are offered. */
const SITES: SiteDef[] = [FACTORY, CONSTRUCTION];

export function SetupScreen({ onReady }: { onReady: (result: SetupResult) => void }) {
  const site = useBuildingStore((s) => s.site);
  const setSite = useBuildingStore((s) => s.setSite);
  /*
    Two ways in, and resuming is the default.

    Every run used to mint a fresh tenant: sixty more undeletable accounts, and
    a fresh set of analytics that threw away everything the last demo had built
    up. Signing back in to a company that already exists is the normal case, so
    it is the tab that opens.
  */
  const [recent, setRecent] = useState<RecentSession[]>(() => recentSessions());
  // Resume is the right default only when there is something to resume. On a
  // browser that has never run the simulator, opening on an empty form asking
  // for a username the operator does not have yet is a dead end.
  const [mode, setMode] = useState<'resume' | 'new'>(() =>
    recentSessions().length > 0 ? 'resume' : 'new',
  );
  const [adminUsername, setAdminUsername] = useState('');
  /*
    The company id, typed rather than generated.

    It was `newSessionSlug()` — six random characters — which made every run a
    company nobody could name, find on the dispatcher, or write in a runbook.
    It is still the derivation key for all sixty-one accounts, so it is
    validated hard and shown resolved: an operator picking "acme" should see
    `sim-acme-admin` and `sim-acme-w01` before they create anything.
  */
  const [slug, setSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [resuming, setResuming] = useState(false);
  const [phase, setPhase] = useState<SetupPhase>('idle');
  const [progress, setProgress] = useState<SetupProgress>({ done: 0, total: 60 });
  const [workerCount, setWorkerCount] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<ProvisionedSession | null>(null);
  // Workers that have actually landed, across every attempt. Never cleared
  // on a workers/connecting failure — that would throw away accounts the
  // server can't delete anyway.
  const [workers, setWorkers] = useState<ProvisionedWorker[]>([]);

  const run = useCallback(async () => {
    setError(null);
    try {
      let active = session;
      if (!active) {
        setPhase('company');
        setProgress({ done: 0, total: workerCount });
        // The company is named after the site, so the tenant on the server
        // says which demo it came from rather than always saying "Factory".
        active = await provisionCompany(
          slug.trim(),
          site.label,
          undefined,
          password,
          displayName,
        );
        setSession(active);
      }

      setPhase('workers');
      const alreadyDone = workerCount - missingWorkerIndices(workerCount, workers).length;
      setProgress({ done: alreadyDone, total: workerCount });

      const result = await provisionWorkers(
        active,
        workerCount,
        (done, total) => setProgress({ done, total }),
        undefined,
        workers,
        undefined,
        password,
      );
      const allWorkers = [...workers, ...result.workers];
      setWorkers(allWorkers);

      if (result.failures.length > 0) {
        setError(
          `${result.failures.length} of ${workerCount} workers failed to register. ` +
            'Retry registers only the ones still missing.',
        );
        setPhase(nextPhaseAfterFailure('workers'));
        return;
      }

      setPhase('connecting');
      // Remembered at creation, not only at resume: a company you can no longer
      // find the admin name for is a company you will re-create, which is the
      // exact waste the resume tab exists to stop.
      rememberSession({
        slug: active.slug,
        adminUsername: adminNameFor(active.slug),
        companyName: active.companyName,
        siteId: site.id,
        workerCount: allWorkers.length,
      });
      onReady({ session: active, workers: allWorkers });
      setPhase('ready');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // The one registration failure with an obvious next step. Usernames are
      // unique platform-wide, so a taken id means someone already made this
      // company — very possibly you, last week.
      setError(
        /409|exists|taken|duplicate|already/i.test(message)
          ? `Company id "${slug.trim()}" is already taken. Pick another, or log in to it on the Log in tab.`
          : message,
      );
      setPhase((p) => nextPhaseAfterFailure(p));
    }
  }, [session, workers, workerCount, onReady, site, slug, displayName, password]);

  /**
   * Sign back in to an existing company, workers and all.
   *
   * The site comes back off the company's own name, so resuming lands on the
   * building the accounts were made for rather than whichever tab happened to
   * be selected.
   */
  const resume = useCallback(
    async (username: string) => {
      setResuming(true);
      setError(null);
      try {
        setPhase('signing-in');
        setProgress({ done: 0, total: 0 });
        const result = await resumeSession(
          username.trim(),
          password,
          undefined,
          undefined,
          (done, total) => setProgress({ done, total }),
        );
        setSite(result.siteId === 'construction' ? CONSTRUCTION : FACTORY);
        rememberSession({
          slug: result.session.slug,
          adminUsername: username.trim(),
          companyName: result.session.companyName,
          siteId: result.siteId,
          workerCount: result.workers.length,
        });
        if (result.workers.length === 0) {
          /*
            An empty roster is the *purged* tenant, not a broken one. The purge
            endpoint deletes workers but deliberately keeps the company row and
            its admins, "so the next run re-seeds into the same tenant with the
            same credentials" — so the right answer is to offer that re-seed,
            not to send the operator off to mint yet another company.

            Handing the session to the create tab is all it takes: `run()`
            already skips company creation when a session exists, so Start
            registers workers straight into this one.
          */
          setSession(result.session);
          setWorkers([]);
          setMode('new');
          setResuming(false);
          setPhase('idle');
          setError(
            `${result.session.companyName} is empty — it was cleared at the end of ` +
              'a previous demo. Choose how many workers to seed back into it.',
          );
          return;
        }
        onReady({ session: result.session, workers: result.workers });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setResuming(false);
        setPhase('idle');
      }
    },
    [password, onReady, setSite],
  );

  const busy = phase !== 'idle' && phase !== 'ready' && error === null;
  // Only complained about once there is something to complain about — an empty
  // field on first paint is not yet a mistake.
  const slugFault = slug.length === 0 ? null : slugProblem(slug);
  const passwordFault = passwordProblem(password);
  // The button asks the real question. `slugFault` is for *display* and stays
  // quiet on an empty field; an empty field still cannot create a company.
  const canRegister = slugProblem(slug) === null && passwordProblem(password) === null;
  const started = session !== null;
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <main className="setup">
      <div className="setup-card">
        <h1 className="setup-title">Twelve Senses Demo Simulator</h1>
        <p className="setup-lede">
          Every simulated worker gets a real account, a real WebSocket, and the
          mobile app&rsquo;s own decision logic. Alerts you raise here are raised
          on the live server.
        </p>

        <div className="setup-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={mode === 'resume'}
            className={`setup-tab${mode === 'resume' ? ' is-on' : ''}`}
            onClick={() => { setMode('resume'); setError(null); }}
            disabled={busy || resuming || started}
          >
            Log in
          </button>
          <button
            role="tab"
            aria-selected={mode === 'new'}
            className={`setup-tab${mode === 'new' ? ' is-on' : ''}`}
            onClick={() => { setMode('new'); setError(null); }}
            disabled={busy || resuming || started}
          >
            Register
          </button>
        </div>

        {mode === 'resume' ? (
          <>
            {recent.length > 0 && (
              <div className="setup-field">
                <span className="setup-label">Recent</span>
                <ul className="setup-recents">
                  {recent.map((entry) => (
                    <li key={entry.slug}>
                      <button
                        className="setup-recent"
                        onClick={() => { setAdminUsername(entry.adminUsername); void resume(entry.adminUsername); }}
                        disabled={resuming}
                      >
                        <span className="setup-recent-name">{entry.companyName}</span>
                        <span className="setup-recent-meta">
                          {entry.siteId === 'construction' ? 'Construction site' : 'Factory'} ·{' '}
                          {entry.workerCount} workers
                        </span>
                      </button>
                      <button
                        className="setup-recent-forget"
                        onClick={() => { forgetSession(entry.slug); setRecent(recentSessions()); }}
                        aria-label={`Forget ${entry.companyName}`}
                        disabled={resuming}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="setup-field">
              <label className="setup-label" htmlFor="admin-username">
                Company admin
              </label>
              <input
                id="admin-username"
                className="setup-input setup-input-wide"
                placeholder="sim-abc123-admin"
                autoComplete="username"
                value={adminUsername}
                disabled={resuming}
                onChange={(e) => setAdminUsername(e.target.value)}
              />
              <span className="setup-hint">
                The company you registered earlier. Every worker signs back in
                from this one name — their history is on the server and stays
                there.
              </span>
            </div>

            <div className="setup-field">
              <label className="setup-label" htmlFor="admin-password">
                Password
              </label>
              <input
                id="admin-password"
                className="setup-input setup-input-wide"
                type="password"
                autoComplete="current-password"
                value={password}
                disabled={resuming}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button
              className="setup-start"
              disabled={resuming || adminUsername.trim().length === 0}
              onClick={() => void resume(adminUsername)}
            >
              {resuming ? 'Signing everyone in…' : 'Log in'}
            </button>

            <p className="setup-consequence">
              Creates nothing. Signs the company&rsquo;s existing accounts back
              in — the same workers, carrying everything they recorded before.
            </p>
          </>
        ) : (
        <>
        <div className="setup-field">
          <label className="setup-label" htmlFor="company-id">
            Company id
          </label>
          <input
            id="company-id"
            className="setup-input setup-input-wide"
            placeholder="acme"
            autoComplete="off"
            spellCheck={false}
            value={slug}
            disabled={busy || started}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
          />
          {/*
            Shown resolved, before anything is created. This one string becomes
            sixty-one usernames and is the only thing needed to log the company
            back in later, so an operator should read it here rather than
            discover it on a dispatcher afterwards.
          */}
          <span className="setup-hint">
            {slugFault ? (
              <span className="setup-fault">{slugFault}</span>
            ) : (
              <>
                Admin <code>{adminNameFor(slug)}</code>, workers{' '}
                <code>{workerIdentity(slug, 1).username}</code> …{' '}
                <code>{workerIdentity(slug, workerCount).username}</code>
              </>
            )}
          </span>
        </div>

        <div className="setup-field">
          <label className="setup-label" htmlFor="company-name">
            Company name
          </label>
          <input
            id="company-name"
            className="setup-input setup-input-wide"
            placeholder="Acme Manufacturing"
            value={displayName}
            disabled={busy || started}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <span className="setup-hint">
            Shown on the dispatcher as{' '}
            <strong>{companyNameFor(displayName || `Demo ${slug || '…'}`, site.label)}</strong>.
            The site is kept in the name because logging back in reads it from
            there.
          </span>
        </div>

        <div className="setup-field">
          <label className="setup-label" htmlFor="new-password">
            Password
          </label>
          <input
            id="new-password"
            className="setup-input setup-input-wide"
            type="text"
            autoComplete="off"
            value={password}
            disabled={busy || started}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="setup-hint">
            {passwordFault ? (
              <span className="setup-fault">{passwordFault}</span>
            ) : (
              'Shared by the admin and every worker. Shown, not hidden — this is a demo tenant you will purge.'
            )}
          </span>
        </div>

        {/*
          The site is chosen before anything is created, and locked once it is:
          the workers, the navmesh and the machines all belong to one site, and
          switching underneath a running session would leave sixty people
          walking a floor plan that no longer exists.
        */}
        <div className="setup-field">
          <span className="setup-label">Site</span>
          <div className="setup-sites">
            {SITES.map((option) => (
              <button
                key={option.id}
                className={`setup-site${option.id === site.id ? ' is-on' : ''}`}
                disabled={busy || started}
                aria-pressed={option.id === site.id}
                onClick={() => setSite(option)}
              >
                <span className="setup-site-name">{option.label}</span>
                <span className="setup-site-meta">
                  {option.floors.length} levels ·{' '}
                  {option.floors.reduce((n, f) => n + f.machines.length, 0)} assets
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="setup-field">
          <label className="setup-label" htmlFor="worker-count">
            Workers on site
          </label>
          <div className="setup-input-row">
            <input
              id="worker-count"
              className="setup-input"
              type="number"
              inputMode="numeric"
              min={MIN_WORKER_COUNT}
              max={MAX_WORKER_COUNT}
              value={workerCount}
              disabled={busy || started}
              onChange={(e) => setWorkerCount(clampWorkerCount(Number(e.target.value)))}
            />
            <span className="setup-hint">
              {MIN_WORKER_COUNT}&ndash;{MAX_WORKER_COUNT} &middot; about{' '}
              {estimatedSeconds(workerCount)}s to register
            </span>
          </div>
        </div>

        <button
          className="setup-start"
          disabled={busy || (!started && !canRegister)}
          onClick={() => void run()}
        >
          {error ? 'Retry' : busy ? 'Working…' : 'Start demo'}
        </button>

        {/*
          Said before the click, not after. Start creates a company and one
          account per worker on a shared production server, and nothing here
          can delete them — a person deserves to know that before pressing it,
          not to discover it from a changelog.
        */}
        <p className="setup-consequence">
          {started ? (
            <>
              Adds {workerCount} worker{workerCount === 1 ? '' : 's'} to{' '}
              {session?.companyName}. No new company is created.
            </>
          ) : (
            <>
              Creates one company and {workerCount} worker
              {workerCount === 1 ? '' : 's'} on the live server, for the{' '}
              {site.label.toLowerCase()}.
            </>
          )}
        </p>
        </>
        )}

        {phase !== 'idle' && (
          <div className="setup-progress" role="status" aria-live="polite">
            <div className="setup-progress-head">
              <span>{progressLabel(phase, progress)}</span>
              {phase === 'workers' && <span className="setup-progress-pct">{pct}%</span>}
            </div>
            <div
              className="setup-progress-track"
              role="progressbar"
              aria-valuenow={progress.done}
              aria-valuemin={0}
              aria-valuemax={progress.total}
            >
              <div
                className="setup-progress-fill"
                style={{ transform: `scaleX(${pct / 100})` }}
              />
            </div>
          </div>
        )}

        {error && (
          <p className="setup-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
