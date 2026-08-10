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
const DEMO_PASSWORD = 'TwelveDemo2026';

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
      username: `sim-${slug}-admin`,
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
): Promise<ProvisionWorkersResult> {
  const doneIndices = new Set(alreadyProvisioned.map((w) => w.index));
  const indices = Array.from({ length: count }, (_, i) => i + 1).filter(
    (index) => !doneIndices.has(index),
  );

  const workers: ProvisionedWorker[] = [];
  const failures: ProvisionFailure[] = [];
  let cursor = 0;
  let done = alreadyProvisioned.length;

  const runner = async () => {
    while (cursor < indices.length) {
      const index = indices[cursor++];
      const id = workerIdentity(session.slug, index);
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
        workers.push({
          ...id,
          index,
          userId: (res.worker ?? res.user)?.id ?? '',
          accessToken: res.access_token,
          refreshToken: res.refresh_token,
        });
      } catch (err) {
        failures.push({ index, error: err instanceof Error ? err.message : String(err) });
      }
      onProgress?.(++done, count);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(PROVISION_CONCURRENCY, indices.length) }, runner),
  );
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
