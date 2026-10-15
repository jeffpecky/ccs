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

function patch(baseUrl: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
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
    expect(await response.json()).toEqual(DEFAULT_RELAY_CONFIG);
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

  it('deploys, persists, and activates the relay entry without ever storing the token', async () => {
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
    const body = (await response.json()) as { relay: RelayEntry; activated: boolean };
    expect(body.relay.platform).toBe('vercel');
    expect(body.relay.url).toBe('https://vercel-relay.example.test');
    expect(body.relay.name).toBe('my-relay');
    expect(body.relay.testStatus).toBe('untested');
    // Deploy activates immediately: the entry is appended and marked active
    // under the lock, then the runtime config is regenerated.
    expect(body.activated).toBe(true);
    expect(app.saved).toHaveLength(1);
    expect(app.saved[0].relays).toHaveLength(1);
    expect(app.saved[0].activeId).toBe(body.relay.id);
    expect(app.order).toEqual(['update', 'regenerate']);
    expect(app.regenerations()).toBe(1);
    expect(app.currentConfig().activeId).toBe(body.relay.id);
    expect(JSON.stringify(app.saved)).not.toContain('SECRET');
    expect(JSON.stringify(body)).not.toContain('SECRET');
  });

  it('keeps the deployed entry but reverts activation when regeneration fails', async () => {
    const app = await setup({
      regenerate: () => {
        throw new Error('generation failed');
      },
    });
    const response = await post(app.baseUrl, '/deploy', { platform: 'vercel', token: 't' });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      relay: RelayEntry;
      activated: boolean;
      activationError: string;
    };
    expect(body.activated).toBe(false);
    expect(body.activationError).toBe('generation failed');
    // The remote worker exists, so the entry survives; only the activation
    // pointer reverts (regenerate failed, so config.yaml was never written).
    expect(app.currentConfig().relays.map((entry) => entry.id)).toEqual([body.relay.id]);
    expect(app.currentConfig().activeId).toBeNull();
    expect(app.regenerations()).toBe(1);
  });

  it('replaces the previously active relay when deploying a new one', async () => {
    const app = await setup({ config: { relays: [makeRelay('r1')], activeId: 'r1' } });
    const response = await post(app.baseUrl, '/deploy', { platform: 'vercel', token: 't' });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { relay: RelayEntry; activated: boolean };
    expect(body.activated).toBe(true);
    expect(app.currentConfig().activeId).toBe(body.relay.id);
    expect(app.currentConfig().relays.map((entry) => entry.id)).toEqual(['r1', body.relay.id]);
  });

  it('responds 500 instead of hanging when the config read fails during deploy', async () => {
    const app = await setup({
      getConfig: () => {
        throw new Error('broken config.yaml');
      },
    });
    const response = await post(app.baseUrl, '/deploy', { platform: 'vercel', token: 't' });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'broken config.yaml' });
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
      // Deleting also drops the pins map the handler now always writes.
      config: { relays: [], activeId: null, providerRelayIds: {} },
    });
    expect(app.regenerations()).toBe(1);
    expect(app.order).toEqual(['save', 'regenerate']);
    expect(app.currentConfig()).toEqual({ relays: [], activeId: null, providerRelayIds: {} });
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
      config: { relays: [makeRelay('r1')], activeId: 'r1', providerRelayIds: {} },
    });
    expect(app.regenerations()).toBe(0);
    expect(app.order).toEqual(['save']);
    expect(app.currentConfig()).toEqual({
      relays: [makeRelay('r1')],
      activeId: 'r1',
      providerRelayIds: {},
    });
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

  describe('rotation settings', () => {
    it('persists strategy and strict, then regenerates once', async () => {
      const app = await setup({ config: { relays: [makeRelay('r1')], activeId: 'r1' } });
      const response = await patch(app.baseUrl, '', { strategy: 'round-robin', strict: true });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { success: boolean; config: RelayConfig };
      expect(body.success).toBe(true);
      expect(body.config.strategy).toBe('round-robin');
      expect(body.config.strict).toBe(true);
      // Both keys reach config.yaml, so exactly one regeneration follows the save.
      expect(app.order).toEqual(['save', 'regenerate']);
      expect(app.currentConfig().strategy).toBe('round-robin');
      expect(app.currentConfig().strict).toBe(true);
    });

    it('rejects an unknown strategy without writing anything', async () => {
      const app = await setup({ config: { relays: [makeRelay('r1')], activeId: 'r1' } });
      const response = await patch(app.baseUrl, '', { strategy: 'fastest' });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        errors: ['strategy must be one of: none, round-robin, random'],
      });
      expect(app.order).toEqual([]);
    });

    it('rejects an update that carries no settings', async () => {
      const app = await setup();
      const response = await patch(app.baseUrl, '', {});
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ errors: ['no relay settings provided'] });
      expect(app.order).toEqual([]);
    });

    it('404s when the preferred relay does not exist', async () => {
      const app = await setup({ config: { relays: [makeRelay('r1')], activeId: 'r1' } });
      const response = await patch(app.baseUrl, '', { activeId: 'ghost' });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Relay not found' });
      expect(app.order).toEqual([]);
    });

    it('400s when a provider pin references an unknown relay', async () => {
      const app = await setup({ config: { relays: [makeRelay('r1')], activeId: 'r1' } });
      const response = await patch(app.baseUrl, '', { providerRelayIds: { claude: 'ghost' } });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: 'providerRelayIds references unknown relays for: claude',
      });
      expect(app.order).toEqual([]);
    });

    it('reverts the saved config when regeneration fails', async () => {
      const previous = { relays: [makeRelay('r1')], activeId: 'r1' };
      const app = await setup({
        config: previous,
        regenerate: () => {
          throw new Error('generation failed');
        },
      });
      const response = await patch(app.baseUrl, '', { strategy: 'random' });
      expect(response.status).toBe(500);
      // The unified config is rolled back so the dashboard cannot show a
      // rotation setting the proxy never received.
      expect(app.currentConfig().strategy).toBeUndefined();
      expect(app.currentConfig().relays).toEqual(previous.relays);
    });
  });

  describe('health sweep', () => {
    it('probes every relay, records the results, and pushes the new pool', async () => {
      const app = await setup({
        config: { relays: [makeRelay('r1'), makeRelay('r2')], activeId: 'r1' },
        test: async (url) =>
          url.includes('r1')
            ? { ok: true, status: 200, elapsedMs: 1 }
            : { ok: false, status: 502, error: 'dead', elapsedMs: 2 },
      });

      const response = await post(app.baseUrl, '/test-all', {});
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        results: Array<{ id: string; ok: boolean }>;
        healthChanged: boolean;
      };
      expect(body.results.map((entry) => entry.id)).toEqual(['r1', 'r2']);
      expect(body.healthChanged).toBe(true);

      const relays = app.currentConfig().relays;
      expect(relays.find((entry) => entry.id === 'r1')?.testStatus).toBe('ok');
      expect(relays.find((entry) => entry.id === 'r2')?.testStatus).toBe('fail');
      expect(relays.find((entry) => entry.id === 'r2')?.lastError).toBe('dead');
      // Membership changed, so the pool written to config.yaml has to follow.
      expect(app.regenerations()).toBe(1);
    });

    it('does not regenerate when every status is unchanged', async () => {
      const app = await setup({
        config: { relays: [{ ...makeRelay('r1'), testStatus: 'ok' }], activeId: 'r1' },
        test: async () => ({ ok: true, status: 200, elapsedMs: 1 }),
      });

      const response = await post(app.baseUrl, '/test-all', {});
      expect(response.status).toBe(200);
      expect(((await response.json()) as { healthChanged: boolean }).healthChanged).toBe(false);
      expect(app.regenerations()).toBe(0);
      expect(app.order).toEqual(['update']);
    });

    it('answers an empty sweep without touching the config', async () => {
      const app = await setup();
      const response = await post(app.baseUrl, '/test-all', {});
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ results: [], healthChanged: false });
      expect(app.order).toEqual([]);
    });
  });
});
