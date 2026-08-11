/**
 * Stand up a demo tenant: a company, a reusable join code, and N workers.
 *
 * Everything here exists because of one server rule — `username` and `email`
 * are unique PLATFORM-WIDE, not per company (api-contract.md, POST
 * /auth/register). Every generated identity therefore carries a session slug,
 * and a demo run never collides with the one before it.
 *
 * Reset re-runs this against a fresh company rather than clearing an old one:
 * the server has no delete endpoints (design doc §3.2).
 */
import { apiRequest, ApiError } from './apiClient';

export const PROVISION_CONCURRENCY = 8;

/** Long enough to be unguessable in a demo, inside the 8-72 byte bcrypt range. */
/**
 * Exported so the resume form can prefill it.
 *
 * One literal for every demo account, ruled on deliberately: a demo where the
 * presenter has to look up sixty passwords is a demo that stalls, and the
 * tenant is purged at the end. It is prefilled rather than hidden, because the
 * operator should be able to see and change what they are signing in with.
 */
export const DEMO_PASSWORD = 'TwelveDemo2026';

/**
 * The one name you need to get a whole company back.
 *
 * The inverse of `slugFromAdminUsername`. Kept as a function rather than an
 * inlined template because resuming depends on the two agreeing exactly — a
 * drift between how the admin is *created* and how it is *parsed* would make
 * every existing company unresumable, silently.
 */
export function adminUsername(slug: string): string {
  return `sim-${slug}-admin`;
}

const FIRST_NAMES = [
  'Ahmed', 'Sarah', 'Omar', 'Fatima', 'Carlos', 'Mei', 'Youssef', 'Elena',
  'Rahul', 'Grace', 'Tomas', 'Aisha', 'Daniel', 'Nadia', 'Peter', 'Layla',
  'Hassan', 'Marta', 'Kwame', 'Ingrid',
];
const LAST_NAMES = [
  'Al-Rashidi', 'Mitchell', 'Hassan', 'Al-Zahra', 'Reyes', 'Chen', 'Farouk',
  'Petrova', 'Sharma', 'Okonkwo', 'Novak', 'Haddad', 'Fischer', 'Karim',
  'Lindqvist', 'Costa', 'Mensah', 'Dubois',
];

export type WorkerIdentity = {
  username: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
};

export type ProvisionedWorker = WorkerIdentity & {
  index: number;
  userId: string;
  accessToken: string;
  refreshToken: string;
};

export type ProvisionedSession = {
  slug: string;
  companyId: string;
  companyName: string;
  adminUserId: string;
  adminAccessToken: string;
  adminRefreshToken: string;
  joinCode: string;
};

export function newSessionSlug(): string {
  return Date.now().toString(36).slice(-6);
}

/**
 * Ages span 22-58 so `hrMaxForAge` (Tanaka: 208 − 0.7·age) differs per worker.
 * A fleet that shared one age would make the exertion rule fire at the same
 * heart rate for everyone, which is the opposite of the point.
 */
export function workerIdentity(slug: string, index: number): WorkerIdentity {
  const n = String(index).padStart(2, '0');
  const birthYear = 2004 - ((index * 7) % 37);
  return {
    username: `sim-${slug}-w${n}`,
    email: `w${n}@${slug}.sim.twelvesenses.io`,
    password: DEMO_PASSWORD,
    firstName: FIRST_NAMES[index % FIRST_NAMES.length],
    lastName: LAST_NAMES[(index * 3) % LAST_NAMES.length],
    dateOfBirth: `${birthYear}-0${(index % 9) + 1}-1${index % 9}`,
  };
}

type AuthResponse = {
  worker?: { id: string };
  user?: { id: string };
  /** Only present on `/companies/register` — echoes the `is_demo` this run sent. */
  company?: { id: string; is_demo: boolean };
  access_token: string;
  refresh_token: string;
};

/** Injected in tests; production passes the real call through. */
export type RegisterFn = (path: string, body: Record<string, unknown>) => Promise<AuthResponse>;

const realRegister: RegisterFn = (path, body) =>
  apiRequest<AuthResponse>('POST', path, { body });

export type LoginFn = (username: string, password: string) => Promise<AuthResponse>;

const realLogin: LoginFn = (username_or_email, password) =>
  apiRequest<AuthResponse>('POST', '/auth/login', {
    body: { username_or_email, password },
  });

/**
 * Statuses that mean the server made a decision about this account, so asking
 * again will get the same answer. Everything else — 5xx, a timeout, a dropped
 * connection — is a fault, and faults are worth retrying.
 */
const REFUSED = new Set([400, 401, 403, 404, 422]);

/** A username the server already knows. Not a failure here: see `seatWorker`. */
const ALREADY_EXISTS = 409;

const TRIES = 3;
const BACKOFF_MS = [350, 900];
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function statusOf(error: unknown): number | null {
  return error instanceof ApiError ? error.status : null;
}

/**
 * Runs `job` over `items` with a fixed number of workers in flight.
 *
 * Sixty logins done one after another is a minute of staring at a progress
 * bar; sixty at once is a burst the server answers with 5xx. Both are avoided
 * by keeping a small, constant number in the air.
 */
async function pooled<T, R>(
  items: readonly T[],
  job: (item: T) => Promise<R>,
  concurrency = PROVISION_CONCURRENCY,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const runner = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await job(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  return out;
}

/**
 * Gets worker `index` onto the site, whatever state the server is already in.
 *
 * Registering and signing in are the same goal — a live token for a known
 * identity — and which one is correct depends on something the client cannot
 * see: whether an earlier attempt reached the database before the connection
 * died. A registration that times out client-side very often *did* create the
 * account, and a plain retry then meets 409 forever, losing that worker for
 * the rest of the demo over a request that actually succeeded.
 *
 * So a 409 is not an error here. It is the server saying the account exists,
 * and the response to that is to sign in to it — the credentials are derived,
 * so they are the same ones that account was created with. That is also what
 * makes registering into a company that already has some workers safe.
 */
async function seatWorker(
  session: ProvisionedSession,
  index: number,
  register: RegisterFn,
  login: LoginFn,
): Promise<ProvisionedWorker> {
  const id = workerIdentity(session.slug, index);
  let last: unknown = new Error('never attempted');

  for (let attempt = 0; attempt < TRIES; attempt++) {
    try {
      const res = await register('/auth/register', {
        code: session.joinCode,
        username: id.username,
        email: id.email,
        password: id.password,
        first_name: id.firstName,
        last_name: id.lastName,
        date_of_birth: id.dateOfBirth,
      });
      return {
        ...id,
        index,
        userId: (res.worker ?? res.user)?.id ?? '',
        accessToken: res.access_token,
        refreshToken: res.refresh_token,
      };
    } catch (error) {
      last = error;
      const status = statusOf(error);

      if (status === ALREADY_EXISTS) {
        try {
          return await signIn(id, index, login);
        } catch (loginError) {
          last = loginError;
          // Existing but not ours to sign in to — a genuinely taken username.
          // Retrying registration cannot fix that, so stop.
          if (REFUSED.has(statusOf(loginError) ?? 0)) break;
        }
      } else if (status !== null && REFUSED.has(status)) {
        break;
      }

      const backoff = BACKOFF_MS[attempt];
      if (backoff !== undefined) await pause(backoff);
    }
  }

  throw last instanceof Error ? last : new Error(String(last));
}

/**
 * Signs one known identity in, retrying a fault but not a refusal.
 *
 * The distinction is the whole reason this is not a bare `login` call: with
 * sixty accounts, treating a single 503 as "this worker is gone" quietly
 * shrinks the site every time the server hiccups, and the operator has no way
 * to tell that from workers who really were offboarded.
 */
async function signIn(
  id: WorkerIdentity,
  index: number,
  login: LoginFn,
): Promise<ProvisionedWorker> {
  let last: unknown = new Error('never attempted');

  for (let attempt = 0; attempt < TRIES; attempt++) {
    try {
      const auth = await login(id.username, id.password);
      return {
        ...id,
        index,
        userId: (auth.worker ?? auth.user)?.id ?? '',
        accessToken: auth.access_token,
        refreshToken: auth.refresh_token,
      };
    } catch (error) {
      last = error;
      if (REFUSED.has(statusOf(error) ?? 0)) break;
      const backoff = BACKOFF_MS[attempt];
      if (backoff !== undefined) await pause(backoff);
    }
  }

  throw last instanceof Error ? last : new Error(String(last));
}

/**
 * Registers the company with `is_demo: true` and refuses to proceed unless
 * the server echoes that back. The echo is the only signal available at
 * registration time that the purge endpoint (`POST /companies/me/purge`)
 * will ever accept this tenant — `is_demo` can only be set here and never
 * afterwards, so an older server build that silently drops the unknown field
 * would otherwise hand back a company that looks fine today and is
 * permanently unpurgeable. Better to fail loudly here than discover it as a
 * 403 after a demo has already run.
 */
export async function provisionCompany(
  slug: string,
  siteLabel: string,
  register: RegisterFn = realRegister,
): Promise<ProvisionedSession> {
  const companyName = `Demo ${siteLabel} ${slug}`;
  const company = await register('/companies/register', {
    company_name: companyName,
    is_demo: true,
    admin: {
      username: adminUsername(slug),
      email: `admin@${slug}.sim.twelvesenses.io`,
      password: DEMO_PASSWORD,
      first_name: 'Demo',
      last_name: 'Admin',
    },
  });

  if (!company.company || company.company.is_demo !== true) {
    throw new Error(
      'Server did not confirm this company as a demo tenant: /companies/register did ' +
        'not echo is_demo: true. Refusing to continue — a company not created with ' +
        'is_demo=true can never be purged, by anyone, ever.',
    );
  }

  const adminToken = company.access_token;
  const code = await apiRequest<{ code: string }>('POST', '/enrollment-codes', {
    token: adminToken,
    body: { type: 'join', max_uses: null, expires_at: null },
  });

  const admin = company.user ?? company.worker;
  return {
    slug,
    companyId: company.company.id,
    companyName,
    adminUserId: admin?.id ?? '',
    adminAccessToken: adminToken,
    adminRefreshToken: company.refresh_token,
    joinCode: code.code,
  };
}

export type ProvisionFailure = { index: number; error: string };

export type ProvisionWorkersResult = {
  workers: ProvisionedWorker[];
  failures: ProvisionFailure[];
};

/**
 * Register workers `1..count`, at most PROVISION_CONCURRENCY in flight.
 *
 * A registration failure never cancels its in-flight peers and never
 * discards their results. Each attempt is caught individually: successes go
 * into `workers`, failures go into `failures`, and the batch always
 * resolves. This matters because the server has no delete endpoints — an
 * account that actually got created is permanent, so letting one peer's
 * failure reject the whole `Promise.all` and throw away nine already-created
 * accounts would orphan them for good.
 *
 * `alreadyProvisioned` — normally the `workers` array returned by a previous
 * partial call — is used to compute which indices are still missing:
 * `1..count` minus the indices already present. That is what makes a retry
 * correct regardless of which workers failed or in what order they
 * resolved. A plain "resume from a count" is not safe here: the count of
 * completed attempts is not the same as a contiguous prefix of *successful*
 * ones, so resuming from a count can re-register an index that already
 * succeeded — colliding with a username that's unique platform-wide — while
 * skipping the index that actually failed and was never created.
 */
export async function provisionWorkers(
  session: ProvisionedSession,
  count: number,
  onProgress?: (done: number, total: number) => void,
  register: RegisterFn = realRegister,
  alreadyProvisioned: readonly ProvisionedWorker[] = [],
  login: LoginFn = realLogin,
): Promise<ProvisionWorkersResult> {
  const doneIndices = new Set(alreadyProvisioned.map((w) => w.index));
  const indices = Array.from({ length: count }, (_, i) => i + 1).filter(
    (index) => !doneIndices.has(index),
  );

  const workers: ProvisionedWorker[] = [];
  const failures: ProvisionFailure[] = [];
  let done = alreadyProvisioned.length;

  await pooled(indices, async (index) => {
    try {
      workers.push(await seatWorker(session, index, register, login));
    } catch (err) {
      failures.push({ index, error: err instanceof Error ? err.message : String(err) });
    }
    onProgress?.(++done, count);
  });

  // Pushed from eight concurrent runners, so the array is in completion order.
  // Sorted because the fleet, the agent set and the roster are all keyed on
  // this index and should walk it in the same order every run.
  workers.sort((a, b) => a.index - b.index);
  return { workers, failures };
}

/** Per-table row counts the server reports as purged. Opaque to us — data to hand back, not to interpret. */
export type PurgeCounts = Record<string, number>;

/**
 * A 403 from `/companies/me/purge` means the tenant isn't a demo tenant (or
 * the caller isn't an admin) — the one purge failure a caller can actually
 * act on, so it gets its own type instead of surfacing as a generic ApiError.
 */
export class DemoTenantNotPurgeableError extends Error {
  constructor(
    message = 'This tenant cannot be purged: it is not a demo tenant, or the caller is not an admin.',
  ) {
    super(message);
    this.name = 'DemoTenantNotPurgeableError';
  }
}

/** Injected in tests; production passes the real call through. */
export type PurgeFn = (path: string, token: string) => Promise<PurgeCounts>;

const realPurge: PurgeFn = (path, token) => apiRequest<PurgeCounts>('POST', path, { token });

/**
 * Purges the calling admin's own demo company via `POST /companies/me/purge`.
 * Scoped entirely from the admin's JWT — there is no company id in the path
 * or body, and none should ever be added here; the server rejects anything
 * not created with `is_demo: true`, admin-only, which is exactly what makes
 * the endpoint safe against the append-only constitution for real tenants.
 */
export async function purgeCompany(
  adminAccessToken: string,
  purge: PurgeFn = realPurge,
): Promise<PurgeCounts> {
  try {
    return await purge('/companies/me/purge', adminAccessToken);
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      throw new DemoTenantNotPurgeableError();
    }
    throw err;
  }
}

/* ─── Resuming an existing session ──────────────────────────────────── */

/**
 * The pieces of a company we can recover from its name and roster alone.
 *
 * Nothing about a session is stored locally, and nothing new is asked of the
 * server. Every worker's credentials are *derived*: `workerIdentity` is a pure
 * function of the slug and the index, and the password is one owner-ruled
 * literal. So the admin username is enough to reconstruct sixty logins — which
 * is the whole reason those identities were made deterministic in the first
 * place.
 */
type EnrollmentCode = {
  code: string;
  type: string;
  max_uses: number | null;
  used_count: number;
};

export type ResumeSummary = {
  session: ProvisionedSession;
  workers: ProvisionedWorker[];
  /** which site this company was created for, read back off its name */
  siteId: 'factory' | 'construction';
  /** roster entries skipped because the server no longer admits them */
  skipped: { username: string; status: string }[];
};

/** `sim-abc123-admin` → `abc123`. Null when the name is not one of ours. */
export function slugFromAdminUsername(username: string): string | null {
  const match = /^sim-([a-z0-9]+)-admin$/i.exec(username.trim());
  return match ? match[1] : null;
}

/** `sim-abc123-w07` → 7. Null for anything that is not a simulated worker. */
export function indexFromWorkerUsername(username: string | null | undefined): number | null {
  if (!username) return null;
  const match = /-w(\d{1,3})$/.exec(username);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isFinite(index) && index > 0 ? index : null;
}

/**
 * Which site a company was made for, read off the name it was given.
 *
 * `provisionCompany` names it `Demo <site label> <slug>`, so the answer is
 * already on the server and does not need storing anywhere. Falls back to the
 * factory rather than failing: a company whose name someone edited is still
 * perfectly usable, and refusing to resume it over a label would be absurd.
 */
export function siteIdFromCompanyName(name: string): 'factory' | 'construction' {
  return /construction/i.test(name) ? 'construction' : 'factory';
}


type TeamMember = { id: string; username: string | null; role: string; status: string };

/**
 * The join code for a company that already exists.
 *
 * The real-phone half of the demo pairs against this code, so a resumed
 * session that had none would silently drop the most convincing thing in the
 * script. Existing codes are reused rather than minted: signing back in three
 * times should not leave three live codes on a tenant, and the one printed in
 * the runbook should keep working.
 *
 * A resume is still worth having without one — the fleet and its history are
 * the point — so a failure here is swallowed rather than raised.
 */
async function recoverJoinCode(
  adminToken: string,
  request = apiRequest,
): Promise<string> {
  try {
    const codes = await request<EnrollmentCode[]>('GET', '/enrollment-codes', {
      token: adminToken,
    });
    const usable = codes.find(
      (c) => c.type === 'join' && (c.max_uses === null || c.used_count < c.max_uses),
    );
    if (usable) return usable.code;

    const minted = await request<{ code: string }>('POST', '/enrollment-codes', {
      token: adminToken,
      body: { type: 'join', max_uses: null, expires_at: null },
    });
    return minted.code;
  } catch {
    return '';
  }
}

/**
 * Log a company that already exists back in, with every worker.
 *
 * The alternative — a fresh tenant per run — spent sixty undeletable accounts
 * each time and threw away the history that makes analytics worth showing. All
 * of that lives on the server, so this needs no local state: log the admin in,
 * read the roster, and log each worker in with a derived identity. The same
 * accounts come back, with the same ids, still carrying everything they
 * recorded in every run before this one.
 *
 * Workers the server *refuses* are skipped rather than failing the login, and
 * reported: an offboarded worker is supposed to be refused, and a session that
 * would not start because of one would be punishing the feature for working.
 * A worker the server merely *fails* to answer for is retried first — with
 * sixty accounts, reading one 503 as "this worker is gone" would quietly
 * shrink the site every time the server hiccupped.
 */
export async function resumeSession(
  username: string,
  password: string,
  login: LoginFn = realLogin,
  request = apiRequest,
  onProgress?: (done: number, total: number) => void,
): Promise<ResumeSummary> {
  const slug = slugFromAdminUsername(username);
  if (!slug) {
    throw new Error(
      `"${username}" is not a simulator company. Expected sim-<slug>-admin.`,
    );
  }

  const admin = await login(username, password);
  const adminToken = admin.access_token;

  const company = await request<{ id: string; name: string }>('GET', '/companies/me', {
    token: adminToken,
  });

  const roster = await request<TeamMember[]>('GET', '/team', { token: adminToken });

  const joinCode = await recoverJoinCode(adminToken, request);

  // Everyone on the roster this simulator recognises, with the index the whole
  // simulation is keyed on. Read from the server rather than assumed from a
  // count: a company that was seeded twice, or had someone offboarded, has
  // gaps, and walking 1..N would sign in to accounts that do not exist.
  const members = roster
    .filter((member) => member.role !== 'admin')
    .map((member) => ({ member, index: indexFromWorkerUsername(member.username) }))
    .filter((entry): entry is { member: TeamMember; index: number } => entry.index !== null);

  const workers: ProvisionedWorker[] = [];
  const skipped: { username: string; status: string }[] = [];
  let done = 0;

  // Eight at a time. Sixty sequential logins is the better part of a minute of
  // an operator watching a spinner in front of an audience.
  await pooled(members, async ({ member, index }) => {
    // The password from the form, not the identity's default: an operator who
    // changed it should have that change apply to the workers too.
    const identity = { ...workerIdentity(slug, index), password };
    try {
      const worker = await signIn(identity, index, login);
      workers.push({ ...worker, userId: worker.userId || member.id });
    } catch (error) {
      // Refused after retries: offboarded, suspended, or otherwise no longer
      // admitted. Their history stays on the server either way; they just do
      // not get a phone.
      skipped.push({
        username: identity.username,
        status: member.status || (error instanceof Error ? error.message : 'refused'),
      });
    }
    onProgress?.(++done, members.length);
  });

  // Sorted so the fleet, the agents and the roster all walk the same order a
  // fresh provision would have produced.
  workers.sort((a, b) => a.index - b.index);

  return {
    session: {
      slug,
      companyId: company.id,
      companyName: company.name,
      adminUserId: admin.user?.id ?? admin.worker?.id ?? '',
      adminAccessToken: adminToken,
      adminRefreshToken: admin.refresh_token,
      joinCode,
    },
    workers,
    siteId: siteIdFromCompanyName(company.name),
    skipped,
  };
}
