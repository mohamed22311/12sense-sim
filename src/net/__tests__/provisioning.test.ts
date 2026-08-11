import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/net/apiClient';
import {
  DemoTenantNotPurgeableError,
  companyNameFor,
  passwordProblem,
  slugProblem,
  newSessionSlug,
  provisionCompany,
  provisionWorkers,
  purgeCompany,
  workerIdentity,
  type ProvisionedWorker,
} from '@/net/provisioning';

afterEach(() => vi.unstubAllGlobals());

const session = {
  slug: 'abc123',
  companyId: 'c-1',
  companyName: 'Demo',
  adminUserId: 'a-1',
  adminAccessToken: 'admin-tok',
  adminRefreshToken: 'admin-ref',
  joinCode: 'DEMO-7F3Q',
};

/** Builds a stand-in ProvisionedWorker for `alreadyProvisioned` fixtures. */
function fakeWorker(index: number): ProvisionedWorker {
  return {
    ...workerIdentity(session.slug, index),
    index,
    userId: `u-${index}`,
    accessToken: 'a',
    refreshToken: 'r',
  };
}

describe('workerIdentity', () => {
  it('carries the session slug, because identifiers are unique platform-wide', () => {
    const id = workerIdentity('abc123', 1);
    expect(id.username).toContain('abc123');
    expect(id.email).toContain('abc123');
  });

  it('pads the index so worker 1 sorts before worker 10', () => {
    expect(workerIdentity('s', 1).username.endsWith('w01')).toBe(true);
    expect(workerIdentity('s', 10).username.endsWith('w10')).toBe(true);
  });

  it('varies date of birth, because hrMaxForAge depends on it', () => {
    const dobs = new Set(
      Array.from({ length: 20 }, (_, i) => workerIdentity('s', i + 1).dateOfBirth),
    );
    expect(dobs.size).toBeGreaterThan(1);
  });

  it('meets the register schema: username >= 3 chars, password 8-72 bytes', () => {
    const id = workerIdentity('abc123', 7);
    expect(id.username.length).toBeGreaterThanOrEqual(3);
    expect(id.password.length).toBeGreaterThanOrEqual(8);
    expect(new TextEncoder().encode(id.password).length).toBeLessThanOrEqual(72);
  });
});

describe('newSessionSlug', () => {
  it('is short and url-safe', () => {
    expect(newSessionSlug()).toMatch(/^[a-z0-9]{4,12}$/);
  });
});

describe('provisionWorkers', () => {
  it('registers the requested number and reports progress', async () => {
    const seen: number[] = [];
    const post = vi.fn(async (_path: string, body: Record<string, unknown>) => ({
      worker: { id: `u-${body.username as string}` },
      access_token: 'a',
      refresh_token: 'r',
    }));

    const { workers, failures } = await provisionWorkers(
      session,
      5,
      (done) => seen.push(done),
      post,
    );

    expect(workers).toHaveLength(5);
    expect(failures).toHaveLength(0);
    expect(post).toHaveBeenCalledTimes(5);
    expect(seen.at(-1)).toBe(5);
  });

  it('never exceeds the concurrency limit', async () => {
    let live = 0;
    let peak = 0;
    const post = vi.fn(async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      live--;
      return { worker: { id: 'u' }, access_token: 'a', refresh_token: 'r' };
    });

    await provisionWorkers(session, 30, undefined, post);
    expect(peak).toBeLessThanOrEqual(8);
  });

  it('resumes from the already-provisioned workers so a partial gap is retried', async () => {
    const post = vi.fn(async () => ({
      worker: { id: 'u' }, access_token: 'a', refresh_token: 'r',
    }));
    const already = Array.from({ length: 6 }, (_, i) => fakeWorker(i + 1));

    const { workers, failures } = await provisionWorkers(session, 10, undefined, post, already);

    expect(workers).toHaveLength(4);
    expect(workers.map((w) => w.index)).toEqual([7, 8, 9, 10]);
    expect(failures).toHaveLength(0);
    expect(post).toHaveBeenCalledTimes(4);
  });

  it('collects a mid-batch failure instead of discarding successful peers', async () => {
    const post = vi.fn(async (_path: string, body: Record<string, unknown>) => {
      if (body.username === 'sim-abc123-w03') {
        throw new Error('boom');
      }
      return {
        worker: { id: `u-${body.username as string}` },
        access_token: 'a',
        refresh_token: 'r',
      };
    });

    const { workers, failures } = await provisionWorkers(session, 10, undefined, post);

    expect(workers).toHaveLength(9);
    expect(workers.some((w) => w.index === 3)).toBe(false);
    expect(failures).toEqual([{ index: 3, error: 'boom' }]);
  });

  it('resuming after a failure registers exactly the missing index, never re-registering an existing one', async () => {
    const flakyPost = vi.fn(async (_path: string, body: Record<string, unknown>) => {
      if (body.username === 'sim-abc123-w03') {
        throw new Error('boom');
      }
      return {
        worker: { id: `u-${body.username as string}` },
        access_token: 'a',
        refresh_token: 'r',
      };
    });

    const first = await provisionWorkers(session, 10, undefined, flakyPost);
    expect(first.workers).toHaveLength(9);
    expect(first.failures).toHaveLength(1);

    // The transient failure is gone on retry; a fresh mock proves the resumed
    // call only ever touches the index that actually failed.
    const seenUsernames: string[] = [];
    const retryPost = vi.fn(async (_path: string, body: Record<string, unknown>) => {
      seenUsernames.push(body.username as string);
      return {
        worker: { id: `u-${body.username as string}` },
        access_token: 'a',
        refresh_token: 'r',
      };
    });

    const second = await provisionWorkers(session, 10, undefined, retryPost, first.workers);

    expect(second.workers).toHaveLength(1);
    expect(second.workers[0].index).toBe(3);
    expect(second.failures).toHaveLength(0);
    expect(retryPost).toHaveBeenCalledTimes(1);
    expect(seenUsernames).toEqual(['sim-abc123-w03']);
  });

  it('keeps the concurrency cap on a resumed (smaller) batch', async () => {
    let live = 0;
    let peak = 0;
    const post = vi.fn(async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      live--;
      return { worker: { id: 'u' }, access_token: 'a', refresh_token: 'r' };
    });
    const already = Array.from({ length: 10 }, (_, i) => fakeWorker(i + 1));

    await provisionWorkers(session, 30, undefined, post, already);

    expect(peak).toBeLessThanOrEqual(8);
    expect(post).toHaveBeenCalledTimes(20);
  });
});

describe('provisionCompany', () => {
  /** Stubs global fetch so the /enrollment-codes call (not DI'd) never hits the network. */
  function stubEnrollmentCodeFetch(code = 'DEMO-XYZ') {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );
  }

  it('sends is_demo: true in the registration request', async () => {
    const register = vi.fn(async () => ({
      access_token: 'admin-tok',
      refresh_token: 'admin-ref',
      user: { id: 'admin-1' },
      company: { id: 'c-1', is_demo: true },
    }));
    stubEnrollmentCodeFetch();

    await provisionCompany('abc123', 'Site', register);

    expect(register).toHaveBeenCalledWith(
      '/companies/register',
      expect.objectContaining({ is_demo: true }),
    );
  });

  it('throws when the server echoes is_demo: false', async () => {
    const register = vi.fn(async () => ({
      access_token: 'admin-tok',
      refresh_token: 'admin-ref',
      user: { id: 'admin-1' },
      company: { id: 'c-1', is_demo: false },
    }));

    await expect(provisionCompany('abc123', 'Site', register)).rejects.toThrow();
  });

  it('throws when is_demo is absent from the response (old-server case)', async () => {
    const register = vi.fn(async () => ({
      access_token: 'admin-tok',
      refresh_token: 'admin-ref',
      user: { id: 'admin-1' },
      company: { id: 'c-1' } as unknown as { id: string; is_demo: boolean },
    }));

    await expect(provisionCompany('abc123', 'Site', register)).rejects.toThrow();
  });

  it('succeeds and returns normally when the server confirms is_demo: true', async () => {
    const register = vi.fn(async () => ({
      access_token: 'admin-tok',
      refresh_token: 'admin-ref',
      user: { id: 'admin-1' },
      company: { id: 'c-1', is_demo: true },
    }));
    stubEnrollmentCodeFetch('DEMO-XYZ');

    const result = await provisionCompany('abc123', 'Site', register);

    expect(result.companyId).toBe('c-1');
    expect(result.adminAccessToken).toBe('admin-tok');
    expect(result.joinCode).toBe('DEMO-XYZ');
  });
});

describe('purgeCompany', () => {
  it('calls the purge endpoint with the admin bearer token and returns counts verbatim', async () => {
    const counts = { workers: 12, events: 340, responses: 340 };
    const purge = vi.fn(async () => counts);

    const result = await purgeCompany('admin-tok-123', purge);

    expect(purge).toHaveBeenCalledWith('/companies/me/purge', 'admin-tok-123');
    expect(result).toEqual(counts);
  });

  it('surfaces a 403 as a distinguishable "not a demo tenant" error', async () => {
    const purge = vi.fn(async () => {
      throw new ApiError('Forbidden', { status: 403 });
    });

    await expect(purgeCompany('admin-tok-123', purge)).rejects.toThrow(
      DemoTenantNotPurgeableError,
    );
  });

  it('does not mask a non-403 failure as the demo-tenant error', async () => {
    const purge = vi.fn(async () => {
      throw new ApiError('Server error', { status: 500 });
    });

    await expect(purgeCompany('admin-tok-123', purge)).rejects.not.toThrow(
      DemoTenantNotPurgeableError,
    );
  });
});

/**
 * Everyone gets a seat.
 *
 * The demo's premise is sixty phones on a site. A run that quietly comes up
 * with fifty-seven because the server hiccupped three times is not a smaller
 * demo, it is a wrong one — the floor counts, the reach breakdown and the
 * analytics all describe a workforce that does not match what the operator
 * was told they created.
 */
describe('provisionWorkers, when the server is imperfect', () => {
  const ok = (body: Record<string, unknown>) => ({
    worker: { id: `u-${body.username as string}` },
    access_token: 'a',
    refresh_token: 'r',
  });

  it('signs in to an account that already exists instead of losing that worker', async () => {
    // The case that used to strand someone permanently: the registration
    // reached the database and the *response* was lost, so every retry meets
    // 409 and the index is written off. The account exists and the
    // credentials are derived, so the answer is to log in to it.
    const post = vi.fn(async (_p: string, body: Record<string, unknown>) => {
      if (body.username === 'sim-abc123-w03') throw new ApiError('taken', { status: 409 });
      return ok(body);
    });
    const login = vi.fn(async (username: string) => ({
      worker: { id: `u-${username}` },
      access_token: 'adopted',
      refresh_token: 'r',
    }));

    const { workers, failures } = await provisionWorkers(
      session, 5, undefined, post as never, [], login as never,
    );

    expect(failures).toEqual([]);
    expect(workers).toHaveLength(5);
    expect(workers.find((w) => w.index === 3)?.accessToken).toBe('adopted');
    expect(login).toHaveBeenCalledWith('sim-abc123-w03', expect.any(String));
  });

  it('retries a 503 rather than writing the worker off', async () => {
    let hits = 0;
    const post = vi.fn(async (_p: string, body: Record<string, unknown>) => {
      if (body.username === 'sim-abc123-w02' && hits++ < 1) {
        throw new ApiError('db down', { status: 503 });
      }
      return ok(body);
    });

    const { workers, failures } = await provisionWorkers(session, 3, undefined, post as never);

    expect(failures).toEqual([]);
    expect(workers).toHaveLength(3);
  });

  it('does not retry a refusal it cannot fix', async () => {
    // A 422 is the server saying the body is wrong. Asking twice more is
    // three times the wait for the same answer.
    const post = vi.fn(async (_p: string, body: Record<string, unknown>) => {
      if (body.username === 'sim-abc123-w01') throw new ApiError('bad', { status: 422 });
      return ok(body);
    });

    const { failures } = await provisionWorkers(session, 2, undefined, post as never);

    expect(failures.map((f) => f.index)).toEqual([1]);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('returns workers in index order despite finishing out of order', async () => {
    // Eight runners finish in whatever order the network allows, but the
    // fleet, the agents and the roster are all keyed on this index.
    const post = vi.fn(async (_p: string, body: Record<string, unknown>) => {
      const n = Number((body.username as string).slice(-2));
      await new Promise((r) => setTimeout(r, (10 - n) * 2));
      return ok(body);
    });

    const { workers } = await provisionWorkers(session, 9, undefined, post as never);

    expect(workers.map((w) => w.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

/**
 * The company id is typed now, and it is load-bearing.
 *
 * It becomes sixty-one usernames, it is parsed back out of the admin name to
 * log the company in, and it goes into an email address. A value that survives
 * registration but not the round trip produces a company nobody can get back
 * into — so it is refused at the point of typing.
 */
describe('slugProblem', () => {
  it('accepts what the derivation can round-trip', () => {
    expect(slugProblem('acme')).toBeNull();
    expect(slugProblem('acme2026')).toBeNull();
    expect(slugProblem('  acme  ')).toBeNull();
  });

  it('refuses anything the round trip would mangle', () => {
    // `slugFromAdminUsername` matches [a-z0-9]+ — a capital or a dash here
    // would register fine and then fail to parse back, silently.
    expect(slugProblem('ACME')).toMatch(/lower-case/i);
    expect(slugProblem('acme corp')).toMatch(/lower-case/i);
    expect(slugProblem('acme-corp')).toMatch(/lower-case/i);
    expect(slugProblem('ac')).toMatch(/3 characters/);
    expect(slugProblem('averylongcompanyid')).toMatch(/12 characters/);
    expect(slugProblem('')).toMatch(/give the company an id/i);
  });
});

describe('passwordProblem', () => {
  it('accepts the demo default', () => {
    expect(passwordProblem('TwelveDemo2026')).toBeNull();
  });

  it('refuses what the server would refuse, before sixty accounts exist', () => {
    // A 422 on worker 1 of 60 arrives after the company is already created and
    // cannot be renamed. Cheaper to say so at the keyboard.
    expect(passwordProblem('short')).toMatch(/at least 8/i);
    expect(passwordProblem('x'.repeat(73))).toMatch(/72 bytes/);
  });

  it('counts bytes, not characters, because bcrypt does', () => {
    // 24 emoji is 24 characters and 96 bytes.
    expect(passwordProblem('🔧'.repeat(24))).toMatch(/72 bytes/);
  });
});

describe('companyNameFor', () => {
  it('keeps the site inside the name, because logging in reads it back', () => {
    expect(companyNameFor('Acme Manufacturing', 'Factory')).toBe('Acme Manufacturing · Factory');
    expect(companyNameFor('Acme', 'Construction site')).toBe('Acme · Construction site');
  });

  it('does not say it twice', () => {
    expect(companyNameFor('Acme Factory', 'Factory')).toBe('Acme Factory');
  });

  it('falls back rather than producing a nameless company', () => {
    expect(companyNameFor('   ', 'Factory')).toBe('Demo · Factory');
  });
});
