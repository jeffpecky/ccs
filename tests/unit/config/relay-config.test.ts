import { describe, expect, it } from 'bun:test';
import { DEFAULT_RELAY_CONFIG, isRelayConfig, type RelayConfig } from '../../../src/config/schemas/relay';
import { getRelayConfig } from '../../../src/config/loader/config-getters';
import { loadOrCreateUnifiedConfig } from '../../../src/config/unified-config-loader';
import { generateYamlWithComments } from '../../../src/config/loader/yaml-serializer';

describe('relay config schema', () => {
  it('provides defaults and a type guard', () => {
    expect(DEFAULT_RELAY_CONFIG).toEqual({ relays: [], activeId: null });
    expect(isRelayConfig({ relays: [], activeId: null })).toBe(true);
    expect(isRelayConfig({ relays: [] })).toBe(false);
    expect(isRelayConfig('nope')).toBe(false);
  });

  it('getRelayConfig returns a well-formed default on a pristine config', () => {
    // On the fresh temp-CCS_HOME test environment there is no relay section,
    // so the getter must fall back to defaults.
    const relay = getRelayConfig();
    expect(Array.isArray(relay.relays)).toBe(true);
    expect(relay.activeId === null || typeof relay.activeId === 'string').toBe(true);
  });

  it('round-trips a relay entry through yaml serialization', () => {
    const config = loadOrCreateUnifiedConfig();
    const relay: RelayConfig = {
      relays: [{ id: 'r1', name: 'my-relay', platform: 'cloudflare', url: 'https://my.workers.dev', createdAt: '2026-10-14T00:00:00.000Z', testStatus: 'untested' }],
      activeId: 'r1',
    };
    (config as Record<string, unknown>).relay = relay;
    const yaml = generateYamlWithComments(config);
    expect(yaml).toContain('relay');
    expect(yaml).toContain('https://my.workers.dev');
    expect(yaml).toContain('r1');
  });
});
