import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fetchKiroQuota } from '../quota-fetcher-kiro';

let tmpDir: string;
let originalCcsHome: string | undefined;
let originalFetch: typeof fetch;

function createKiroAccount(accountId: string): void {
  const cliproxyDir = path.join(tmpDir, '.ccs', 'cliproxy');
  const authDir = path.join(cliproxyDir, 'auth');
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(
    path.join(authDir, `kiro-aws-${accountId}.json`),
    JSON.stringify({
      email: accountId,
      profile_arn: 'arn:aws:codewhisperer:us-east-1:123456789012:profile/test',
      auth_method: 'builder-id',
      access_token: 'file-access-token-must-not-leave-ccs',
      refresh_token: 'file-refresh-token-must-not-leave-ccs',
    })
  );
  fs.writeFileSync(
    path.join(cliproxyDir, 'accounts.json'),
    JSON.stringify({
      version: 1,
      providers: {
        kiro: {
          default: accountId,
          accounts: {
            [accountId]: {
              nickname: accountId,
              tokenFile: `kiro-aws-${accountId}.json`,
              createdAt: '2026-09-03T00:00:00.000Z',
              lastUsedAt: '2026-09-03T00:00:00.000Z',
            },
          },
        },
      },
    })
  );
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-kiro-quota-test-'));
  originalCcsHome = process.env.CCS_HOME;
  process.env.CCS_HOME = tmpDir;
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalCcsHome === undefined) delete process.env.CCS_HOME;
  else process.env.CCS_HOME = originalCcsHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Kiro quota fetcher', () => {
  it('preserves endpoint fallback order through management API only', async () => {
    createKiroAccount('kiro@example.com');
    const attempts: Array<{ method: string; url: string }> = [];
    const managementBodies: string[] = [];

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/v0/management/auth-files')) {
        return Response.json({
          files: [
            {
              id: 'kiro@example.com',
              auth_index: 'kiro-auth-index',
              provider: 'kiro',
              email: 'kiro@example.com',
            },
          ],
        });
      }

      expect(url).toContain('/v0/management/api-call');
      const bodyText = String(init?.body ?? '');
      managementBodies.push(bodyText);
      const call = JSON.parse(bodyText) as {
        method: string;
        url: string;
        header: Record<string, string>;
      };
      attempts.push({ method: call.method, url: call.url });
      expect(call.header.Authorization).toBe('Bearer $TOKEN$');

      if (call.url.startsWith('https://q.us-east-1.amazonaws.com/')) {
        return Response.json({
          status_code: 200,
          body: JSON.stringify({
            subscriptionInfo: { subscriptionTitle: 'Kiro Pro' },
            usageBreakdownList: [
              {
                resourceType: 'AGENTIC_REQUEST',
                currentUsageWithPrecision: 25,
                usageLimitWithPrecision: 100,
              },
            ],
          }),
        });
      }
      return Response.json({ status_code: 503, body: '' });
    }) as typeof fetch;

    const result = await fetchKiroQuota('kiro@example.com');

    expect(result.success).toBe(true);
    expect(result.windows[0].remainingPercent).toBe(75);
    expect(attempts).toEqual([
      {
        method: 'GET',
        url: expect.stringContaining(
          'https://codewhisperer.us-east-1.amazonaws.com/getUsageLimits'
        ),
      },
      {
        method: 'GET',
        url: expect.stringContaining(
          'https://codewhisperer.us-west-2.amazonaws.com/getUsageLimits'
        ),
      },
      { method: 'POST', url: 'https://codewhisperer.us-east-1.amazonaws.com' },
      { method: 'POST', url: 'https://codewhisperer.us-west-2.amazonaws.com' },
      {
        method: 'GET',
        url: expect.stringContaining('https://q.us-east-1.amazonaws.com/getUsageLimits'),
      },
    ]);
    expect(managementBodies.join('\n')).not.toContain('file-access-token-must-not-leave-ccs');
    expect(managementBodies.join('\n')).not.toContain('file-refresh-token-must-not-leave-ccs');
  });

  it('maps final provider unauthorized response to reauth', async () => {
    createKiroAccount('reauth@example.com');
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/v0/management/auth-files')) {
        return Promise.resolve(
          Response.json({
            files: [
              {
                id: 'reauth@example.com',
                auth_index: 'kiro-reauth',
                provider: 'kiro',
              },
            ],
          })
        );
      }
      return Promise.resolve(Response.json({ status_code: 401, body: '' }));
    }) as typeof fetch;

    const result = await fetchKiroQuota('reauth@example.com');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('reauth_required');
    expect(result.needsReauth).toBe(true);
    expect(result.retryable).toBe(false);
  });

  it('maps management outage to retryable service failure', async () => {
    createKiroAccount('outage@example.com');
    globalThis.fetch = mock(() =>
      Promise.reject(new Error('connect ECONNREFUSED'))
    ) as typeof fetch;

    const result = await fetchKiroQuota('outage@example.com');

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('cliproxy_unavailable');
    expect(result.retryable).toBe(true);
  });
});
