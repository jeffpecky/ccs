import { afterEach, describe, expect, it } from 'bun:test';
import express from 'express';
import * as http from 'http';
import type { AddressInfo } from 'net';

import { DEFAULT_RELAY_CONFIG } from '../../../src/config/schemas/relay';
import type { RelayConfig, RelayEntry } from '../../../src/config/schemas/relay';
import { DeployError } from '../../../src/relay/deploy';
import { createRelayRouter } from '../../../src/web-server/routes/relay-routes';
import type { RelayRouterDeps } from '../../../src/web-server/routes/relay-routes';

const servers: http.Server[] = [];

async function listen(server: http.Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function makeRelay(id: string): RelayEntry {
  return {
    id,
    name: id,
    platform: 'vercel',
    url: `https://${id}.example.test`,
    createdAt: '2026-01-01T00:00:00.000Z',
    testStatus: 'untested',
  };
}

async function setup(
  options: {
    config?: RelayConfig;
    access?: boolean;
    getConfig?: () => RelayConfig;
    deploy?: RelayRouterDeps['deployRelay'];
    test?: RelayRouterDeps['testRelay'];
    regenerate?: () => void;
    throwOnUpdate?: boolean;
  } = {}
) {
  let config: RelayConfig = options.config ?? structuredClone(DEFAULT_RELAY_CONFIG);
  const saved: RelayConfig[] = [];
  const order: string[] = [];
  let regenerations = 0;
  const app = express();
  app.use(express.json());
  app.use(
    '/api/relay',
    createRelayRouter({
      enforceAccess: (_req, res) => {
        if (options.access === false) {
          res.status(403).json({ error: 'blocked' });
          return false;
        }
        return true;
      },
      getRelayConfig: options.getConfig ?? (() => structuredClone(config)),
      saveRelayConfig: (next) => {
        order.push('save');
        saved.push(structuredClone(next));
        config = next;
      },
      updateRelayConfig: (update) => {
        if (options.throwOnUpdate) {
          throw new Error('update failed');
        }
        order.push('update');
        config = update(config);
        saved.push(structuredClone(config));
      },
      regenerateConfig: () => {
        order.push('regenerate');
        regenerations += 1;
        options.regenerate?.();
      },
      deployRelay:
        options.deploy ??
        (async () => ({ url: 'https://deployed.example.test', name: 'deployed-relay' })),
      testRelay: options.test ?? (async () => ({ ok: true, status: 200, elapsedMs: 7 })),
    })
  );
  const port = await listen(http.createServer(app));
  return {
    baseUrl: `http://127.0.0.1:${port}/api/relay`,
    saved,
    order,
    regenerations: () => regenerations,
    currentConfig: () => config,
    // Simulates a concurrent config writer (another request's deploy/activate)
    // landing between the handler's own reads and writes.
    mutate: (fn: (cfg: RelayConfig) => void) => {
      fn(config);
    },
  };
}

function post(baseUrl: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Relay routes', () => {
  it('enforces the localhost access gate', async () => {
    const app = await setup({ access: false });
    expect((await fetch(app.baseUrl)).status).toBe(403);
    expect((await post(app.baseUrl, '/deploy', { platform: 'vercel', token: 't' })).status).toBe(
      403
    );
  });

  it('serves the pristine relay config', async () => {
    const app = await setup();
    const response = await fetch(app.baseUrl);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ relays: [], activeId: null });
  });

  it('validates deploy inputs before calling the platform client', async () => {
    let deployCalls = 0;
    const app = await setup({
      deploy: async () => {
        deployCalls += 1;
        return { url: 'https://x.example.test', name: 'x' };
      },
    });
    const invalidBodies = [
      { platform: 'spaceship', token: 't' },
      { platform: 'vercel', token: '   ' },
      { platform: 'cloudflare', token: 't' }, // missing accountId
      { platform: 'deno', token: 't' }, // missing orgDomain
      { platform: 'vercel', token: 't', name: 'evil/name' },
      { platform: 'cloudflare', token: 't', accountId: 'acc!ount' },
      { platform: 'deno', token: 't', orgDomain: 'evil!domain' },
    ];
    for (const body of invalidBodies) {
      expect((await post(app.baseUrl, '/deploy', body)).status).toBe(400);
    }
    expect(deployCalls).toBe(0);
    expect(app.saved).toHaveLength(0);
  });

  it('deploys and persists the relay entry without ever storing the token', async () => {
    const app = await setup({
      deploy: async (input) => ({
        url: 'https://vercel-relay.example.test',
        name: input.name ?? 'generated-relay',
      }),
    });
    const response = await post(app.baseUrl, '/deploy', {
      platform: 'vercel',
      token: 'SECRET-TOKEN-VALUE',
      name: 'my-relay',
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { relay: RelayEntry };
    expect(body.relay.platform).toBe('vercel');
    expect(body.relay.url).toBe('https://vercel-relay.example.test');
    expect(body.relay.name).toBe('my-relay');
    expect(body.relay.testStatus).toBe('untested');
    expect(app.saved).toHaveLength(1);
    expect(app.saved[0].relays).toHaveLength(1);
    // Deploying only appends the entry (locked read-modify-write update);
    // the runtime config is regenerated on activate, not here.
    expect(app.order).toEqual(['update']);
    expect(JSON.stringify(app.saved)).not.toContain('SECRET');
    expect(JSON.stringify(body)).not.toContain('SECRET');
  });

  it('maps DeployError to its upstream status', async () => {
    const app = await setup({
      deploy: async () => {
        throw new DeployError('site name taken', 409);
      },
    });
    const response = await post(app.baseUrl, '/deploy', { platform: 'netlify', token: 't' });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'site name taken' });
  });

  it('maps unexpected deploy failures to 500 without persisting anything', async () => {
    const app = await setup({
      deploy: async () => {
        throw new Error('network down');
      },
    });
    const response = await post(app.baseUrl, '/deploy', { platform: 'vercel', token: 't' });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'network down' });
    expect(app.saved).toHaveLength(0);
  });

  it('rejects connectivity tests for unknown relays', async () => {
    const app = await setup({ config: { relays: [makeRelay('r1')], activeId: null } });
    expect((await post(app.baseUrl, '/missing/test', {})).status).toBe(404);
  });

  it('records failing connectivity tests on the entry', async () => {
    const app = await setup({
      config: { relays: [makeRelay('r1')], activeId: null },
      test: async () => ({ ok: false, status: 502, error: 'upstream exploded', elapsedMs: 12 }),
    });
    const response = await post(app.baseUrl, '/r1/test', {});
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; status: number; testedAt: string };
    expect(body.ok).toBe(false);
    expect(body.status).toBe(502);
    expect(typeof body.testedAt).toBe('string');
    const saved = app.saved[app.saved.length - 1].relays[0];
    expect(saved.testStatus).toBe('fail');
    expect(saved.lastError).toBe('upstream exploded');
    expect(saved.lastTestedAt).toBe(body.testedAt);
  });

  it('falls back to a status message when the probe reports no error', async () => {
    const app = await setup({
      config: { relays: [makeRelay('r1')], activeId: null },
      test: async () => ({ ok: false, status: 503, elapsedMs: 3 }),
    });
    expect((await post(app.baseUrl, '/r1/test', {})).status).toBe(200);
    const saved = app.saved[app.saved.length - 1].relays[0];
    expect(saved.testStatus).toBe('fail');
    expect(saved.lastError).toBe('Relay test failed with status 503');
  });

  it('records passing connectivity tests on the entry', async () => {
    const app = await setup({
      config: { relays: [makeRelay('r1')], activeId: null },
      test: async () => ({ ok: true, status: 200, elapsedMs: 8 }),
    });
    const response = await post(app.baseUrl, '/r1/test', {});
    expect(response.status).toBe(200);
    expect(((await response.json()) as { ok: boolean }).ok).toBe(true);
    const saved = app.saved[app.saved.length - 1].relays[0];
    expect(saved.testStatus).toBe('ok');
    expect(saved.lastError).toBeNull();
  });

  it('preserves concurrent config changes made while the probe is in flight', async () => {
    let app: Awaited<ReturnType<typeof setup>> | undefined;
    app = await setup({
      config: { relays: [makeRelay('r1')], activeId: null },
      test: async () => {
        // A concurrent writer (e.g. another deploy) lands mid-probe; the
        // probe result must not clobber it with a stale snapshot.
        app!.mutate((cfg) => {
          cfg.relays.push(makeRelay('injected'));
        });
        return { ok: true, status: 200, elapsedMs: 5 };
      },
    });
    const response = await post(app.baseUrl, '/r1/test', {});
    expect(response.status).toBe(200);
    const relays = app.currentConfig().relays;
    expect(relays.map((entry) => entry.id).sort()).toEqual(['injected', 'r1']);
    expect(relays.find((entry) => entry.id === 'r1')?.testStatus).toBe('ok');
    expect(relays.find((entry) => entry.id === 'injected')?.testStatus).toBe('untested');
  });

  it('does not resurrect a relay deleted while the probe is in flight', async () => {
    let app: Awaited<ReturnType<typeof setup>> | undefined;
    app = await setup({
      config: { relays: [makeRelay('r1')], activeId: null },
      test: async () => {
        app!.mutate((cfg) => {
          cfg.relays = cfg.relays.filter((entry) => entry.id !== 'r1');
        });
        return { ok: true, status: 200, elapsedMs: 5 };
      },
    });
    const response = await post(app.baseUrl, '/r1/test', {});
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Relay not found' });
    expect(app.currentConfig().relays).toHaveLength(0);
  });

  it('responds 500 when the probe result cannot be persisted', async () => {
    const app = await setup({
      config: { relays: [makeRelay('r1')], activeId: null },
      throwOnUpdate: true,
    });
    const response = await post(app.baseUrl, '/r1/test', {});
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to test relay' });
  });

  it('rejects activation of unknown relays', async () => {
    const app = await setup({ config: { relays: [makeRelay('r1')], activeId: null } });
    expect((await post(app.baseUrl, '/missing/activate', {})).status).toBe(404);
  });

  it('saves the new active relay before regenerating the runtime config', async () => {
    const app = await setup({ config: { relays: [makeRelay('r1')], activeId: null } });
    const response = await post(app.baseUrl, '/r1/activate', {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      config: { relays: [makeRelay('r1')], activeId: 'r1' },
    });
    expect(app.regenerations()).toBe(1);
    expect(app.order).toEqual(['save', 'regenerate']);
    expect(app.currentConfig().activeId).toBe('r1');
  });

  it('reverts the unified config when activation regeneration fails', async () => {
    const app = await setup({
      config: { relays: [makeRelay('r1')], activeId: null },
      regenerate: () => {
        throw new Error('generation failed');
      },
    });
    const response = await post(app.baseUrl, '/r1/activate', {});
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Failed to activate relay: generation failed',
    });
    // The final save reverts to the previous config (no active relay).
    expect(app.currentConfig()).toEqual({ relays: [makeRelay('r1')], activeId: null });
    expect(app.saved[app.saved.length - 1].activeId).toBeNull();
  });

  it('responds 500 instead of hanging when the config read fails during activation', async () => {
    const app = await setup({
      getConfig: () => {
        throw new Error('broken config.yaml');
      },
    });
    const response = await post(app.baseUrl, '/r1/activate', {});
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Failed to activate relay: broken config.yaml',
    });
  });

  it('rejects deletion of unknown relays', async () => {
    const app = await setup({ config: { relays: [makeRelay('r1')], activeId: 'r1' } });
    expect((await fetch(`${app.baseUrl}/missing`, { method: 'DELETE' })).status).toBe(404);
  });

  it('clears the active relay and regenerates exactly once', async () => {
    const app = await setup({ config: { relays: [makeRelay('r1')], activeId: 'r1' } });
    const response = await fetch(`${app.baseUrl}/r1`, { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      config: { relays: [], activeId: null },
    });
    expect(app.regenerations()).toBe(1);
    expect(app.order).toEqual(['save', 'regenerate']);
    expect(app.currentConfig()).toEqual({ relays: [], activeId: null });
  });

  it('reverts the unified config when active-relay deletion fails to regenerate', async () => {
    const previous = { relays: [makeRelay('r1')], activeId: 'r1' };
    const app = await setup({
      config: previous,
      regenerate: () => {
        throw new Error('generation failed');
      },
    });
    const response = await fetch(`${app.baseUrl}/r1`, { method: 'DELETE' });
    expect(response.status).toBe(500);
    expect(app.currentConfig()).toEqual(previous);
  });

  it('removes inactive relays without touching the runtime config', async () => {
    const app = await setup({
      config: { relays: [makeRelay('r1'), makeRelay('r2')], activeId: 'r1' },
    });
    const response = await fetch(`${app.baseUrl}/r2`, { method: 'DELETE' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      config: { relays: [makeRelay('r1')], activeId: 'r1' },
    });
    expect(app.regenerations()).toBe(0);
    expect(app.order).toEqual(['save']);
    expect(app.currentConfig()).toEqual({ relays: [makeRelay('r1')], activeId: 'r1' });
  });

  it('responds 500 instead of hanging when the config read fails during deletion', async () => {
    const app = await setup({
      getConfig: () => {
        throw new Error('broken config.yaml');
      },
    });
    const response = await fetch(`${app.baseUrl}/r1`, { method: 'DELETE' });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Failed to delete relay: broken config.yaml',
    });
  });
});
