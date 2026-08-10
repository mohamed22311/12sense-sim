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
import { FACTORY } from '@/sites/factory';
import { CONSTRUCTION } from '@/sites/construction';
import { useBuildingStore } from '@/state/buildingStore';
import type { SiteDef } from '@/sites/types';
import {
  newSessionSlug,
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
        active = await provisionCompany(newSessionSlug(), site.label);
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
      onReady({ session: active, workers: allWorkers });
      setPhase('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase((p) => nextPhaseAfterFailure(p));
    }
  }, [session, workers, workerCount, onReady, site]);

  const busy = phase !== 'idle' && phase !== 'ready' && error === null;
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

        <button className="setup-start" disabled={busy} onClick={() => void run()}>
          {error ? 'Retry' : busy ? 'Working…' : 'Start demo'}
        </button>

        {/*
          Said before the click, not after. Start creates a company and one
          account per worker on a shared production server, and nothing here
          can delete them — a person deserves to know that before pressing it,
          not to discover it from a changelog.
        */}
        <p className="setup-consequence">
          Creates one company and {workerCount} worker
          {workerCount === 1 ? '' : 's'} on the live server, for the{' '}
          {site.label.toLowerCase()}.
        </p>

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
