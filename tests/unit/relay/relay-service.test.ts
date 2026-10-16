import { afterEach, describe, expect, it } from 'bun:test';
import * as http from 'http';
import type { AddressInfo } from 'net';

import type { RelayConfig, RelayEntry } from '../../../src/config/schemas/relay';
import { DEFAULT_RELAY_CONFIG } from '../../../src/config/schemas/relay';
import {
  getActiveRelayUrl,
  resolveProviderRelayUrls,
  resolveRelayCandidates,
  testRelay,
} from '../../../src/relay/relay-service';

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

/** Relay section with the schema defaults filled in, plus overrides. */
function makeConfig(overrides: Partial<RelayConfig>): RelayConfig {
  return { ...DEFAULT_RELAY_CONFIG, ...overrides };
}

describe('getActiveRelayUrl', () => {
  it('returns null when no relay is active', () => {
    const config = makeConfig({ relays: [makeRelay('r1', 'https://r1.example.test')] });
    expect(getActiveRelayUrl(config)).toBeNull();
  });

  it('returns null when the active relay is missing from the list', () => {
    const config = makeConfig({ activeId: 'ghost' });
    expect(getActiveRelayUrl(config)).toBeNull();
  });

  it('returns the URL of the active relay', () => {
    const config = makeConfig({
      relays: [
        makeRelay('r1', 'https://r1.example.test'),
        makeRelay('r2', 'https://r2.example.test'),
      ],
      activeId: 'r2',
    });
    expect(getActiveRelayUrl(config)).toBe('https://r2.example.test');
  });
  it('returns null when the active relay is paused', () => {
    // Pause beats the active pointer: CCS-originated fetches fall back to
    // plain direct requests instead of using a relay pulled from service.
    const config = makeConfig({
      relays: [{ ...makeRelay('r1', 'https://r1.example.test'), paused: true }],
      activeId: 'r1',
    });
    expect(getActiveRelayUrl(config)).toBeNull();
  });
});

describe('resolveRelayCandidates', () => {
  it('uses only the active relay when strategy is none', () => {
    const config = makeConfig({
      relays: [
        makeRelay('r1', 'https://r1.example.test'),
        { ...makeRelay('r2', 'https://r2.example.test'), testStatus: 'ok' },
      ],
      activeId: 'r1',
      strategy: 'none',
    });
    expect(resolveRelayCandidates(config)).toEqual(['https://r1.example.test']);
  });

  it('resolves nothing with strategy none and no active relay', () => {
    const config = makeConfig({
      relays: [makeRelay('r1', 'https://r1.example.test')],
      activeId: null,
      strategy: 'none',
    });
    expect(resolveRelayCandidates(config)).toEqual([]);
  });

  it('keeps the active relay in the pool even when its probe failed', () => {
    // 'none' deliberately ignores health: routing to a known-dead relay fails
    // loudly instead of silently falling back to this machine's IP.
    const config = makeConfig({
      relays: [{ ...makeRelay('r1', 'https://r1.example.test'), testStatus: 'fail' }],
      activeId: 'r1',
      strategy: 'none',
    });
    expect(resolveRelayCandidates(config)).toEqual(['https://r1.example.test']);
  });

  it('excludes paused relays from the rotation pool, including a paused active', () => {
    const config = makeConfig({
      relays: [
        { ...makeRelay('r1', 'https://r1.example.test'), paused: true },
        { ...makeRelay('r2', 'https://r2.example.test'), testStatus: 'ok' },
        { ...makeRelay('r3', 'https://r3.example.test'), paused: true },
      ],
      activeId: 'r1',
    });
    // The paused active relay must not lead the pool; only r2 stays in service.
    expect(resolveRelayCandidates(config)).toEqual(['https://r2.example.test']);
  });

  it('resolves nothing when every relay is paused', () => {
    const config = makeConfig({
      relays: [{ ...makeRelay('r1', 'https://r1.example.test'), paused: true }],
      activeId: 'r1',
    });
    expect(resolveRelayCandidates(config)).toEqual([]);
  });

  it('falls back to the first unpaused relay when the active one is paused in none mode', () => {
    // Pause must not empty the pool into direct egress (which would expose
    // this machine's IP): the vacated slot goes to the next unpaused relay.
    const config = makeConfig({
      relays: [
        { ...makeRelay('r1', 'https://r1.example.test'), paused: true },
        makeRelay('r2', 'https://r2.example.test'),
      ],
      activeId: 'r1',
      strategy: 'none',
    });
    expect(resolveRelayCandidates(config)).toEqual(['https://r2.example.test']);
  });

  it('resolves nothing with strategy none when the active relay is paused alone', () => {
    const config = makeConfig({
      relays: [{ ...makeRelay('r1', 'https://r1.example.test'), paused: true }],
      activeId: 'r1',
      strategy: 'none',
    });
    expect(resolveRelayCandidates(config)).toEqual([]);
  });

  it('rotates across every healthy relay with the active one first', () => {
    const config = makeConfig({
      relays: [
        { ...makeRelay('dead', 'https://dead.example.test'), testStatus: 'fail' },
        { ...makeRelay('fresh', 'https://fresh.example.test'), testStatus: 'ok' },
        makeRelay('r2', 'https://r2.example.test'),
        { ...makeRelay('active', 'https://active.example.test'), testStatus: 'ok' },
      ],
      activeId: 'active',
      strategy: 'round-robin',
    });
    expect(resolveRelayCandidates(config)).toEqual([
      'https://active.example.test',
      'https://fresh.example.test',
      'https://r2.example.test',
    ]);
  });

  it('rotates over healthy relays even when none is active', () => {
    const config = makeConfig({
      relays: [
        makeRelay('r1', 'https://r1.example.test'),
        { ...makeRelay('dead', 'https://dead.example.test'), testStatus: 'fail' },
      ],
      activeId: null,
      strategy: 'random',
    });
    expect(resolveRelayCandidates(config)).toEqual(['https://r1.example.test']);
  });

  it('resolves nothing when every relay has failed', () => {
    const config = makeConfig({
      relays: [{ ...makeRelay('r1', 'https://r1.example.test'), testStatus: 'fail' }],
      activeId: 'r1',
      strategy: 'round-robin',
    });
    expect(resolveRelayCandidates(config)).toEqual([]);
  });

  it('treats a missing or empty strategy as the rotation default', () => {
    // The Go side only rotates when relay-strategy is written explicitly, so a
    // blank strategy must not collapse the pool back to the active relay alone.
    const base = {
      relays: [
        makeRelay('r1', 'https://r1.example.test'),
        { ...makeRelay('r2', 'https://r2.example.test'), testStatus: 'ok' as const },
        { ...makeRelay('dead', 'https://dead.example.test'), testStatus: 'fail' as const },
      ],
      activeId: 'r1',
    };
    expect(resolveRelayCandidates({ ...base, strategy: '' as RelayConfig['strategy'] })).toEqual([
      'https://r1.example.test',
      'https://r2.example.test',
    ]);
    expect(
      resolveRelayCandidates({ ...base, strategy: undefined as unknown as RelayConfig['strategy'] })
    ).toEqual(['https://r1.example.test', 'https://r2.example.test']);
  });
});

describe('resolveProviderRelayUrls', () => {
  it('maps pinned providers to deployed relay URLs', () => {
    const config = makeConfig({
      relays: [
        makeRelay('r1', 'https://r1.example.test'),
        makeRelay('r2', 'https://r2.example.test'),
      ],
      activeId: 'r1',
      providerRelayIds: { claude: 'r2' },
    });
    expect(resolveProviderRelayUrls(config)).toEqual({ claude: 'https://r2.example.test' });
  });

  it('drops pins whose relay no longer exists', () => {
    const config = makeConfig({
      relays: [makeRelay('r1', 'https://r1.example.test')],
      providerRelayIds: { claude: 'r1', codex: 'ghost' },
    });
    expect(resolveProviderRelayUrls(config)).toEqual({ claude: 'https://r1.example.test' });
  });
  it('drops pins whose relay is paused until it is resumed', () => {
    // Pause means "send no traffic there", pins included — the provider falls
    // back to the rotation pool rather than to a relay the operator parked.
    const config = makeConfig({
      relays: [
        makeRelay('r1', 'https://r1.example.test'),
        { ...makeRelay('r2', 'https://r2.example.test'), paused: true },
      ],
      providerRelayIds: { claude: 'r1', gemini: 'r2' },
    });
    expect(resolveProviderRelayUrls(config)).toEqual({ claude: 'https://r1.example.test' });
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
