import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/net/apiClient';
import {
  indexFromWorkerUsername,
  resumeSession,
  siteIdFromCompanyName,
  slugFromAdminUsername,
} from '@/net/provisioning';

/**
 * Resuming rests entirely on the identities being derivable.
 *
 * Nothing about a session is stored locally: the admin username yields the
 * slug, the slug and index yield every worker's credentials, and the company
 * name yields the site. If any of those three stops being true, a resume
 * silently signs the wrong people in — so each is pinned here.
 */

describe('slugFromAdminUsername', () => {
  it('reads the slug out of a simulator admin name', () => {
    expect(slugFromAdminUsername('sim-olo28e-admin')).toBe('olo28e');
    expect(slugFromAdminUsername('  sim-abc123-admin  ')).toBe('abc123');
  });

  it('refuses anything that is not one of ours', () => {
    // Better to refuse than to guess: the derived worker names would be
    // someone else's, and we would be posting logins for accounts we have no
    // business touching.
    expect(slugFromAdminUsername('admin')).toBeNull();
    expect(slugFromAdminUsername('sim-abc-worker')).toBeNull();
    expect(slugFromAdminUsername('sim--admin')).toBeNull();
    expect(slugFromAdminUsername('')).toBeNull();
  });
});

describe('indexFromWorkerUsername', () => {
  it('recovers the index the whole simulation is keyed on', () => {
    // Physiology, resting heart rate and the agent set are all indexed by this
    // number, so recovering it wrong would give a worker someone else's body.
    expect(indexFromWorkerUsername('sim-abc-w01')).toBe(1);
    expect(indexFromWorkerUsername('sim-abc-w07')).toBe(7);
    expect(indexFromWorkerUsername('sim-abc-w60')).toBe(60);
    expect(indexFromWorkerUsername('sim-abc-w120')).toBe(120);
  });

  it('ignores admins and anything unparseable', () => {
    expect(indexFromWorkerUsername('sim-abc-admin')).toBeNull();
    expect(indexFromWorkerUsername(null)).toBeNull();
    expect(indexFromWorkerUsername(undefined)).toBeNull();
    expect(indexFromWorkerUsername('sim-abc-w00')).toBeNull();
  });
});

describe('siteIdFromCompanyName', () => {
  it('reads the site back off the name the company was given', () => {
    expect(siteIdFromCompanyName('Demo Factory abc123')).toBe('factory');
    expect(siteIdFromCompanyName('Demo Construction site abc123')).toBe('construction');
  });

  it('falls back to the factory rather than refusing an edited name', () => {
    // Refusing to resume a real company over a label would be absurd.
    expect(siteIdFromCompanyName('Acme Ltd')).toBe('factory');
  });
});

describe('resumeSession', () => {
  const roster = [
    { id: 'a', username: 'sim-abc-admin', role: 'admin', status: 'active' },
    { id: 'u2', username: 'sim-abc-w02', role: 'worker', status: 'active' },
    { id: 'u1', username: 'sim-abc-w01', role: 'worker', status: 'active' },
    { id: 'u3', username: 'sim-abc-w03', role: 'worker', status: 'offboarded' },
  ];

  const codes = [
    { code: 'SPENT-11111', type: 'join', max_uses: 1, used_count: 1 },
    { code: 'DEMOFA-LYQXJ', type: 'join', max_uses: null, used_count: 9 },
  ];

  const request = vi.fn(async (_m: string, path: string) => {
    if (path === '/companies/me') return { id: 'c1', name: 'Demo Factory abc' } as never;
    if (path === '/team') return roster as never;
    if (path === '/enrollment-codes') return codes as never;
    throw new Error(`unexpected ${path}`);
  });

  const login = vi.fn(async (username: string) => {
    if (username === 'sim-abc-w03') throw new Error('403');
    return {
      access_token: `at-${username}`,
      refresh_token: `rt-${username}`,
      user: { id: `id-${username}` },
    } as never;
  });

  it('signs every admitted worker back in, in index order', async () => {
    const result = await resumeSession('sim-abc-admin', 'pw', login as never, request as never);

    expect(result.workers.map((w) => w.index)).toEqual([1, 2]);
    expect(result.workers[0].accessToken).toBe('at-sim-abc-w01');
    expect(result.session.slug).toBe('abc');
    expect(result.session.companyName).toBe('Demo Factory abc');
    expect(result.siteId).toBe('factory');
  });

  it('skips a worker the server refuses rather than failing the resume', async () => {
    // An offboarded worker is *supposed* to be refused. Failing the whole
    // session because of one would punish the feature for working.
    const result = await resumeSession('sim-abc-admin', 'pw', login as never, request as never);
    expect(result.skipped).toEqual([{ username: 'sim-abc-w03', status: 'offboarded' }]);
    expect(result.workers).toHaveLength(2);
  });

  it('rebuilds the identity rather than trusting the roster for it', async () => {
    // Date of birth drives `hrMaxForAge`, so it has to be the same value the
    // worker was created with — derived, not read back from a nullable column.
    const result = await resumeSession('sim-abc-admin', 'pw', login as never, request as never);
    expect(result.workers[0].dateOfBirth).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.workers[0].username).toBe('sim-abc-w01');
  });

  it('refuses a username that is not a simulator company', async () => {
    await expect(
      resumeSession('someone-else', 'pw', login as never, request as never),
    ).rejects.toThrow(/not a simulator company/);
  });
});

describe('the join code on a resume', () => {
  const roster = [{ id: 'u1', username: 'sim-abc-w01', role: 'worker', status: 'active' }];
  const login = vi.fn(async (username: string) => ({
    access_token: `at-${username}`,
    refresh_token: `rt-${username}`,
    user: { id: 'x' },
  })) as never;

  function server(codes: unknown, postCode = 'MINTED-00000') {
    return vi.fn(async (method: string, path: string) => {
      if (path === '/companies/me') return { id: 'c1', name: 'Demo Factory abc' } as never;
      if (path === '/team') return roster as never;
      if (path === '/enrollment-codes') {
        if (method === 'POST') return { code: postCode } as never;
        if (codes instanceof Error) throw codes;
        return codes as never;
      }
      throw new Error(`unexpected ${path}`);
    });
  }

  it('reuses a live code rather than minting a second one', async () => {
    // Signing back in three times must not leave three live codes on the
    // tenant, and the code printed in the runbook has to keep working.
    const request = server([
      { code: 'SPENT-11111', type: 'join', max_uses: 1, used_count: 1 },
      { code: 'DEMOFA-LYQXJ', type: 'join', max_uses: null, used_count: 9 },
    ]);
    const result = await resumeSession('sim-abc-admin', 'pw', login, request as never);
    expect(result.session.joinCode).toBe('DEMOFA-LYQXJ');
    expect(request).not.toHaveBeenCalledWith('POST', '/enrollment-codes', expect.anything());
  });

  it('mints one when every existing code is spent', async () => {
    const request = server([{ code: 'SPENT-11111', type: 'join', max_uses: 1, used_count: 1 }]);
    const result = await resumeSession('sim-abc-admin', 'pw', login, request as never);
    expect(result.session.joinCode).toBe('MINTED-00000');
  });

  it('resumes anyway when codes cannot be read at all', async () => {
    // The fleet and its history are the point of a resume. Losing the
    // real-phone pairing is a smaller loss than losing the whole session.
    const request = server(new Error('403'));
    const result = await resumeSession('sim-abc-admin', 'pw', login, request as never);
    expect(result.session.joinCode).toBe('');
    expect(result.workers).toHaveLength(1);
  });
});

describe('logging a company back in, when the server is imperfect', () => {
  const roster = [
    { id: 'u1', username: 'sim-abc-w01', role: 'worker', status: 'active' },
    { id: 'u2', username: 'sim-abc-w02', role: 'worker', status: 'active' },
  ];

  const request = vi.fn(async (_m: string, path: string) => {
    if (path === '/companies/me') return { id: 'c1', name: 'Demo Factory abc' } as never;
    if (path === '/team') return roster as never;
    throw new Error(`unexpected ${path}`);
  });

  it('retries a worker the server merely failed to answer for', async () => {
    // Sixty logins meet a 503 sooner or later. Reading one as "this worker is
    // gone" shrinks the site every time the server hiccups, and the operator
    // cannot tell that from someone who was genuinely offboarded.
    let blips = 0;
    const login = vi.fn(async (username: string) => {
      if (username === 'sim-abc-w02' && blips++ < 1) {
        throw new ApiError('db down', { status: 503 });
      }
      return { access_token: `at-${username}`, refresh_token: 'r', user: { id: 'x' } };
    });

    const result = await resumeSession('sim-abc-admin', 'pw', login as never, request as never);

    expect(result.skipped).toEqual([]);
    expect(result.workers.map((w) => w.index)).toEqual([1, 2]);
  });

  it('still skips a worker the server actually refuses', async () => {
    const login = vi.fn(async (username: string) => {
      if (username === 'sim-abc-w02') throw new ApiError('offboarded', { status: 403 });
      return { access_token: `at-${username}`, refresh_token: 'r', user: { id: 'x' } };
    });

    const result = await resumeSession('sim-abc-admin', 'pw', login as never, request as never);

    expect(result.workers).toHaveLength(1);
    expect(result.skipped).toEqual([{ username: 'sim-abc-w02', status: 'active' }]);
    // Refused, not retried: three round trips for the same answer.
    expect(login.mock.calls.filter((c) => c[0] === 'sim-abc-w02')).toHaveLength(1);
  });

  it('reports progress so a sixty-worker login is not a blank wait', async () => {
    const login = vi.fn(async (username: string) => ({
      access_token: `at-${username}`, refresh_token: 'r', user: { id: 'x' },
    }));
    const seen: Array<[number, number]> = [];

    await resumeSession(
      'sim-abc-admin', 'pw', login as never, request as never,
      (done, total) => seen.push([done, total]),
    );

    expect(seen.at(-1)).toEqual([2, 2]);
  });

  it('signs workers in with the password the operator typed', async () => {
    const login = vi.fn(async (username: string) => ({
      access_token: `at-${username}`, refresh_token: 'r', user: { id: 'x' },
    }));

    await resumeSession('sim-abc-admin', 'typed-one', login as never, request as never);

    expect(login).toHaveBeenCalledWith('sim-abc-w01', 'typed-one');
  });
});

