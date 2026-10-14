import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { relayFetch } from '../../../src/relay/relay-fetch';
import { mutateConfig } from '../../../src/config/config-loader-facade';

let fetchSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
  fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
});
afterEach(() => {
  fetchSpy.mockRestore();
  mutateConfig((c) => {
    c.relay = { relays: [], activeId: null };
  });
});

function activateRelay(url = 'https://relay.vercel.app') {
  mutateConfig((c) => {
    c.relay = {
      relays: [{ id: 'r1', name: 'n', platform: 'vercel', url, createdAt: 'x' }],
      activeId: 'r1',
    };
  });
}

describe('relayFetch', () => {
  it('passes through when no relay is active', async () => {
    await relayFetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}' });
    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
  });

  it('rewrites external https through the active relay with both headers', async () => {
    activateRelay();
    await relayFetch('https://api.anthropic.com/v1/messages?beta=true', {
      method: 'POST',
      headers: { authorization: 'Bearer abc' },
      body: '{}',
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://relay.vercel.app/v1/messages?beta=true');
    expect(init.headers.get('x-relay-target')).toBe('https://api.anthropic.com');
    expect(init.headers.get('x-relay-path')).toBe('/v1/messages?beta=true');
    expect(init.headers.get('authorization')).toBe('Bearer abc');
  });

  it('never relays loopback or non-https targets', async () => {
    activateRelay();
    await relayFetch('http://127.0.0.1:8317/v0/management/api-call', { method: 'POST' });
    await relayFetch('http://localhost:11434/api/tags');
    expect(fetchSpy.mock.calls[0][0]).toBe('http://127.0.0.1:8317/v0/management/api-call');
    expect(fetchSpy.mock.calls[1][0]).toBe('http://localhost:11434/api/tags');
    expect(fetchSpy.mock.calls[0][1]?.headers?.get('x-relay-target') ?? null).toBeNull();
  });

  it('does not relay http:// (plain http) external targets even with an active relay', async () => {
    activateRelay();
    await relayFetch('http://example.com/path', { headers: { authorization: 'Bearer abc' } });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://example.com/path');
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get('x-relay-target') ?? null).toBeNull();
    expect(headers.get('x-relay-path') ?? null).toBeNull();
    // Original headers are untouched in the passthrough case.
    expect(headers.get('authorization')).toBe('Bearer abc');
  });

  it('does not relay when the target IS the relay host (no self-loop)', async () => {
    activateRelay();
    await relayFetch('https://relay.vercel.app/x', { headers: { authorization: 'Bearer abc' } });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://relay.vercel.app/x');
    expect(new Headers(init.headers as HeadersInit).get('x-relay-target') ?? null).toBeNull();
  });

  it('preserves query strings and strips the relay header set from user init', async () => {
    activateRelay();
    await relayFetch('https://api.example.com/p?a=1&b=2', {
      headers: {
        'x-relay-target': 'https://stale.example',
        'x-relay-path': '/stale',
        authorization: 'Bearer xyz',
      },
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://relay.vercel.app/p?a=1&b=2');
    // headers.set semantics: the relay's values win over stale user-supplied ones.
    expect(init.headers.get('x-relay-target')).toBe('https://api.example.com');
    expect(init.headers.get('x-relay-path')).toBe('/p?a=1&b=2');
    expect(init.headers.get('authorization')).toBe('Bearer xyz');
  });
});
