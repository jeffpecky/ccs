import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { load } from 'js-yaml';

import { invalidateConfigCache, mutateConfig } from '../../../config/config-loader-facade';
import { regenerateConfig, CLIPROXY_CONFIG_VERSION } from '../generator';

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

describe('relay-url generation', () => {
  it('emits relay-url: <active relay url> when a relay is active', () => {
    mutateConfig((config) => {
      config.relay = {
        relays: [
          {
            id: 'r1',
            name: 'n',
            platform: 'cloudflare',
            url: 'https://my.workers.dev',
            createdAt: 'x',
          },
        ],
        activeId: 'r1',
        strategy: 'none',
        strict: false,
        providerRelayIds: {},
      };
    });

    const configPath = path.join(home, 'runtime.yaml');
    regenerateConfig(8317, { configPath, authDir: path.join(home, 'auth') });
    const yaml = fs.readFileSync(configPath, 'utf8');

    // Parse-based: a commented-out `# relay-url:` line must not satisfy this.
    const parsed = load(yaml) as Record<string, unknown>;
    expect(parsed['relay-url']).toBe('https://my.workers.dev');
    expect(parsed['relay-urls']).toEqual(['https://my.workers.dev']);
    // Placement: Server Settings, right after the token-saver block and
    // before the Logging section.
    expect(yaml.indexOf('relay-url:')).toBeGreaterThan(yaml.indexOf('token-saver:'));
    expect(yaml.indexOf('relay-url:')).toBeLessThan(yaml.indexOf('# Logging'));
    // Mirrors the >21 guard in token-saver-generator.test.ts.
    expect(CLIPROXY_CONFIG_VERSION).toBe(24);
  });

  it('emits an empty relay-url when no relay is active', () => {
    mutateConfig((config) => {
      config.relay = {
        relays: [],
        activeId: null,
        strategy: 'none',
        strict: false,
        providerRelayIds: {},
      };
    });

    const configPath = path.join(home, 'runtime.yaml');
    regenerateConfig(8317, { configPath, authDir: path.join(home, 'auth') });
    const yaml = fs.readFileSync(configPath, 'utf8');

    // Inactive must serialize as an EMPTY YAML string — never a stale URL —
    // so the Go side reads it as "no relay".
    const parsed = load(yaml) as Record<string, unknown>;
    expect(parsed['relay-url']).toBe('');
    expect(yaml).not.toContain('my.workers.dev');
  });

  it('emits an empty relay-url when activeId points at no deployed relay', () => {
    // Dangling activeId (e.g. relay deleted after activation) must degrade
    // to empty, never a phantom URL — exercises relay-service's `?? null`.
    mutateConfig((config) => {
      config.relay = {
        relays: [],
        activeId: 'ghost',
        strategy: 'none',
        strict: false,
        providerRelayIds: {},
      };
    });

    const configPath = path.join(home, 'runtime.yaml');
    regenerateConfig(8317, { configPath, authDir: path.join(home, 'auth') });
    const yaml = fs.readFileSync(configPath, 'utf8');

    const parsed = load(yaml) as Record<string, unknown>;
    expect(parsed['relay-url']).toBe('');
  });
});
