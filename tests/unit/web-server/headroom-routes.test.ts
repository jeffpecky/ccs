import { afterEach, describe, expect, it } from 'bun:test';
import express from 'express';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { load } from 'js-yaml';
import { regenerateConfigWithRollback } from '../../../src/cliproxy/config/generator';
import { createHeadroomRouter } from '../../../src/web-server/routes/headroom-routes';

const servers: http.Server[] = [];
const TOKEN_ENV = 'HEADROOM_PROXY_TOKEN';
const baseConfig = {
  enabled: true,
  rtk: true,
  caveman: { enabled: false, level: 'standard' },
  ponytail: { enabled: false, level: 'standard' },
  headroom: {
    enabled: true,
    url: 'http://127.0.0.1:8787',
    mode: 'local' as const,
    timeout_ms: 200,
    compress_user_messages: false,
    token_env: TOKEN_ENV,
    code_aware: false,
    kompress: true,
  },
  pxpipe: { enabled: false, min_chars: 25000, timeout_ms: 15000 },
};

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

describe('Headroom fixed-purpose routes', () => {
  async function setup(
    options: {
      config?: any;
      access?: boolean;
      regenerate?: (config: any) => void | (() => void) | Promise<void | (() => void)>;
      save?: (config: any) => void | Promise<void>;
    } = {}
  ) {
    let config = options.config ?? structuredClone(baseConfig);
    let persisted: any;
    const statusCalls: string[] = [];
    const app = express();
    app.use(express.json());
    app.use(
      '/api/headroom',
      createHeadroomRouter({
        enforceAccess: (_req, res) => {
          if (options.access === false) {
            res.status(403).json({ error: 'blocked' });
            return false;
          }
          return true;
        },
        getTokenSaverConfig: () => config,
        saveTokenSaverConfig:
          options.save ??
          ((next) => {
            persisted = next;
            config = next;
          }),
        regenerateConfig: options.regenerate ?? (() => undefined),
        getStatus: async (url) => {
          statusCalls.push(url);
          return { running: false, healthy: false };
        },
        start: async () => ({ success: true }),
        stop: async () => ({ success: true }),
        restart: async () => ({ success: true }),
      })
    );
    const port = await listen(http.createServer(app));
    return {
      baseUrl: `http://127.0.0.1:${port}/api/headroom`,
      persisted: () => persisted,
      statusCalls,
    };
  }

  it('enforces access and exposes no generic proxy route', async () => {
    const blocked = await setup({ access: false });
    expect((await fetch(`${blocked.baseUrl}/config`)).status).toBe(403);
    const app = await setup();
    expect((await fetch(`${app.baseUrl}/proxy/dashboard`)).status).toBe(404);
    expect((await fetch(`${app.baseUrl}/proxy/anything`, { method: 'POST' })).status).toBe(404);
  });

  it('status invokes one fixed health operation against configured base', async () => {
    const config = structuredClone(baseConfig);
    const app = await setup({ config });
    expect((await fetch(`${app.baseUrl}/status`)).status).toBe(200);
    expect(app.statusCalls).toEqual(['http://127.0.0.1:8787']);
  });

  it('does not call status service for invalid imported local URL', async () => {
    const config = structuredClone(baseConfig);
    config.headroom.url = 'https://attacker.example.test/base';
    const app = await setup({ config });
    const response = await fetch(`${app.baseUrl}/status`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      configured: true,
      external: false,
      local: true,
      managed: false,
      running: false,
      healthy: false,
      health: 'invalid-config',
      error: 'Invalid local Headroom URL.',
    });
    expect(app.statusCalls).toEqual([]);
  });

  it('does not probe or forward token for external status', async () => {
    const config = structuredClone(baseConfig);
    config.headroom.mode = 'external';
    config.headroom.url = 'https://headroom.example.test/base';
    const app = await setup({ config });
    const response = await fetch(`${app.baseUrl}/status`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      configured: true,
      external: true,
      local: false,
      managed: false,
      running: false,
      healthy: null,
      health: 'unknown',
    });
    expect(app.statusCalls).toEqual([]);
  });

  it('pins token environment and rejects arbitrary selectors', async () => {
    const app = await setup();
    const attack = structuredClone(baseConfig);
    attack.headroom.token_env = 'ATTACKER_TOKEN';
    expect((await put(app.baseUrl, attack)).status).toBe(400);
    expect(app.persisted()).toBeUndefined();

    const omitted = structuredClone(baseConfig) as any;
    delete omitted.headroom.token_env;
    expect((await put(app.baseUrl, omitted)).status).toBe(200);
    expect(app.persisted().headroom.token_env).toBe(TOKEN_ENV);
  });

  it('allows trusted external base paths but rejects unsafe URL components', async () => {
    const app = await setup();
    const valid = structuredClone(baseConfig);
    valid.headroom.mode = 'external';
    valid.headroom.url = 'https://headroom.example.test/docker/headroom';
    expect((await put(app.baseUrl, valid)).status).toBe(200);
    for (const url of [
      'file:///tmp/headroom',
      'https://user:pass@headroom.test/base',
      'https://headroom.test/base?x=1',
      'https://headroom.test/base#x',
    ]) {
      valid.headroom.url = url;
      expect((await put(app.baseUrl, valid)).status).toBe(400);
    }
  });

  it('rejects null and unsafe numeric values', async () => {
    const app = await setup();
    expect((await put(app.baseUrl, null)).status).toBe(400);
    for (const config of [
      {
        ...structuredClone(baseConfig),
        headroom: { ...baseConfig.headroom, timeout_ms: Number.MAX_SAFE_INTEGER + 1 },
      },
      {
        ...structuredClone(baseConfig),
        pxpipe: { ...baseConfig.pxpipe, min_chars: Number.MAX_SAFE_INTEGER + 1 },
      },
      { ...structuredClone(baseConfig), pxpipe: { ...baseConfig.pxpipe, timeout_ms: 99.5 } },
    ]) {
      expect((await put(app.baseUrl, config)).status).toBe(400);
    }
  });

  it('does not persist when prospective runtime generation fails', async () => {
    const app = await setup({
      regenerate: () => {
        throw new Error('generation failed');
      },
    });
    expect((await put(app.baseUrl, { ...baseConfig, rtk: false })).status).toBe(500);
    expect(app.persisted()).toBeUndefined();
  });

  it('PUT generates prospective runtime YAML before unified persistence', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-headroom-put-'));
    const runtimePath = path.join(dir, 'runtime.yaml');
    let observed: any;
    try {
      const app = await setup({
        regenerate: (next) =>
          regenerateConfigWithRollback(8317, {
            configPath: runtimePath,
            authDir: path.join(dir, 'auth'),
            tokenSaver: next,
          }),
        save: () => {
          observed = load(fs.readFileSync(runtimePath, 'utf8'));
        },
      });
      const next = structuredClone(baseConfig);
      next.rtk = false;
      next.headroom.url = 'https://prospective-put.example.test/base';
      next.headroom.mode = 'external';
      expect((await put(app.baseUrl, next)).status).toBe(200);
      expect(observed['token-saver'].rtk).toBe(false);
      expect(observed['token-saver'].headroom.url).toBe(
        'https://prospective-put.example.test/base'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rolls runtime back when unified config persistence fails', async () => {
    const events: string[] = [];
    const app = await setup({
      regenerate: (next) => {
        events.push(`runtime:${next.rtk}`);
        return () => events.push('runtime:rollback');
      },
      save: () => {
        events.push('unified:save');
        throw new Error('save failed');
      },
    });
    const response = await put(app.baseUrl, { ...baseConfig, rtk: false });
    expect(response.status).toBe(500);
    expect(events).toEqual(['runtime:false', 'unified:save', 'runtime:rollback']);
  });

  it('reports explicit partial failure when runtime rollback fails', async () => {
    const app = await setup({
      regenerate: () => () => {
        throw new Error('rollback failed');
      },
      save: () => {
        throw new Error('save failed');
      },
    });
    const response = await put(app.baseUrl, { ...baseConfig, rtk: false });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Partial configuration failure: unified config save and runtime rollback failed.',
    });
  });

  it('serializes concurrent PUT transactions across router instances', async () => {
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let allowFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      allowFirst = resolve;
    });
    const first = await setup({
      regenerate: (next) => {
        events.push(`runtime:${next.rtk}:start`);
        releaseFirst?.();
        return () => events.push(`runtime:${next.rtk}:rollback`);
      },
      save: async (next) => {
        events.push(`unified:${next.rtk}:start`);
        if (next.rtk === false) await firstGate;
      },
    });
    const second = await setup({
      regenerate: (next) => {
        events.push(`runtime:${next.rtk}:start`);
      },
      save: (next) => events.push(`unified:${next.rtk}:start`),
    });

    const requestOne = put(first.baseUrl, { ...baseConfig, rtk: false });
    await firstStarted;
    const requestTwo = put(second.baseUrl, { ...baseConfig, rtk: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).not.toContain('runtime:true:start');
    allowFirst?.();
    await Promise.all([requestOne, requestTwo]);
    expect(events.indexOf('runtime:true:start')).toBeGreaterThan(
      events.indexOf('unified:false:start')
    );
  });

  it('rejects lifecycle control for external Headroom', async () => {
    const config = structuredClone(baseConfig);
    config.headroom.mode = 'external';
    config.headroom.url = 'https://headroom.example.test/base';
    const app = await setup({ config });
    expect((await fetch(`${app.baseUrl}/start`, { method: 'POST' })).status).toBe(400);
  });
});

function put(baseUrl: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
