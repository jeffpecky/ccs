// tests/unit/relay/deploy.test.ts
//
// Mocked-HTTP tests for the four relay deploy clients. The shared
// tests/mocks/mock-fetch.ts helper coerces request bodies ('[FormData]',
// '[ArrayBuffer]'), which these tests need verbatim (FormData entries, zip
// bytes), so they install their own spyOn(globalThis, 'fetch') dispatcher
// that records the raw init and answers by method + URL.
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  DeployError,
  deployCloudflare,
  deployDeno,
  deployNetlify,
  deployVercel,
} from '../../../src/relay/deploy';
import { buildIndexFile, buildRelayFunctionZip } from '../../../src/relay/netlify-zip';
import {
  CLOUDFLARE_RELAY_WORKER,
  DENO_RELAY_WORKER,
  VERCEL_RELAY_WORKER,
} from '../../../src/relay/worker-sources';

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

interface MockRoute {
  method: string;
  url: string | RegExp;
  status?: number;
  json?: unknown;
  text?: string;
}

let fetchSpy: { mockRestore(): void } | null = null;
let captured: CapturedRequest[] = [];

function restoreFetchMock(): void {
  if (fetchSpy) {
    fetchSpy.mockRestore();
    fetchSpy = null;
  }
  captured = [];
}

function installFetchMock(routes: MockRoute[]): void {
  restoreFetchMock();
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      const headers: Record<string, string> = {};
      if (init?.headers) {
        new Headers(init.headers).forEach((value, key) => {
          headers[key] = value;
        });
      }
      captured.push({ url, method, headers, body: init?.body ?? null });

      const route = routes.find(
        (r) =>
          r.method === method &&
          (typeof r.url === 'string' ? r.url === url : r.url.test(url)),
      );
      if (!route) {
        return new Response(JSON.stringify({ error: 'no mock route', url, method }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const status = route.status ?? 200;
      if (route.text !== undefined) {
        return new Response(route.text, { status, headers: { 'Content-Type': 'text/plain' } });
      }
      return new Response(JSON.stringify(route.json ?? {}), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  );
}

function findRequest(method: string, url: string | RegExp): CapturedRequest {
  const req = captured.find(
    (r) => r.method === method && (typeof url === 'string' ? r.url === url : url.test(r.url)),
  );
  if (!req) throw new Error(`no captured ${method} request matching ${String(url)}`);
  return req;
}

async function expectDeployError(promise: Promise<unknown>): Promise<DeployError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DeployError);
    return error as DeployError;
  }
  throw new Error('expected a DeployError to be thrown, but the call resolved');
}

/**
 * Run fn with setTimeout callbacks executed synchronously so poll loops
 * (Vercel 3s, Deno 2s hardcoded sleeps) never sleep for real in tests.
 */
async function withInstantTimers<T>(fn: () => Promise<T>): Promise<T> {
  const timerSpy = spyOn(globalThis, 'setTimeout').mockImplementation(
    ((cb: (...args: unknown[]) => void, ...args: unknown[]) => {
      cb(...args);
      return 0;
    }) as unknown as typeof setTimeout,
  );
  try {
    return await fn();
  } finally {
    timerSpy.mockRestore();
  }
}

afterEach(() => {
  restoreFetchMock();
});

// ─── deployVercel ──────────────────────────────────────────────────────

describe('deployVercel', () => {
  it('creates the deployment, disables protection, polls READY, returns the relay URL', async () => {
    installFetchMock([
      {
        method: 'POST',
        url: 'https://api.vercel.com/v13/deployments',
        status: 201,
        json: { id: 'dpl_123', projectId: 'prj_456' },
      },
      {
        method: 'PATCH',
        url: 'https://api.vercel.com/v9/projects/prj_456',
        json: { id: 'prj_456' },
      },
      {
        method: 'GET',
        url: 'https://api.vercel.com/v13/deployments/dpl_123',
        json: { readyState: 'READY', url: 'relay-abc.vercel.app' },
      },
    ]);

    const result = await deployVercel({ token: 'vc_token', name: 'relay-abc' });
    expect(result).toEqual({ url: 'https://relay-abc.vercel.app', name: 'relay-abc' });

    const create = findRequest('POST', 'https://api.vercel.com/v13/deployments');
    expect(create.headers.authorization).toBe('Bearer vc_token');
    const payload = JSON.parse(String(create.body)) as {
      name: string;
      target: string;
      projectSettings: { framework: string | null };
      files: Array<{ file: string; data: string }>;
    };
    expect(payload.name).toBe('relay-abc');
    expect(payload.target).toBe('production');
    expect(payload.projectSettings).toEqual({ framework: null });
    const files = new Map(payload.files.map((f) => [f.file, f.data]));
    expect(files.get('api/relay.js')).toBe(VERCEL_RELAY_WORKER);
    expect(JSON.parse(String(files.get('package.json')))).toEqual({
      name: 'relay-abc',
      version: '1.0.0',
    });
    expect(JSON.parse(String(files.get('vercel.json')))).toEqual({
      rewrites: [{ source: '/(.*)', destination: '/api/relay' }],
    });

    const patch = findRequest('PATCH', 'https://api.vercel.com/v9/projects/prj_456');
    expect(patch.headers.authorization).toBe('Bearer vc_token');
    expect(String(patch.body)).toBe('{"ssoProtection":null}');

    const poll = findRequest('GET', 'https://api.vercel.com/v13/deployments/dpl_123');
    expect(poll.headers.authorization).toBe('Bearer vc_token');
  });

  it('maps upstream error payloads to DeployError with the platform status', async () => {
    installFetchMock([
      {
        method: 'POST',
        url: 'https://api.vercel.com/v13/deployments',
        status: 403,
        json: { error: { message: 'Token revoked' } },
      },
    ]);

    const err = await expectDeployError(deployVercel({ token: 'bad_token', name: 'relay-abc' }));
    expect(err.status).toBe(403);
    expect(err.message).toBe('Token revoked');
  });

  it('rejects a missing token with a 400 DeployError before any request', async () => {
    installFetchMock([]);

    const err = await expectDeployError(deployVercel({ token: '' }));
    expect(err.status).toBe(400);
    expect(err.message).toBe('Vercel API token is required');
    expect(captured.length).toBe(0);
  });
});

// ─── deployCloudflare ──────────────────────────────────────────────────

describe('deployCloudflare', () => {
  it('uploads the script as FormData, enables the subdomain, and returns workers.dev URL', async () => {
    installFetchMock([
      {
        method: 'PUT',
        url: 'https://api.cloudflare.com/client/v4/accounts/acct1/workers/scripts/myrelay',
        json: { success: true },
      },
      {
        method: 'POST',
        url: 'https://api.cloudflare.com/client/v4/accounts/acct1/workers/scripts/myrelay/subdomain',
        json: { success: true },
      },
      {
        method: 'GET',
        url: 'https://api.cloudflare.com/client/v4/accounts/acct1/workers/subdomain',
        json: { result: { subdomain: 'user' } },
      },
    ]);

    const result = await deployCloudflare({
      token: 'cf_token',
      accountId: 'acct1',
      name: 'myrelay',
    });
    expect(result).toEqual({ url: 'https://myrelay.user.workers.dev', name: 'myrelay' });

    const put = findRequest(
      'PUT',
      'https://api.cloudflare.com/client/v4/accounts/acct1/workers/scripts/myrelay',
    );
    expect(put.headers.authorization).toBe('Bearer cf_token');
    expect(put.body).toBeInstanceOf(FormData);
    const form = put.body as FormData;
    expect(form.get('index.js')).toBeInstanceOf(Blob);
    const script = form.get('index.js') as Blob;
    expect(script.type).toBe('application/javascript+module');
    expect(await script.text()).toBe(CLOUDFLARE_RELAY_WORKER);
    expect(form.get('metadata')).toBeInstanceOf(Blob);
    const metadata = JSON.parse(await (form.get('metadata') as Blob).text()) as Record<
      string,
      unknown
    >;
    expect(metadata).toEqual({
      main_module: 'index.js',
      compatibility_date: '2024-03-20',
      observability: { enabled: true },
    });

    const enable = findRequest(
      'POST',
      'https://api.cloudflare.com/client/v4/accounts/acct1/workers/scripts/myrelay/subdomain',
    );
    expect(enable.headers.authorization).toBe('Bearer cf_token');
    expect(JSON.parse(String(enable.body))).toEqual({ enabled: true });

    findRequest('GET', 'https://api.cloudflare.com/client/v4/accounts/acct1/workers/subdomain');
  });

  it('rejects a missing accountId with a 400 DeployError before any request', async () => {
    installFetchMock([]);

    const err = await expectDeployError(deployCloudflare({ token: 'cf_token' }));
    expect(err.status).toBe(400);
    expect(err.message).toBe('Cloudflare Account ID and API Token are required');
    expect(captured.length).toBe(0);
  });

  it('maps upload failures to DeployError with errors[0].message', async () => {
    installFetchMock([
      {
        method: 'PUT',
        url: 'https://api.cloudflare.com/client/v4/accounts/acct1/workers/scripts/myrelay',
        status: 403,
        json: { errors: [{ message: 'Invalid API token' }] },
      },
    ]);

    const err = await expectDeployError(
      deployCloudflare({ token: 'bad', accountId: 'acct1', name: 'myrelay' }),
    );
    expect(err.status).toBe(403);
    expect(err.message).toBe('Invalid API token');
  });

  it('fails with 400 when the account has no workers.dev subdomain', async () => {
    installFetchMock([
      {
        method: 'PUT',
        url: 'https://api.cloudflare.com/client/v4/accounts/acct1/workers/scripts/myrelay',
        json: { success: true },
      },
      {
        method: 'POST',
        url: 'https://api.cloudflare.com/client/v4/accounts/acct1/workers/scripts/myrelay/subdomain',
        status: 400,
        json: { errors: [{ message: 'subdomain not found' }] },
      },
      {
        method: 'GET',
        url: 'https://api.cloudflare.com/client/v4/accounts/acct1/workers/subdomain',
        json: { result: null },
      },
    ]);

    const err = await expectDeployError(
      deployCloudflare({ token: 'cf_token', accountId: 'acct1', name: 'myrelay' }),
    );
    expect(err.status).toBe(400);
    expect(err.message).toBe(
      'Worker deployed but failed to retrieve workers.dev subdomain. Make sure you have setup a workers.dev subdomain in Cloudflare Dashboard.',
    );
  });
});

// ─── deployDeno ────────────────────────────────────────────────────────

describe('deployDeno', () => {
  it('creates the app, uploads main.ts, polls until succeeded, returns deno.net URL', async () => {
    installFetchMock([
      {
        method: 'POST',
        url: 'https://api.deno.com/v2/apps',
        status: 201,
        json: { id: 'app_1' },
      },
      {
        method: 'POST',
        url: 'https://api.deno.com/v2/apps/app_1/deploy',
        status: 201,
        json: { id: 'rev_1', status: 'queued' },
      },
      {
        method: 'GET',
        url: 'https://api.deno.com/v2/revisions/rev_1',
        json: { status: 'succeeded' },
      },
    ]);

    const result = await withInstantTimers(() =>
      deployDeno({ token: 'deno_t', orgDomain: 'myorg.deno.dev', name: 'myrelay' }),
    );
    expect(result).toEqual({ url: 'https://myrelay.myorg.deno.net', name: 'myrelay' });

    const create = findRequest('POST', 'https://api.deno.com/v2/apps');
    expect(create.headers.authorization).toBe('Bearer deno_t');
    const createPayload = JSON.parse(String(create.body)) as {
      slug: string;
      labels: Record<string, string>;
      config: { install: string; runtime: { type: string; entrypoint: string } };
    };
    expect(createPayload.slug).toBe('myrelay');
    expect(createPayload.labels).toEqual({ 'custom.kind': 'ccs-relay' });
    expect(createPayload.config).toEqual({
      install: 'deno install',
      runtime: { type: 'dynamic', entrypoint: 'main.ts' },
    });

    const deployPost = findRequest('POST', 'https://api.deno.com/v2/apps/app_1/deploy');
    expect(deployPost.headers.authorization).toBe('Bearer deno_t');
    const deployPayload = JSON.parse(String(deployPost.body)) as {
      assets: Record<string, { kind: string; content: string; encoding: string }>;
    };
    expect(deployPayload.assets['main.ts']).toEqual({
      kind: 'file',
      content: DENO_RELAY_WORKER,
      encoding: 'utf-8',
    });

    findRequest('GET', 'https://api.deno.com/v2/revisions/rev_1');
  });

  it('maps a 409 on app creation to an already-exists DeployError', async () => {
    installFetchMock([
      {
        method: 'POST',
        url: 'https://api.deno.com/v2/apps',
        status: 409,
        text: 'conflict',
      },
    ]);

    const err = await expectDeployError(
      deployDeno({ token: 'deno_t', orgDomain: 'myorg.deno.dev', name: 'myrelay' }),
    );
    expect(err.status).toBe(409);
    expect(err.message).toBe('App "myrelay" already exists. Choose a different name.');
  });

  it('rejects a missing orgDomain or token with a 400 DeployError', async () => {
    installFetchMock([]);

    const noOrg = await expectDeployError(deployDeno({ token: 'deno_t' }));
    expect(noOrg.status).toBe(400);
    expect(noOrg.message).toBe('Organization domain is required');

    const noToken = await expectDeployError(
      deployDeno({ token: '', orgDomain: 'myorg.deno.dev' }),
    );
    expect(noToken.status).toBe(400);
    expect(noToken.message).toBe('Deno Deploy API token is required');
    expect(captured.length).toBe(0);
  });

  it('deletes the app best-effort when the deploy upload fails', async () => {
    installFetchMock([
      {
        method: 'POST',
        url: 'https://api.deno.com/v2/apps',
        status: 201,
        json: { id: 'app_1' },
      },
      {
        method: 'POST',
        url: 'https://api.deno.com/v2/apps/app_1/deploy',
        status: 500,
        text: 'builder exploded',
      },
      { method: 'DELETE', url: 'https://api.deno.com/v2/apps/app_1', json: { ok: true } },
    ]);

    const err = await expectDeployError(
      deployDeno({ token: 'deno_t', orgDomain: 'myorg.deno.dev', name: 'myrelay' }),
    );
    expect(err.status).toBe(500);
    expect(err.message).toBe('Deploy failed (500): builder exploded');
    const del = findRequest('DELETE', 'https://api.deno.com/v2/apps/app_1');
    expect(del.headers.authorization).toBe('Bearer deno_t');
  });

  it('deletes the app when the revision ends in a non-succeeded status', async () => {
    installFetchMock([
      {
        method: 'POST',
        url: 'https://api.deno.com/v2/apps',
        status: 201,
        json: { id: 'app_1' },
      },
      {
        method: 'POST',
        url: 'https://api.deno.com/v2/apps/app_1/deploy',
        status: 201,
        json: { id: 'rev_1', status: 'queued' },
      },
      { method: 'GET', url: 'https://api.deno.com/v2/revisions/rev_1', json: { status: 'failed' } },
      { method: 'DELETE', url: 'https://api.deno.com/v2/apps/app_1', json: { ok: true } },
    ]);

    const err = await withInstantTimers(() =>
      expectDeployError(
        deployDeno({ token: 'deno_t', orgDomain: 'myorg.deno.dev', name: 'myrelay' }),
      ),
    );
    expect(err.status).toBe(500);
    expect(err.message).toBe('Deploy failed with status: failed');
    findRequest('DELETE', 'https://api.deno.com/v2/apps/app_1');
  });
});

// ─── deployNetlify ─────────────────────────────────────────────────────

describe('deployNetlify', () => {
  it('sanitizes the site name, digest-deploys, uploads required bodies, polls ready', async () => {
    const { zip, sha256 } = buildRelayFunctionZip();
    const { content: indexContent, sha1 } = buildIndexFile();
    installFetchMock([
      {
        method: 'POST',
        url: 'https://api.netlify.com/api/v1/sites',
        status: 201,
        json: { id: 'site1', ssl_url: 'https://myrelay.netlify.app' },
      },
      {
        method: 'POST',
        url: 'https://api.netlify.com/api/v1/sites/site1/deploys',
        status: 201,
        json: { id: 'dp1', required: [sha1], required_functions: [sha256] },
      },
      {
        method: 'PUT',
        url: 'https://api.netlify.com/api/v1/deploys/dp1/files/index.html',
        json: {},
      },
      {
        method: 'PUT',
        url: 'https://api.netlify.com/api/v1/deploys/dp1/functions/relay?runtime=js',
        json: {},
      },
      {
        method: 'GET',
        url: 'https://api.netlify.com/api/v1/deploys/dp1',
        json: { state: 'ready' },
      },
    ]);

    const result = await deployNetlify({ token: 'netlify_t', name: 'My Relay!' });
    expect(result).toEqual({
      url: 'https://myrelay.netlify.app/.netlify/functions/relay',
      name: 'my-relay',
    });

    const sitePost = findRequest('POST', 'https://api.netlify.com/api/v1/sites');
    expect(sitePost.headers.authorization).toBe('Bearer netlify_t');
    expect(sitePost.headers['user-agent']).toBe('CCS');
    expect(sitePost.headers['content-type']).toBe('application/json');
    expect(JSON.parse(String(sitePost.body))).toEqual({ name: 'my-relay' });

    const digestPost = findRequest('POST', 'https://api.netlify.com/api/v1/sites/site1/deploys');
    const digest = JSON.parse(String(digestPost.body)) as {
      files: Record<string, string>;
      functions: Record<string, string>;
    };
    expect(digest.files).toEqual({ '/index.html': sha1 });
    expect(digest.functions).toEqual({ relay: sha256 });

    const filePut = findRequest(
      'PUT',
      'https://api.netlify.com/api/v1/deploys/dp1/files/index.html',
    );
    expect(filePut.headers['content-type']).toBe('application/octet-stream');
    expect(filePut.body).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(filePut.body as Uint8Array).equals(indexContent)).toBe(true);

    const fnPut = findRequest(
      'PUT',
      'https://api.netlify.com/api/v1/deploys/dp1/functions/relay?runtime=js',
    );
    expect(fnPut.headers['content-type']).toBe('application/octet-stream');
    const fnBody = Buffer.from(fnPut.body as Uint8Array);
    expect(fnBody.equals(zip)).toBe(true);
    expect(createHash('sha256').update(fnBody).digest('hex')).toBe(digest.functions.relay);

    findRequest('GET', 'https://api.netlify.com/api/v1/deploys/dp1');
  });

  it('maps a 422 site-name collision to a 409 DeployError with the taken hint', async () => {
    installFetchMock([
      {
        method: 'POST',
        url: 'https://api.netlify.com/api/v1/sites',
        status: 422,
        json: { message: 'A site with the same name already exists' },
      },
    ]);

    const err = await expectDeployError(deployNetlify({ token: 'netlify_t', name: 'taken-relay' }));
    expect(err.status).toBe(409);
    expect(err.message).toBe(
      'A site with the same name already exists. Site name "taken-relay" is taken — choose a different name.',
    );
  });

  it('rejects a missing token with a 400 DeployError before any request', async () => {
    installFetchMock([]);

    const err = await expectDeployError(deployNetlify({ token: '' }));
    expect(err.status).toBe(400);
    expect(err.message).toBe('Netlify API token is required');
    expect(captured.length).toBe(0);
  });
});
