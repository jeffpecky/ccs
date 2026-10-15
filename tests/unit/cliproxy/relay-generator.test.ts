import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { load } from 'js-yaml';

import { invalidateConfigCache, mutateConfig } from '../../../src/config/config-loader-facade';
import type { RelayConfig, RelayEntry } from '../../../src/config/schemas/relay';
import { regenerateConfig, CLIPROXY_CONFIG_VERSION } from '../../../src/cliproxy/config/generator';

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env.CCS_HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-relay-generator-'));
  process.env.CCS_HOME = home;
  invalidateConfigCache();
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.CCS_HOME;
  else process.env.CCS_HOME = previousHome;
  fs.rmSync(home, { recursive: true, force: true });
});

function relay(overrides: Partial<RelayEntry> & { id: string }): RelayEntry {
  return {
    name: overrides.id,
    platform: 'cloudflare',
    url: `https://${overrides.id}.example.workers.dev`,
    createdAt: '2026-10-14T00:00:00.000Z',
    testStatus: 'untested',
    ...overrides,
  };
}

function generate(config: RelayConfig): Record<string, unknown> {
  mutateConfig((current) => {
    current.relay = config;
  });
  const configPath = path.join(home, 'runtime.yaml');
  regenerateConfig(8317, { configPath, authDir: path.join(home, 'auth') });
  return load(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
}

describe('relay config generation', () => {
  it('emits the active relay as both the legacy url and the candidate list', () => {
    const parsed = generate({
      relays: [relay({ id: 'r1' })],
      activeId: 'r1',
      strategy: 'none',
      strict: false,
      providerRelayIds: {},
    });

    expect(parsed['relay-url']).toBe('https://r1.example.workers.dev');
    expect(parsed['relay-urls']).toEqual(['https://r1.example.workers.dev']);
    expect(parsed['relay-strategy']).toBeUndefined();
    expect(parsed['relay-strict']).toBeUndefined();
    // Mirrors the >21 guard in token-saver-generator.test.ts.
    expect(CLIPROXY_CONFIG_VERSION).toBe(24);
  });

  it('emits an empty relay-url and no candidate list when nothing is deployed', () => {
    const parsed = generate({
      relays: [],
      activeId: null,
      strategy: 'none',
      strict: false,
      providerRelayIds: {},
    });

    // Inactive must serialize as an EMPTY YAML string — never a stale URL —
    // so an older Go binary reads it as "no relay".
    expect(parsed['relay-url']).toBe('');
    expect(parsed['relay-urls']).toBeUndefined();
  });

  it('emits an empty relay-url when activeId points at no deployed relay', () => {
    const parsed = generate({
      relays: [],
      activeId: 'ghost',
      strategy: 'none',
      strict: false,
      providerRelayIds: {},
    });

    expect(parsed['relay-url']).toBe('');
    expect(parsed['relay-urls']).toBeUndefined();
  });

  it('rotates across healthy relays and drops the ones that failed their probe', () => {
    const parsed = generate({
      relays: [
        relay({ id: 'active', testStatus: 'ok' }),
        relay({ id: 'dead', testStatus: 'fail' }),
        relay({ id: 'fresh', testStatus: 'ok' }),
        relay({ id: 'untested' }),
      ],
      activeId: 'active',
      strategy: 'round-robin',
      strict: false,
      providerRelayIds: {},
    });

    expect(parsed['relay-strategy']).toBe('round-robin');
    // Active first so it stays the preferred starting point; the failed relay
    // must not be handed to the proxy at all.
    expect(parsed['relay-urls']).toEqual([
      'https://active.example.workers.dev',
      'https://fresh.example.workers.dev',
      'https://untested.example.workers.dev',
    ]);
    expect(parsed['relay-url']).toBe('https://active.example.workers.dev');
  });

  it('keeps relay-strict when the pool resolves empty so egress fails closed', () => {
    const parsed = generate({
      relays: [relay({ id: 'dead', testStatus: 'fail' })],
      activeId: 'dead',
      strategy: 'random',
      strict: true,
      providerRelayIds: {},
    });

    expect(parsed['relay-urls']).toBeUndefined();
    expect(parsed['relay-strict']).toBe(true);
  });

  it('resolves provider pins to relay URLs and drops dangling ones', () => {
    const parsed = generate({
      relays: [relay({ id: 'r1' }), relay({ id: 'r2' })],
      activeId: 'r1',
      strategy: 'none',
      strict: false,
      providerRelayIds: { claude: 'r2', codex: 'ghost' },
    });

    expect(parsed['relay-provider-urls']).toEqual({
      claude: 'https://r2.example.workers.dev',
    });
  });

  it('keeps the relay block between token-saver and the logging section', () => {
    mutateConfig((current) => {
      current.relay = {
        relays: [relay({ id: 'r1' })],
        activeId: 'r1',
        strategy: 'none',
        strict: false,
        providerRelayIds: {},
      };
    });
    const configPath = path.join(home, 'runtime.yaml');
    regenerateConfig(8317, { configPath, authDir: path.join(home, 'auth') });
    const yaml = fs.readFileSync(configPath, 'utf8');

    expect(yaml.indexOf('relay-url:')).toBeGreaterThan(yaml.indexOf('token-saver:'));
    expect(yaml.indexOf('relay-url:')).toBeLessThan(yaml.indexOf('# Logging'));
  });
});
