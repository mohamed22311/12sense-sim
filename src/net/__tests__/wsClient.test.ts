import { describe, expect, it, vi } from 'vitest';
import { browserSocketFactory } from '@/net/wsClient';

vi.mock('@/phone/vendor/realtime/socket', async () => {
  const actual = await vi.importActual<typeof import('@/phone/vendor/realtime/socket')>(
    '@/phone/vendor/realtime/socket',
  );
  return {
    ...actual,
    createWsController: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), kick: vi.fn() })),
  };
});

describe('browserSocketFactory', () => {
  it('constructs a socket at the url it is given', () => {
    const ctor = vi.fn(function (this: Record<string, unknown>, url: string) {
      this.url = url;
    });
    vi.stubGlobal('WebSocket', ctor);

    browserSocketFactory('wss://example/api/v1/ws?token=abc');

    expect(ctor).toHaveBeenCalledWith('wss://example/api/v1/ws?token=abc');
    vi.unstubAllGlobals();
  });

  it('exposes the handler properties the vendored controller assigns', () => {
    class FakeSocket {
      onopen: unknown = null;
      onmessage: unknown = null;
      onerror: unknown = null;
      onclose: unknown = null;
      send() {}
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeSocket);

    const s = browserSocketFactory('wss://example/ws');
    s.onopen = () => {};
    s.onmessage = () => {};

    expect(typeof s.send).toBe('function');
    expect(typeof s.close).toBe('function');
    vi.unstubAllGlobals();
  });
});

describe('connectPhoneSocket — dependency wiring', () => {
  it('forwards each dependency to the vendored controller in the right slot', async () => {
    const { connectPhoneSocket } = await import('@/net/wsClient');
    const { createWsController } = await import('@/phone/vendor/realtime/socket');

    const createSocket = vi.fn();
    const getAccessToken = vi.fn(() => 'tok-1');
    const refreshAccessToken = vi.fn(async () => 'tok-2');
    const onMessage = vi.fn();
    const onStatus = vi.fn();

    connectPhoneSocket({
      url: 'wss://example/api/v1/ws',
      createSocket,
      getAccessToken,
      refreshAccessToken,
      onMessage,
      onStatus,
    });

    expect(createWsController).toHaveBeenCalledTimes(1);
    const deps = vi.mocked(createWsController).mock.calls[0][0];

    // A swapped getAccessToken/refreshAccessToken would still compile and
    // still pass a test that only checks "some function landed somewhere" —
    // so assert identity into the exact named slot, not just presence.
    expect(deps.url).toBe('wss://example/api/v1/ws');
    expect(deps.createSocket).toBe(createSocket);
    expect(deps.getAccessToken).toBe(getAccessToken);
    expect(deps.refreshAccessToken).toBe(refreshAccessToken);
    expect(deps.onMessage).toBe(onMessage);
    expect(deps.onStatus).toBe(onStatus);
    expect(deps.random).toBe(Math.random);
  });

  it('defaults createSocket to browserSocketFactory and url to WS_URL when omitted', async () => {
    const { connectPhoneSocket, browserSocketFactory: factory } = await import('@/net/wsClient');
    const { createWsController } = await import('@/phone/vendor/realtime/socket');
    const { WS_URL } = await import('@/net/config');

    connectPhoneSocket({
      getAccessToken: () => null,
      refreshAccessToken: async () => null,
      onMessage: vi.fn(),
      onStatus: vi.fn(),
    });

    const deps = vi.mocked(createWsController).mock.calls.at(-1)![0];
    expect(deps.url).toBe(WS_URL);
    expect(deps.createSocket).toBe(factory);
  });

  it('round-trips a setTimeout/clearTimeout handle through the injected timer functions', async () => {
    const { connectPhoneSocket } = await import('@/net/wsClient');
    const { createWsController } = await import('@/phone/vendor/realtime/socket');
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    connectPhoneSocket({
      url: 'wss://example/ws',
      createSocket: vi.fn(),
      getAccessToken: () => null,
      refreshAccessToken: async () => null,
      onMessage: vi.fn(),
      onStatus: vi.fn(),
    });

    const deps = vi.mocked(createWsController).mock.calls.at(-1)![0];
    const handle = deps.setTimeout(() => {}, 10_000);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 10_000);

    deps.clearTimeout(handle);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(handle);

    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });
});
