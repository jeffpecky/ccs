import { describe, expect, it, mock } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

async function loadAntigravityQuotaTestExports() {
  const moduleId = Date.now() + Math.random();
  const mod = await import(`../quota-fetcher?agy-quota-fetcher=${moduleId}`);
  return mod.__testExports;
}

function installManagedFetch(
  accountId: string,
  providerFetch: (url: string, init?: RequestInit) => Promise<Response>
): typeof fetch {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/v0/management/auth-files')) {
      return Response.json({
        files: [
          {
            id: accountId,
            auth_index: `agy-${accountId}`,
            provider: 'antigravity',
            email: accountId,
          },
        ],
      });
    }
    if (url.endsWith('/v0/management/api-call')) {
      const call = JSON.parse(String(init?.body ?? '{}')) as {
        method?: string;
        url: string;
        header?: Record<string, string>;
        data?: string;
      };
      expect(call.header?.Authorization).toBe('Bearer $TOKEN$');
      const response = await providerFetch(call.url, {
        method: call.method,
        headers: call.header,
        body: call.data,
      });
      return Response.json({
        status_code: response.status,
        header: Object.fromEntries(response.headers.entries()),
        body: await response.text(),
      });
    }
    return Response.json({ error: 'Direct provider request attempted' }, { status: 500 });
  }) as typeof fetch;
  return originalFetch;
}

async function withTemporaryCcsHome(run: () => Promise<void>): Promise<void> {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-agy-managed-test-'));
  const originalCcsHome = process.env.CCS_HOME;
  process.env.CCS_HOME = tempHome;
  try {
    await run();
  } finally {
    if (originalCcsHome === undefined) delete process.env.CCS_HOME;
    else process.env.CCS_HOME = originalCcsHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
}

describe('Antigravity quota failure metadata', () => {
  it('marks 403 failures as not entitled', async () => {
    const { buildAntigravityFailure } = await loadAntigravityQuotaTestExports();

    const result = buildAntigravityFailure(403, 'forbidden');

    expect(result.entitlement).toMatchObject({
      accessState: 'not_entitled',
      capacityState: 'unknown',
    });
  });

  it('marks 429 failures as rate limited', async () => {
    const { buildAntigravityFailure } = await loadAntigravityQuotaTestExports();

    const result = buildAntigravityFailure(429, 'rate limited');

    expect(result.entitlement).toMatchObject({
      accessState: 'unknown',
      capacityState: 'rate_limited',
    });
  });

  it('maps management outage to retryable service failure', async () => {
    await withTemporaryCcsHome(async () => {
      const moduleId = Date.now() + Math.random();
      const { fetchAccountQuota } = await import(`../quota-fetcher?agy-outage=${moduleId}`);
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.reject(new Error('connect ECONNREFUSED'))
      ) as typeof fetch;
      try {
        const result = await fetchAccountQuota('agy', 'outage@example.com');
        expect(result.success).toBe(false);
        expect(result.needsReauth).toBeUndefined();
        expect(result.errorCode).toBe('cliproxy_unavailable');
        expect(result.retryable).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it('reports managed auth missing without reauth', async () => {
    await withTemporaryCcsHome(async () => {
      const moduleId = Date.now() + Math.random();
      const { fetchAccountQuota } = await import(`../quota-fetcher?agy-missing=${moduleId}`);
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() => Promise.resolve(Response.json({ files: [] }))) as typeof fetch;
      try {
        const result = await fetchAccountQuota('agy', 'missing@example.com');
        expect(result.success).toBe(false);
        expect(result.needsReauth).toBeUndefined();
        expect(result.errorCode).toBe('managed_auth_missing');
        expect(result.retryable).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  it('preserves entitlement evidence when project lookup fails before quota fetch', async () => {
    const moduleId = Date.now() + Math.random();
    const { fetchAccountQuota } = await import(`../quota-fetcher?agy-early=${moduleId}`);
    const { getProviderAuthDir } = await import(
      `../../config/config-generator?agy-config=${moduleId}`
    );
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');

    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-agy-failure-'));
    const originalCcsHome = process.env.CCS_HOME;
    process.env.CCS_HOME = tempHome;

    try {
      const authDir = getProviderAuthDir('agy');
      fs.mkdirSync(authDir, { recursive: true });
      fs.writeFileSync(
        path.join(authDir, 'antigravity-user@example.com.json'),
        JSON.stringify({
          type: 'antigravity',
          email: 'user@example.com',
          project_id: 'project-x',
          access_token: 'token',
        })
      );

      const originalFetch = installManagedFetch(
        'user@example.com',
        async () =>
          new Response(JSON.stringify({ error: { message: 'forbidden' } }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          })
      );

      try {
        const result = await fetchAccountQuota('agy', 'user@example.com');
        expect(result.success).toBe(false);
        expect(result.entitlement).toMatchObject({
          accessState: 'not_entitled',
          capacityState: 'unknown',
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    } finally {
      if (originalCcsHome === undefined) {
        delete process.env.CCS_HOME;
      } else {
        process.env.CCS_HOME = originalCcsHome;
      }
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('attaches entitlement evidence when project lookup returns an invalid 2xx payload', async () => {
    const moduleId = Date.now() + Math.random();
    const { fetchAccountQuota } = await import(`../quota-fetcher?agy-invalid-project=${moduleId}`);
    const { getProviderAuthDir } = await import(
      `../../config/config-generator?agy-config=${moduleId}`
    );
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');

    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-agy-invalid-project-'));
    const originalCcsHome = process.env.CCS_HOME;
    process.env.CCS_HOME = tempHome;

    try {
      const authDir = getProviderAuthDir('agy');
      fs.mkdirSync(authDir, { recursive: true });
      fs.writeFileSync(
        path.join(authDir, 'antigravity-user@example.com.json'),
        JSON.stringify({
          type: 'antigravity',
          email: 'user@example.com',
          access_token: 'token',
        })
      );

      const originalFetch = installManagedFetch(
        'user@example.com',
        async () =>
          new Response('', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
      );

      try {
        const result = await fetchAccountQuota('agy', 'user@example.com');
        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('provider_unavailable');
        expect(result.entitlement).toMatchObject({
          accessState: 'unknown',
          capacityState: 'temporarily_unavailable',
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    } finally {
      if (originalCcsHome === undefined) {
        delete process.env.CCS_HOME;
      } else {
        process.env.CCS_HOME = originalCcsHome;
      }
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('preserves live tier evidence when quota fetch fails after a successful project lookup', async () => {
    const moduleId = Date.now() + Math.random();
    const { fetchAccountQuota } = await import(`../quota-fetcher?agy-invalid-models=${moduleId}`);
    const { getProviderAuthDir } = await import(
      `../../config/config-generator?agy-config=${moduleId}`
    );
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');

    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-agy-invalid-models-'));
    const originalCcsHome = process.env.CCS_HOME;
    process.env.CCS_HOME = tempHome;

    try {
      const authDir = getProviderAuthDir('agy');
      fs.mkdirSync(authDir, { recursive: true });
      fs.writeFileSync(
        path.join(authDir, 'antigravity-user@example.com.json'),
        JSON.stringify({
          type: 'antigravity',
          email: 'user@example.com',
          access_token: 'token',
        })
      );

      let requestCount = 0;
      const originalFetch = installManagedFetch('user@example.com', async () => {
        requestCount += 1;
        if (requestCount === 1) {
          return new Response(
            JSON.stringify({
              cloudaicompanionProject: { id: 'project-x' },
              paidTier: { id: 'g1-pro-tier' },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }

        return new Response('', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      try {
        const result = await fetchAccountQuota('agy', 'user@example.com');
        expect(result.success).toBe(false);
        expect(result.entitlement).toMatchObject({
          normalizedTier: 'pro',
          rawTierId: 'g1-pro-tier',
          rawTierLabel: 'Pro',
          accessState: 'unknown',
          capacityState: 'temporarily_unavailable',
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    } finally {
      if (originalCcsHome === undefined) {
        delete process.env.CCS_HOME;
      } else {
        process.env.CCS_HOME = originalCcsHome;
      }
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('tries the daily loadCodeAssist host before falling back to prod', async () => {
    const moduleId = Date.now() + Math.random();
    const { fetchAccountQuota } = await import(`../quota-fetcher?agy-daily-host=${moduleId}`);
    const { getProviderAuthDir } = await import(
      `../../config/config-generator?agy-config=${moduleId}`
    );
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');

    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-agy-daily-host-'));
    const originalCcsHome = process.env.CCS_HOME;
    process.env.CCS_HOME = tempHome;

    try {
      const authDir = getProviderAuthDir('agy');
      fs.mkdirSync(authDir, { recursive: true });
      fs.writeFileSync(
        path.join(authDir, 'antigravity-user@example.com.json'),
        JSON.stringify({
          type: 'antigravity',
          email: 'user@example.com',
          access_token: 'token',
        })
      );

      const urls: string[] = [];
      const originalFetch = installManagedFetch('user@example.com', async (url, init) => {
        urls.push(url);

        if (url === 'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist') {
          const bodyText = typeof init?.body === 'string' ? init.body : '';
          expect(init?.headers).toMatchObject({
            'X-Goog-Api-Client': 'gl-node/22.21.1',
          });
          expect(bodyText).toBe(
            JSON.stringify({
              metadata: {
                ide_name: 'antigravity',
                ide_type: 'ANTIGRAVITY',
                ide_version: '1.21.9',
              },
            })
          );
          return new Response('daily unavailable', { status: 503 });
        }

        if (url === 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist') {
          return new Response(
            JSON.stringify({
              cloudaicompanionProject: { id: 'project-x' },
              paidTier: { id: 'g1-pro-tier' },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }

        if (url === 'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels') {
          return new Response(
            JSON.stringify({
              models: {
                'gemini-3-pro-high': {
                  quotaInfo: {
                    remainingFraction: 0.75,
                    resetTime: '2026-05-01T10:00:00Z',
                  },
                },
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }

        return new Response('unexpected url', { status: 500 });
      });

      try {
        const result = await fetchAccountQuota('agy', 'user@example.com');
        expect(result.success).toBe(true);
        expect(result.tier).toBe('pro');
        expect(result.projectId).toBe('project-x');
        expect(urls).toEqual([
          'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist',
          'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist',
          'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
        ]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    } finally {
      if (originalCcsHome === undefined) {
        delete process.env.CCS_HOME;
      } else {
        process.env.CCS_HOME = originalCcsHome;
      }
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
