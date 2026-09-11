import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  callCLIProxyManagementApi,
  CLIProxyManagementUnavailableError,
  resolveCLIProxyAuth,
} from '../cli-proxy-auth-resolver';

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('CLIProxy auth resolver', () => {
  it('selects matching flat auth entry and auth_index', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        Response.json({
          files: [
            { id: 'other@example.com', auth_index: 1, provider: 'gemini' },
            {
              id: 'target-id',
              auth_index: 'target-auth-index',
              provider: 'gemini',
              email: 'target@example.com',
            },
          ],
        })
      )
    ) as typeof fetch;

    const auth = await resolveCLIProxyAuth('gemini', 'target@example.com');

    expect(auth).toEqual({
      authIndex: 'target-auth-index',
      id: 'target-id',
      provider: 'gemini',
      email: 'target@example.com',
    });
  });

  it('returns null only when management responds without a matching auth', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        Response.json({
          files: [{ id: 'other@example.com', auth_index: 1, provider: 'gemini' }],
        })
      )
    ) as typeof fetch;

    expect(await resolveCLIProxyAuth('gemini', 'missing@example.com')).toBeNull();
  });

  it('throws typed unavailable error on management transport failure', async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error('connect ECONNREFUSED'))
    ) as typeof fetch;

    await expect(resolveCLIProxyAuth('gemini', 'target@example.com')).rejects.toBeInstanceOf(
      CLIProxyManagementUnavailableError
    );
  });

  it('returns final provider response and rejects malformed wrappers', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        Response.json({ status_code: 401, header: { 'retry-after': '5' }, body: 'no' })
      )
    ) as typeof fetch;

    const response = await callCLIProxyManagementApi('auth-index', {
      method: 'GET',
      url: 'https://provider.example/quota',
      header: { Authorization: 'Bearer $TOKEN$' },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('retry-after')).toBe('5');
    expect(await response.text()).toBe('no');

    globalThis.fetch = mock(() => Promise.resolve(Response.json({ body: '{}' }))) as typeof fetch;
    await expect(
      callCLIProxyManagementApi('auth-index', {
        method: 'GET',
        url: 'https://provider.example/quota',
      })
    ).rejects.toBeInstanceOf(CLIProxyManagementUnavailableError);
  });
});
