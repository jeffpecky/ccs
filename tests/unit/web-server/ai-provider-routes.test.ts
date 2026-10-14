import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import express from 'express';
import type { Server } from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const listCalls: string[] = [];
const updateCalls: Array<{ family: string; entryId: string; data: Record<string, unknown> }> = [];

mock.module('../../../src/cliproxy/ai-providers', () => ({
  AI_PROVIDER_FAMILY_DEFINITIONS: {
    'gemini-api-key': {
      id: 'gemini-api-key',
      displayName: 'Gemini',
      description: 'Mock Gemini family',
      authMode: 'hybrid',
      supportsNamedEntries: false,
      routePath: '/api/provider/gemini',
    },
    'openai-compatibility': {
      id: 'openai-compatibility',
      displayName: 'OpenAI-Compatible',
      description: 'Mock connector family',
      authMode: 'connector',
      supportsNamedEntries: true,
      routePath: '/api/provider/openai-compat',
    },
  },
  AI_PROVIDER_FAMILY_IDS: ['gemini-api-key', 'openai-compatibility'],
  listAiProviders: async () => {
    listCalls.push('list');
    return {
      source: {
        mode: 'local',
        label: 'Local CLIProxy',
        target: 'http://127.0.0.1:8317',
        managementAuth: 'configured',
      },
      families: [],
    };
  },
  createAiProviderEntry: async () => {},
  updateAiProviderEntry: async (family: string, entryId: string, data: Record<string, unknown>) => {
    updateCalls.push({ family, entryId, data });
  },
  deleteAiProviderEntry: async () => {},
  fetchAiProviderModels: async () => ({ models: [], provider: 'mock' }),
  testAiProviderConnection: async () => ({ success: true, message: 'Connection successful' }),
}));

describe('ai-provider-routes', () => {
  let router: typeof import('../../../src/web-server/routes/ai-provider-routes').default;
  let server: Server;
  let baseUrl = '';
  let forcedRemoteAddress = '127.0.0.1';
  let tempHome = '';
  let originalDashboardAuthEnabled: string | undefined;
  let originalCcsHome: string | undefined;

  beforeAll(async () => {
    ({ default: router } = await import(
      `../../../src/web-server/routes/ai-provider-routes?ai-provider-routes=${Date.now()}`
    ));

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.defineProperty(req.socket, 'remoteAddress', {
        value: forcedRemoteAddress,
        configurable: true,
      });
      next();
    });
    app.use('/api/cliproxy/ai-providers', router);

    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, '127.0.0.1');
      server.once('error', reject);
      server.once('listening', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unable to resolve test server port');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    originalDashboardAuthEnabled = process.env.CCS_DASHBOARD_AUTH_ENABLED;
    originalCcsHome = process.env.CCS_HOME;
    if (tempHome && fs.existsSync(tempHome)) {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-ai-provider-routes-'));
    process.env.CCS_HOME = tempHome;
    forcedRemoteAddress = '127.0.0.1';
    process.env.CCS_DASHBOARD_AUTH_ENABLED = 'false';
    listCalls.length = 0;
    updateCalls.length = 0;
  });

  afterEach(() => {
    if (originalDashboardAuthEnabled !== undefined) {
      process.env.CCS_DASHBOARD_AUTH_ENABLED = originalDashboardAuthEnabled;
    } else {
      delete process.env.CCS_DASHBOARD_AUTH_ENABLED;
    }
    if (originalCcsHome !== undefined) {
      process.env.CCS_HOME = originalCcsHome;
    } else {
      delete process.env.CCS_HOME;
    }
    if (tempHome && fs.existsSync(tempHome)) {
      fs.rmSync(tempHome, { recursive: true, force: true });
      tempHome = '';
    }
  });

  it('blocks remote access when dashboard auth is disabled', async () => {
    forcedRemoteAddress = '10.10.0.24';

    const response = await fetch(`${baseUrl}/api/cliproxy/ai-providers`);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'AI provider endpoints require localhost access when dashboard auth is disabled.',
    });
    expect(listCalls).toHaveLength(0);
  });

  it('allows non-local access when dashboard auth is enabled', async () => {
    forcedRemoteAddress = '10.10.0.24';
    process.env.CCS_DASHBOARD_AUTH_ENABLED = 'true';

    const response = await fetch(`${baseUrl}/api/cliproxy/ai-providers`);
    expect(response.status).toBe(200);
    expect(listCalls).toHaveLength(1);
  });

  it('passes stable entry ids through update routes', async () => {
    const response = await fetch(
      `${baseUrl}/api/cliproxy/ai-providers/gemini-api-key/entry-alpha-123`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: 'sk-test' }),
      }
    );

    expect(response.status).toBe(200);
    expect(updateCalls).toEqual([
      {
        family: 'gemini-api-key',
        entryId: 'entry-alpha-123',
        data: {
          apiKey: 'sk-test',
          apiKeys: undefined,
          baseUrl: undefined,
          excludedModels: undefined,
          headers: undefined,
          models: undefined,
          name: undefined,
          prefix: undefined,
          preserveSecrets: false,
          proxyUrl: undefined,
        },
      },
    ]);
  });
});
