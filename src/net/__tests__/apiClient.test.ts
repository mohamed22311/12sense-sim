import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, newClientEventId } from '@/net/apiClient';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

afterEach(() => vi.unstubAllGlobals());

describe('apiRequest', () => {
  it('sends the per-call bearer token', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init: RequestInit) =>
      jsonResponse(200, { ok: true }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('GET', '/auth/me', { token: 'tok-42' });

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-42');
  });

  it('omits Authorization when no token is given', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init: RequestInit) =>
      jsonResponse(200, {}),
    );
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('POST', '/auth/login', { body: { username_or_email: 'a' } });

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('surfaces a structured 409 detail as code and details', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse(409, {
        detail: { code: 'event_already_resolved', resolved_by: 'w-1' },
      }),
    );

    const err = (await apiRequest('POST', '/events/e1/responses', {}).catch(
      (e: ApiError) => e,
    )) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe('event_already_resolved');
    expect(err.details?.resolved_by).toBe('w-1');
  });

  it('turns a FastAPI 422 array into a readable message', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse(422, {
        detail: [{ loc: ['body', 'email'], msg: 'not a valid email address' }],
      }),
    );

    const err = (await apiRequest('POST', '/auth/register', {}).catch(
      (e: ApiError) => e,
    )) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.message).toBe('email: not a valid email address');
  });

  it('keeps the status when the body is not JSON', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>502</html>', { status: 502 }));

    const err = (await apiRequest('GET', '/events', {}).catch((e: ApiError) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.code).toBe('non_json_response');
  });
});

describe('newClientEventId', () => {
  it('produces distinct v4-shaped ids', () => {
    const a = newClientEventId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(newClientEventId());
  });
});
