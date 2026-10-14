import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CLOUDFLARE_RELAY_WORKER, DENO_RELAY_WORKER, NETLIFY_RELAY_FUNCTION, VERCEL_RELAY_WORKER,
} from '../../../src/relay/worker-sources';

let fetchSpy: ReturnType<typeof spyOn>;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'relay-worker-'));
  fetchSpy = spyOn(globalThis, 'fetch');
});
afterEach(() => {
  fetchSpy.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

async function importEsm(source: string, file: string) {
  const path = join(dir, file);
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
  it('400s without x-relay-target', async () => {
    const mod = await importEsm(VERCEL_RELAY_WORKER, 'vercel.mjs');
    const res = await mod.default(new Request('https://relay.example.com/anything', { headers: {} }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Missing x-relay-target header' });
  });

  it('composes target+path, strips relay headers + host, passes auth + response through', async () => {
    const mod = await importEsm(VERCEL_RELAY_WORKER, 'vercel.mjs');
    fetchSpy.mockImplementation(async () => echoUpstream());
    const res = await mod.default(new Request('https://relay.example.com/anything', {
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
  });

  it('forwards POST bodies and returns 502 when upstream throws (CCS deviation)', async () => {
    const mod = await importEsm(VERCEL_RELAY_WORKER, 'vercel.mjs');
    fetchSpy.mockImplementation(async () => { throw new Error('boom'); });
    const res = await mod.default(new Request('https://relay.example.com', {
      method: 'POST',
      headers: { 'x-relay-target': 'https://api.anthropic.com', 'x-relay-path': '/v1/messages' },
      body: '{"x":1}',
    }));
    expect(res.status).toBe(502);
    expect((await res.json() as { error: string }).error).toContain('boom');
  });
});

describe('cloudflare relay worker', () => {
  it('400s without target', async () => {
    const mod = await importEsm(CLOUDFLARE_RELAY_WORKER, 'cf.mjs');
    const res = await mod.default.fetch(new Request('https://relay.example.com', { headers: {} }), {}, {});
    expect(res.status).toBe(400);
  });

  it('forwards POST bodies via streaming request body, strips relay headers', async () => {
    const mod = await importEsm(CLOUDFLARE_RELAY_WORKER, 'cf.mjs');
    fetchSpy.mockImplementation(async () => echoUpstream());
    const res = await mod.default.fetch(new Request('https://relay.example.com', {
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
  });

  it('returns 502 JSON when upstream throws', async () => {
    const mod = await importEsm(CLOUDFLARE_RELAY_WORKER, 'cf.mjs');
    fetchSpy.mockImplementation(async () => { throw new Error('cf boom'); });
    const res = await mod.default.fetch(new Request('https://relay.example.com', {
      headers: { 'x-relay-target': 'https://api.openai.com' },
    }), {}, {});
    expect(res.status).toBe(502);
  });
});

describe('deno relay worker', () => {
  /** Imports the Deno worker with a stubbed Deno.serve, returns the captured handler. */
  const loadDenoHandler = async (file: string) => {
    const captured: Array<(req: Request) => Promise<Response>> = [];
    (globalThis as Record<string, unknown>).Deno = { serve: (fn: never) => captured.push(fn) };
    try {
      await importEsm(DENO_RELAY_WORKER, file);
    } finally {
      delete (globalThis as Record<string, unknown>).Deno;
    }
    expect(captured.length).toBe(1);
    return captured[0];
  };

  it('captures the Deno.serve handler and relays (400 + happy path)', async () => {
    const handler = await loadDenoHandler('deno.mjs');
    expect((await handler(new Request('https://relay.example.com'))).status).toBe(400);
    fetchSpy.mockImplementation(async () => echoUpstream());
    const res = await handler(new Request('https://relay.example.com', {
      headers: { 'x-relay-target': 'https://generativelanguage.googleapis.com/', 'x-relay-path': '/v1beta/models' },
    }));
    expect(res.status).toBe(200);
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models');
  });

  it('returns 502 JSON when upstream throws', async () => {
    const handler = await loadDenoHandler('deno-502.mjs');
    fetchSpy.mockImplementation(async () => { throw new Error('deno boom'); });
    const res = await handler(new Request('https://relay.example.com', {
      headers: { 'x-relay-target': 'https://api.anthropic.com' },
    }));
    expect(res.status).toBe(502);
    expect((await res.json() as { error: string }).error).toContain('deno boom');
  });
});

describe('netlify relay function (Lambda runtime)', () => {
  const load = () => {
    const exportsRecord: Record<string, unknown> = {};
    // The function is CommonJS (exports.handler), eval'd exactly as Lambda would load it.
    new Function('exports', NETLIFY_RELAY_FUNCTION)(exportsRecord);
    return exportsRecord.handler as (event: unknown) => Promise<{ statusCode: number; body: string; isBase64Encoded?: boolean }>;
  };

  it('400s without target (case-insensitive header lookup)', async () => {
    const handler = load();
    expect((await handler({ headers: {} })).statusCode).toBe(400);
    const res = await handler({ headers: { 'X-Relay-Target': '' }, httpMethod: 'GET' });
    expect(res.statusCode).toBe(400);
  });

  it('strips relay headers case-insensitively, buffers text responses', async () => {
    const handler = load();
    fetchSpy.mockImplementation(async () => echoUpstream());
    const res = await handler({
      headers: { 'X-Relay-Target': 'https://api.anthropic.com', 'X-Relay-Path': '/v1/messages', Host: 'relay.example.com', Authorization: 'Bearer abc' },
      httpMethod: 'POST',
      body: '{"x":1}',
      isBase64Encoded: false,
    });
    expect(res.statusCode).toBe(200);
    expect(res.isBase64Encoded).toBeFalsy();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(forwardedHeader(init.headers, 'x-relay-target')).toBeFalsy();
    expect(forwardedHeader(init.headers, 'X-Relay-Target')).toBeFalsy();
    expect(forwardedHeader(init.headers, 'host')).toBeFalsy();
    expect(forwardedHeader(init.headers, 'Host')).toBeFalsy();
    expect(forwardedHeader(init.headers, 'Authorization')).toBe('Bearer abc');
  });

  it('returns 502 JSON when upstream throws', async () => {
    const handler = load();
    fetchSpy.mockImplementation(async () => { throw new Error('lambda boom'); });
    const res = await handler({ headers: { 'x-relay-target': 'https://api.anthropic.com' }, httpMethod: 'GET' });
    expect(res.statusCode).toBe(502);
  });
});
