import { describe, expect, it } from 'bun:test';
import * as yaml from 'js-yaml';
import { DEFAULT_RELAY_CONFIG, isRelayConfig, type RelayConfig } from '../../../src/config/schemas/relay';
import { UNIFIED_CONFIG_VERSION } from '../../../src/config/unified-config-types';
import { getRelayConfig } from '../../../src/config/loader/config-getters';
import { mergeWithDefaults } from '../../../src/config/loader/defaults-merger';
import { loadOrCreateUnifiedConfig } from '../../../src/config/unified-config-loader';
import { generateYamlWithComments } from '../../../src/config/loader/yaml-serializer';

const RELAY_ENTRY = {
  id: 'r1',
  name: 'my-relay',
  platform: 'cloudflare',
  url: 'https://my.workers.dev',
  createdAt: '2026-10-14T00:00:00.000Z',
  testStatus: 'untested',
} as const;

describe('relay config schema', () => {
  it('provides defaults and a type guard', () => {
    expect(DEFAULT_RELAY_CONFIG).toEqual({
      relays: [],
      activeId: null,
      strategy: 'round-robin',
      strict: false,
      providerRelayIds: {},
    });
    expect(isRelayConfig({ relays: [], activeId: null })).toBe(true);
    // activeId may be omitted in hand-edited sections (filled in by the merger)
    expect(isRelayConfig({ relays: [] })).toBe(true);
    expect(isRelayConfig({ relays: [], activeId: undefined })).toBe(true);
    expect(isRelayConfig('nope')).toBe(false);
  });

  it('rejects malformed rotation settings', () => {
    const base = { relays: [], activeId: null };
    expect(isRelayConfig({ ...base, strategy: 'fastest' })).toBe(false);
    // A blank strategy is "unset" (the merger fills in the default); only an
    // unrecognized value is a typo worth surfacing.
    expect(isRelayConfig({ ...base, strategy: '' })).toBe(true);
    expect(isRelayConfig({ ...base, strategy: 'round-robin' })).toBe(true);
    expect(isRelayConfig({ ...base, strict: 'yes' })).toBe(false);
    expect(isRelayConfig({ ...base, strict: true })).toBe(true);
    expect(isRelayConfig({ ...base, providerRelayIds: { claude: 7 } })).toBe(false);
    expect(isRelayConfig({ ...base, providerRelayIds: ['claude'] })).toBe(false);
    expect(isRelayConfig({ ...base, providerRelayIds: { claude: 'r1' } })).toBe(true);
  });

  it('rejects malformed relay entries', () => {
    expect(isRelayConfig({ relays: [42], activeId: null })).toBe(false);
    expect(isRelayConfig({ relays: [{ ...RELAY_ENTRY, url: undefined }], activeId: null })).toBe(
      false
    );
    expect(
      isRelayConfig({ relays: [{ ...RELAY_ENTRY, platform: 'spaceship' }], activeId: null })
    ).toBe(false);
  });

  it('getRelayConfig returns defaults on a pristine config', () => {
    // On the fresh temp-CCS_HOME test environment there is no relay section,
    // so the getter must fall back to defaults.
    expect(getRelayConfig()).toEqual(DEFAULT_RELAY_CONFIG);
  });

  it('does not alias the module default relay list', () => {
    const first = getRelayConfig();
    first.relays.push({ ...RELAY_ENTRY, id: 'poison' });
    const second = getRelayConfig();
    expect(second.relays).toHaveLength(0);
    expect(second).toEqual(DEFAULT_RELAY_CONFIG);
  });

  it('preserves a relay section through mergeWithDefaults', () => {
    const relay: RelayConfig = {
      relays: [{ ...RELAY_ENTRY }],
      activeId: 'r1',
      strategy: 'round-robin',
      strict: true,
      providerRelayIds: { claude: 'r1' },
    };
    const merged = mergeWithDefaults({ version: UNIFIED_CONFIG_VERSION, relay });
    expect(merged.relay).toEqual(relay);
  });

  it('fills in activeId and rotation settings when a hand-edited section omits them', () => {
    const handEdited = { relays: [{ ...RELAY_ENTRY }] } as unknown as RelayConfig;
    const merged = mergeWithDefaults({ version: UNIFIED_CONFIG_VERSION, relay: handEdited });
    expect(merged.relay).toEqual({
      relays: [{ ...RELAY_ENTRY }],
      activeId: null,
      strategy: 'round-robin',
      strict: false,
      providerRelayIds: {},
    });
  });

  it('keeps the relay list when a hand-edited section has a blank strategy', () => {
    // Blank must read as "unset", not as a malformed section: rejecting it
    // would make the merger drop the deployed relays along with the value.
    const handEdited = {
      relays: [{ ...RELAY_ENTRY }],
      activeId: 'r1',
      strategy: '',
    } as unknown as RelayConfig;
    const merged = mergeWithDefaults({ version: UNIFIED_CONFIG_VERSION, relay: handEdited });
    expect(merged.relay.strategy).toBe('round-robin');
    expect(merged.relay.relays).toEqual([{ ...RELAY_ENTRY }]);
  });

  it('round-trips a relay entry through yaml serialization', () => {
    const config = loadOrCreateUnifiedConfig();
    const relay: RelayConfig = {
      relays: [{ ...RELAY_ENTRY }],
      activeId: 'r1',
      strategy: 'random',
      strict: true,
      providerRelayIds: { claude: 'r1' },
    };
    (config as Record<string, unknown>).relay = relay;
    const reparsed = yaml.load(generateYamlWithComments(config)) as Record<string, unknown>;
    expect(reparsed.relay).toEqual(relay);
  });
});
