// tests/unit/relay/local-e2e.test.ts
// Boots a real echo "provider" server (node:http, ephemeral loopback port), writes the
// REAL Vercel worker source (VERCEL_RELAY_WORKER) to a temp .mjs, imports it, and drives
// its default-export handler with a genuine 2-header request — proving the DEPLOYED
// ARTIFACT round-trips a real HTTP exchange end to end (real fetch, real upstream,
// loopback only, no platform tokens, no real network).
//
// Note: unlike worker-sources.test.ts (which mocks fetch), this test intentionally uses
// the worker's own fetch against a local upstream, so no fetch spy exists here.
import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { VERCEL_RELAY_WORKER } from '../../../src/relay/worker-sources';

/** Hook timeout: matches worker-sources.test.ts — keeps machine-load stalls from tripping bun's default. */
const HOOK_TIMEOUT = 30_000;

const servers: Server[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => {
    s.closeAllConnections();
    return new Promise<void>((r) => s.close(() => r()));
  }));
}, HOOK_TIMEOUT);

afterAll(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Cleanup must never mask a test failure.
    }
  }
}, HOOK_TIMEOUT);

describe('relay local e2e', () => {
  it('worker → local upstream echo over real HTTP, relay headers stripped, body round-trips', async () => {
    // Upstream echo "provider": records headers, echoes body + path, answers 201.
    let seenHeaders: Record<string, string | string[] | undefined> = {};
    const upstream = createServer((req, res) => {
      seenHeaders = req.headers;
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ echoed: body, path: req.url }));
      });
    });
    servers.push(upstream);
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    const upstreamPort = (upstream.address() as AddressInfo).port;

    // Run the real deployed worker artifact against the local upstream.
    const dir = mkdtempSync(join(tmpdir(), 'relay-e2e-'));
    tempDirs.push(dir);
    const file = join(dir, 'worker.mjs');
    writeFileSync(file, VERCEL_RELAY_WORKER, 'utf8');
    const mod = await import(pathToFileURL(file).href);

    const res = await mod.default(new Request('https://unused', {
      method: 'POST',
      headers: {
        'x-relay-target': `http://127.0.0.1:${upstreamPort}`,
        'x-relay-path': '/v1/messages?beta=true',
        'content-type': 'application/json',
        authorization: 'Bearer secret',
      },
      body: '{"prompt":"hi"}',
    }));

    expect(res.status).toBe(201);
    const payload = await res.json() as { echoed: string; path: string };
    expect(payload.echoed).toBe('{"prompt":"hi"}');
    expect(payload.path).toBe('/v1/messages?beta=true');
    // The worker must strip the relay headers before egress and keep auth intact.
    expect(seenHeaders['x-relay-target']).toBeUndefined();
    expect(seenHeaders['x-relay-path']).toBeUndefined();
    expect(seenHeaders.authorization).toBe('Bearer secret');
  }, HOOK_TIMEOUT);
});
