import { afterEach, describe, expect, it, mock } from 'bun:test';
import * as http from 'http';
import type { AddressInfo } from 'net';

import type { RelayConfig, RelayEntry } from '../../../src/config/schemas/relay';

// Bun's mock.module patches persist across files in a worker: keep every real
// facade export and only override the getter, so later suites that import the
// facade are unaffected.
const actualFacade = await import('../../../src/config/config-loader-facade');

let relayConfig: RelayConfig = { relays: [], activeId: null };
mock.module('../../../src/config/config-loader-facade', () => ({
  ...actualFacade,
  getRelayConfig: () => structuredClone(relayConfig),
}));

const { getActiveRelayUrl, testRelay } = await import('../../../src/relay/relay-service');

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

function makeRelay(id: string, url: string): RelayEntry {
  return {
    id,
    name: id,
    platform: 'vercel',
    url,
    createdAt: '2026-01-01T00:00:00.000Z',
    testStatus: 'untested',
  };
}

describe('getActiveRelayUrl', () => {
  it('returns null when no relay is active', () => {
    relayConfig = { relays: [makeRelay('r1', 'https://r1.example.test')], activeId: null };
    expect(getActiveRelayUrl()).toBeNull();
  });

  it('returns null when the active relay is missing from the list', () => {
    relayConfig = { relays: [], activeId: 'ghost' };
    expect(getActiveRelayUrl()).toBeNull();
  });

  it('returns the URL of the active relay', () => {
    relayConfig = {
      relays: [
        makeRelay('r1', 'https://r1.example.test'),
        makeRelay('r2', 'https://r2.example.test'),
      ],
      activeId: 'r2',
    };
    expect(getActiveRelayUrl()).toBe('https://r2.example.test');
  });
});

describe('testRelay', () => {
  it('times out against a server that never responds', async () => {
    const server = http.createServer(() => {
      // Deliberately never respond; the probe must abort on its own.
    });
    const port = await listen(server);
    const result = await testRelay(`http://127.0.0.1:${port}/`, 50);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toBe('Relay test timed out');
  });

  it('treats a live 200 response as ok and sends the 9Router probe headers', async () => {
    let probeTarget: string | undefined;
    let probePath: string | undefined;
    const server = http.createServer((req, res) => {
      probeTarget = req.headers['x-relay-target'];
      probePath = req.headers['x-relay-path'];
      res.writeHead(200);
      res.end('ok');
    });
    const port = await listen(server);
    const result = await testRelay(`http://127.0.0.1:${port}/relay`, 2000);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(probeTarget).toBe('https://httpbin.org');
    expect(probePath).toBe('/get');
  });
});
