import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CLOUDFLARE_RELAY_WORKER, DENO_RELAY_WORKER, NETLIFY_INDEX_HTML, NETLIFY_RELAY_FUNCTION, VERCEL_RELAY_WORKER,
} from '../../../src/relay/worker-sources';

/** Hook timeout: the real work is sub-ms; 30s keeps machine-load stalls from tripping the 10s bunfig default. */
const HOOK_TIMEOUT = 30_000;

let fetchSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  fetchSpy = spyOn(globalThis, 'fetch');
}, HOOK_TIMEOUT);

afterEach(() => {
  try {
    fetchSpy.mockRestore();
  } catch {
    // Never let a restore failure block the afterAll temp-dir cleanup.
  }
}, HOOK_TIMEOUT);

/** Writes the worker source to `path` and imports it as an ES module (once per describe). */
async function importEsm(source: string, path: string) {
  writeFileSync(path, source, 'utf8');
  return import(pathToFileURL(path).href);
}

/** Reads a forwarded header whether the worker passed a plain object or Headers. */
function forwardedHeader(headers: unknown, name: string): unknown {
  if (headers instanceof Headers) return headers.get(name);
  if (typeof headers === 'object' && headers !== null) {
    return (headers as Record<string, string | undefined>)[name];
  }
  return undefined;
}

const echoUpstream = () => new Response(JSON.stringify({ ok: true }), {
  status: 200, headers: { 'content-type': 'application/json' },
});

describe('vercel relay worker', () => {
  let dir: string;
  let handler: (req: Request) => Promise<Response>;

  // The worker module is stateless and resolves fetch at call time, so import
  // it once per describe and reuse it across tests (the per-test fetch spy is
  // the isolation that matters).
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'relay-worker-'));
    const mod = await importEsm(VERCEL_RELAY_WORKER, join(dir, 'vercel.mjs'));
    handler = mod.default;
  }, HOOK_TIMEOUT);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  }, HOOK_TIMEOUT);

  it('400s without x-relay-target', async () => {
    const res = await handler(new Request('https://relay.example.com/anything', { headers: {} }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Missing x-relay-target header' });
  });

  it('composes target+path, strips relay headers + host, passes auth + response through', async () => {
    fetchSpy.mockImplementation(async () => echoUpstream());
    const res = await handler(new Request('https://relay.example.com/anything', {
      method: 'GET',
      headers: {
        'x-relay-target': 'https://api.anthropic.com/', // trailing slash must be trimmed
        'x-relay-path': '/v1/messages?beta=true',
        authorization: 'Bearer abc',
      },
    }));
    expect(res.status).toBe(200);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages?beta=true');
    expect(forwardedHeader(init.headers, 'x-relay-target')).toBeFalsy();
    expect(forwardedHeader(init.headers, 'x-relay-path')).toBeFalsy();
    expect(forwardedHeader(init.headers, 'host')).toBeFalsy();
    expect(forwardedHeader(init.headers, 'authorization')).toBe('Bearer abc');
    // The stamp tells the proxy's relay breaker this failure (if any) came
    // from the upstream, not from the worker's own platform.
    expect(forwardedHeader(res.headers, 'x-relay-proxied')).toBe('1');
  });

  it('forwards POST bodies and returns 502 when upstream throws (CCS deviation)', async () => {
    fetchSpy.mockImplementation(async () => { throw new Error('boom'); });
    const res = await handler(new Request('https://relay.example.com', {
      method: 'POST',
      headers: { 'x-relay-target': 'https://api.anthropic.com', 'x-relay-path': '/v1/messages' },
      body: '{"x":1}',
    }));
    expect(res.status).toBe(502);
    expect((await res.json() as { error: string }).error).toContain('boom');
    // The mock recorded the call before throwing — prove method + body reached fetch.
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.body).toBeTruthy();
    expect(await new Response(init.body).text()).toBe('{"x":1}');
  });
});

describe('cloudflare relay worker', () => {
  let dir: string;
  let fetchWorker: (req: Request, env: unknown, ctx: unknown) => Promise<Response>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'relay-worker-'));
    const mod = await importEsm(CLOUDFLARE_RELAY_WORKER, join(dir, 'cf.mjs'));
    fetchWorker = mod.default.fetch;
  }, HOOK_TIMEOUT);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  }, HOOK_TIMEOUT);

  it('400s without target', async () => {
    const res = await fetchWorker(new Request('https://relay.example.com', { headers: {} }), {}, {});
    expect(res.status).toBe(400);
  });

  it('forwards POST bodies via streaming request body, strips relay headers', async () => {
    fetchSpy.mockImplementation(async () => echoUpstream());
    const res = await fetchWorker(new Request('https://relay.example.com', {
      method: 'POST',
      headers: { 'x-relay-target': 'https://api.openai.com', 'x-relay-path': '/v1/chat/completions' },
      body: '{"hello":"world"}',
    }), {}, {});
    expect(res.status).toBe(200);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(forwardedHeader(init.headers, 'x-relay-target')).toBeFalsy();
    expect(forwardedHeader(init.headers, 'x-relay-path')).toBeFalsy();
    expect(forwardedHeader(init.headers, 'host')).toBeFalsy();
    // The name promises body forwarding — prove method + streamed body reached fetch.
    expect(init.method).toBe('POST');
    expect(init.body).toBeTruthy();
    expect(await new Response(init.body).text()).toBe('{"hello":"world"}');
    // Stamped so the proxy's breaker can tell upstream answers from platform failures.
    expect(forwardedHeader(res.headers, 'x-relay-proxied')).toBe('1');
  });

  it('returns 502 JSON when upstream throws', async () => {
    fetchSpy.mockImplementation(async () => { throw new Error('cf boom'); });
    const res = await fetchWorker(new Request('https://relay.example.com', {
      headers: { 'x-relay-target': 'https://api.openai.com' },
    }), {}, {});
    expect(res.status).toBe(502);
  });
});

describe('deno relay worker', () => {
  let dir: string;
  let handler: (req: Request) => Promise<Response>;

  // Deno.serve is called at module top level, so stub it once during import,
  // capture the handler, and reuse it across this describe's tests.
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'relay-worker-'));
    const captured: Array<(req: Request) => Promise<Response>> = [];
    (globalThis as Record<string, unknown>).Deno = {
      serve: (fn: unknown) => captured.push(fn as (req: Request) => Promise<Response>),
    };
    try {
      await importEsm(DENO_RELAY_WORKER, join(dir, 'deno.mjs'));
    } finally {
      delete (globalThis as Record<string, unknown>).Deno;
    }
    expect(captured.length).toBe(1);
    handler = captured[0];
  }, HOOK_TIMEOUT);

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  }, HOOK_TIMEOUT);

  it('captures the Deno.serve handler and relays (400 + happy path)', async () => {
    expect((await handler(new Request('https://relay.example.com'))).status).toBe(400);
    fetchSpy.mockImplementation(async () => echoUpstream());
    const res = await handler(new Request('https://relay.example.com', {
      headers: { 'x-relay-target': 'https://generativelanguage.googleapis.com/', 'x-relay-path': '/v1beta/models' },
    }));
    expect(res.status).toBe(200);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models');
    expect(forwardedHeader(init.headers, 'x-relay-target')).toBeFalsy();
    expect(forwardedHeader(init.headers, 'x-relay-path')).toBeFalsy();
    expect(forwardedHeader(init.headers, 'host')).toBeFalsy();
    // Stamped so the proxy's breaker can tell upstream answers from platform failures.
    expect(forwardedHeader(res.headers, 'x-relay-proxied')).toBe('1');
  });

  it('returns 502 JSON when upstream throws', async () => {
    fetchSpy.mockImplementation(async () => { throw new Error('deno boom'); });
    const res = await handler(new Request('https://relay.example.com', {
      headers: { 'x-relay-target': 'https://api.anthropic.com' },
    }));
    expect(res.status).toBe(502);
    expect((await res.json() as { error: string }).error).toContain('deno boom');
  });
});

describe('netlify relay function (Lambda runtime)', () => {
  type LambdaResult = { statusCode: number; body: string; isBase64Encoded?: boolean; headers?: Record<string, string> };
  let handler: (event: unknown) => Promise<LambdaResult>;

  beforeAll(() => {
    const exportsRecord: Record<string, unknown> = {};
    // The function is CommonJS (exports.handler), eval'd exactly as Lambda would load it.
    new Function('exports', NETLIFY_RELAY_FUNCTION)(exportsRecord);
    handler = exportsRecord.handler as typeof handler;
  }, HOOK_TIMEOUT);

  it('400s without target (case-insensitive header lookup)', async () => {
    expect((await handler({ headers: {} })).statusCode).toBe(400);
    const res = await handler({ headers: { 'X-Relay-Target': '' }, httpMethod: 'GET' });
    expect(res.statusCode).toBe(400);
  });

  it('strips relay headers case-insensitively, buffers text responses', async () => {
    fetchSpy.mockImplementation(async () => echoUpstream());
    const res = await handler({
      headers: { 'X-Relay-Target': 'https://api.anthropic.com', 'X-Relay-Path': '/v1/messages', Host: 'relay.example.com', Authorization: 'Bearer abc' },
      httpMethod: 'POST',
      body: '{"x":1}',
      isBase64Encoded: false,
    });
    expect(res.statusCode).toBe(200);
    expect(res.isBase64Encoded).toBeFalsy();
    // Stamped so the proxy's breaker can tell upstream answers from platform failures.
    expect(res.headers?.['x-relay-proxied']).toBe('1');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(forwardedHeader(init.headers, 'x-relay-target')).toBeFalsy();
    expect(forwardedHeader(init.headers, 'X-Relay-Target')).toBeFalsy();
    expect(forwardedHeader(init.headers, 'host')).toBeFalsy();
    expect(forwardedHeader(init.headers, 'Host')).toBeFalsy();
    expect(forwardedHeader(init.headers, 'Authorization')).toBe('Bearer abc');
  });

  it('returns 502 JSON when upstream throws', async () => {
    fetchSpy.mockImplementation(async () => { throw new Error('lambda boom'); });
    const res = await handler({ headers: { 'x-relay-target': 'https://api.anthropic.com' }, httpMethod: 'GET' });
    expect(res.statusCode).toBe(502);
  });

  it('base64-encodes binary upstream responses (Lambda string-body path)', async () => {
    const pngMagic = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    fetchSpy.mockImplementation(async () => new Response(pngMagic, {
      status: 200, headers: { 'content-type': 'image/png' },
    }));
    const res = await handler({ headers: { 'x-relay-target': 'https://api.anthropic.com' }, httpMethod: 'GET' });
    expect(res.statusCode).toBe(200);
    expect(res.isBase64Encoded).toBe(true);
    expect(Buffer.from(res.body, 'base64').equals(Buffer.from(pngMagic))).toBe(true);
  });

  it('decodes isBase64Encoded request bodies before forwarding', async () => {
    fetchSpy.mockImplementation(async () => echoUpstream());
    const res = await handler({
      headers: { 'x-relay-target': 'https://api.anthropic.com', 'x-relay-path': '/v1/messages' },
      httpMethod: 'POST',
      body: Buffer.from('{"x":1}').toString('base64'),
      isBase64Encoded: true,
    });
    expect(res.statusCode).toBe(200);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(Buffer.from(init.body as Uint8Array).toString('utf8')).toBe('{"x":1}');
  });

  it('index HTML is the CCS-branded page pointing at the relay function', () => {
    expect(NETLIFY_INDEX_HTML).toContain('CCS Relay');
    expect(NETLIFY_INDEX_HTML).toContain('/.netlify/functions/relay');
    expect(NETLIFY_INDEX_HTML).not.toContain('9Router');
  });
});
