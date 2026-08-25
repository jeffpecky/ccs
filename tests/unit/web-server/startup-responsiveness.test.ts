/**
 * Startup responsiveness contract (plan Task 3: Remove Startup Event-Loop Blocking)
 *
 * The detached Bar launcher probes authenticated health right after spawn, so
 * startServer() must:
 *
 * 1. Resolve listen BEFORE any background initialization runs.
 * 2. Keep answering /api/bar/health while that background init is unresolved.
 * 3. Survive background init failures (sync throw or async rejection) without
 *    taking the server down.
 * 4. Bound concurrent health latency even while background init is pending.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { startServer } from '../../../src/web-server';
import {
  BAR_AUTH_NONCE_HEADER,
  BAR_AUTH_TOKEN_HEADER,
  createBarAuthProof,
  getOrCreateBarAuthToken,
} from '../../../src/utils/bar-auth-token';

const instances: Awaited<ReturnType<typeof startServer>>[] = [];
let tempHome = '';
let originalCcsHome: string | undefined;

function neverResolving(): Promise<void> {
  return new Promise(() => {});
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function barProofHeaders(method: string, requestPath: string): Record<string, string> {
  const nonce = '0123456789abcdef0123456789abcdef';
  return {
    [BAR_AUTH_NONCE_HEADER]: nonce,
    [BAR_AUTH_TOKEN_HEADER]: createBarAuthProof(
      getOrCreateBarAuthToken(),
      'request',
      method,
      requestPath,
      nonce
    ),
  };
}

async function fetchHealth(baseUrl: string): Promise<Response> {
  return fetch(`${baseUrl}/api/bar/health`, {
    headers: barProofHeaders('GET', '/api/bar/health'),
  });
}

describe('startServer background initialization', () => {
  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-startup-responsiveness-'));
    originalCcsHome = process.env.CCS_HOME;
    process.env.CCS_HOME = tempHome;
  });

  afterEach(async () => {
    while (instances.length > 0) {
      const instance = instances.pop();
      if (!instance) continue;
      instance.cleanup();
      await new Promise<void>((resolve) => instance.server.close(() => resolve()));
    }

    if (originalCcsHome === undefined) delete process.env.CCS_HOME;
    else process.env.CCS_HOME = originalCcsHome;

    fs.rmSync(tempHome, { recursive: true, force: true });
    tempHome = '';
  });

  it('answers authenticated health while injected background initialization is unresolved', async () => {
    const instance = await startServer({
      port: 0,
      host: '127.0.0.1',
      backgroundServices: {
        startAutoSyncWatcher: () => neverResolving(),
        initUsageAggregator: () => neverResolving(),
      },
    });
    instances.push(instance);

    const address = instance.server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const startedAt = Date.now();
    const response = await Promise.race([
      fetchHealth(baseUrl),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 2000)),
    ]);

    expect(response).not.toBe('timeout');
    if (response === 'timeout') return;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  it('defers watcher and usage aggregator init until after listen resolves', async () => {
    const calls: string[] = [];

    const instance = await startServer({
      port: 0,
      host: '127.0.0.1',
      backgroundServices: {
        startAutoSyncWatcher: () => {
          calls.push('watcher');
        },
        initUsageAggregator: () => {
          calls.push('usage');
        },
      },
    });
    instances.push(instance);

    // Background services must NOT run synchronously inside startServer().
    expect(calls).toEqual([]);

    // They are scheduled on the next event-loop turn after listening.
    await nextTick();
    expect(calls).toEqual(['watcher', 'usage']);
  });

  it('keeps serving health when background init throws or rejects', async () => {
    const instance = await startServer({
      port: 0,
      host: '127.0.0.1',
      backgroundServices: {
        startAutoSyncWatcher: () => {
          throw new Error('watcher boom');
        },
        initUsageAggregator: () => Promise.reject(new Error('usage boom')),
      },
    });
    instances.push(instance);

    await nextTick();

    const address = instance.server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const response = await Promise.race([
      fetchHealth(baseUrl),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 2000)),
    ]);
    expect(response).not.toBe('timeout');
    if (response === 'timeout') return;
    expect(response.status).toBe(200);
  });

  it('bounds concurrent health latency while background init is unresolved', async () => {
    const instance = await startServer({
      port: 0,
      host: '127.0.0.1',
      backgroundServices: {
        startAutoSyncWatcher: () => neverResolving(),
        initUsageAggregator: () => neverResolving(),
      },
    });
    instances.push(instance);

    const address = instance.server.address();
    if (!address || typeof address === 'string') throw new Error('missing address');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const startedAt = Date.now();
    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        Promise.race([
          fetchHealth(baseUrl),
          new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 2500)),
        ])
      )
    );
    const elapsedMs = Date.now() - startedAt;

    expect(responses.every((r) => r !== 'timeout')).toBe(true);
    for (const response of responses) {
      if (response === 'timeout') continue;
      expect(response.status).toBe(200);
    }
    expect(elapsedMs).toBeLessThan(1500);
  });
});
