import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { load } from 'js-yaml';

import { mergeWithDefaults } from '../../../config/loader/defaults-merger';
import { getConfigYamlPath, invalidateConfigCache } from '../../../config/config-loader-facade';
import { regenerateConfig, CLIPROXY_CONFIG_VERSION } from '../generator';

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env.CCS_HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-token-saver-'));
  process.env.CCS_HOME = home;
  invalidateConfigCache();
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.CCS_HOME;
  else process.env.CCS_HOME = previousHome;
  fs.rmSync(home, { recursive: true, force: true });
});

describe('token saver unified config and CLIProxy YAML', () => {
  it('normalizes safe disabled defaults with independent controls', () => {
    const config = mergeWithDefaults({ version: 8 });

    expect(config.cliproxy.token_saver).toEqual({
      enabled: false,
      rtk: false,
      caveman: { enabled: false, level: 'full' },
      ponytail: { enabled: false, level: 'full' },
      headroom: {
        enabled: false,
        url: 'http://127.0.0.1:8787',
        mode: 'local',
        timeout_ms: 3000,
        compress_user_messages: false,
        token_env: 'HEADROOM_PROXY_TOKEN',
        code_aware: false,
        kompress: true,
      },
      pxpipe: { enabled: false, min_chars: 25000, timeout_ms: 15000 },
    });
  });

  it('emits exact CLIProxy token-saver contract without resolving secret values', () => {
    process.env.HEADROOM_TEST_SECRET = 'must-not-appear';
    fs.mkdirSync(path.dirname(getConfigYamlPath()), { recursive: true });
    fs.writeFileSync(
      getConfigYamlPath(),
      `version: 8
cliproxy:
  token_saver:
    enabled: true
    rtk: true
    caveman: { enabled: true, level: terse }
    ponytail: { enabled: true, level: standard }
    headroom:
      enabled: true
      url: https://headroom.example.test
      mode: external
      timeout_ms: 4500
      compress_user_messages: true
      token_env: HEADROOM_TEST_SECRET
      code_aware: true
      kompress: false
    pxpipe: { enabled: false, min_chars: 30000, timeout_ms: 12000 }
`
    );
    invalidateConfigCache();

    const outputPath = path.join(home, 'runtime.yaml');
    regenerateConfig(8317, { configPath: outputPath, authDir: path.join(home, 'auth') });
    const yaml = fs.readFileSync(outputPath, 'utf8');
    const parsed = load(yaml) as Record<string, any>;

    expect(CLIPROXY_CONFIG_VERSION).toBeGreaterThan(20);
    expect(parsed['token-saver']).toEqual({
      enabled: true,
      rtk: true,
      caveman: { enabled: true, level: 'terse' },
      ponytail: { enabled: true, level: 'standard' },
      headroom: {
        enabled: true,
        url: 'https://headroom.example.test',
        'timeout-ms': 4500,
        'compress-user-messages': true,
        'proxy-token-env': 'HEADROOM_PROXY_TOKEN',
      },
      pxpipe: { enabled: false, 'min-chars': 30000, 'timeout-ms': 12000 },
    });
    expect(yaml).not.toContain('must-not-appear');
    delete process.env.HEADROOM_TEST_SECRET;
  });

  it('always emits fixed Headroom token environment name', () => {
    const merged = mergeWithDefaults({
      version: 8,
      cliproxy: {
        token_saver: { headroom: { token_env: 'ATTACKER_TOKEN' } },
      } as any,
    });
    expect(merged.cliproxy.token_saver?.headroom?.token_env).toBe('HEADROOM_PROXY_TOKEN');
  });

  it('preserves existing runtime YAML when regeneration fails before replacement', () => {
    const configPath = path.join(home, 'runtime.yaml');
    const invalidAuthDir = path.join(home, 'not-a-directory');
    fs.writeFileSync(configPath, 'sentinel-runtime-config');
    fs.writeFileSync(invalidAuthDir, 'file blocks mkdir');

    expect(() => regenerateConfig(8317, { configPath, authDir: invalidAuthDir })).toThrow();
    expect(fs.readFileSync(configPath, 'utf8')).toBe('sentinel-runtime-config');
  });

  it('uses prospective token saver override instead of persisted config', () => {
    const configPath = path.join(home, 'prospective.yaml');
    regenerateConfig(8317, {
      configPath,
      authDir: path.join(home, 'auth'),
      tokenSaver: {
        enabled: true,
        rtk: true,
        headroom: {
          enabled: true,
          url: 'https://prospective.example.test/base',
          timeout_ms: 4321,
        },
      },
    });
    const parsed = load(fs.readFileSync(configPath, 'utf8')) as Record<string, any>;
    expect(parsed['token-saver'].rtk).toBe(true);
    expect(parsed['token-saver'].headroom.url).toBe('https://prospective.example.test/base');
    expect(parsed['token-saver'].headroom['timeout-ms']).toBe(4321);
  });

  it('emits provided authDir override', () => {
    const configPath = path.join(home, 'auth-dir-override.yaml');
    const authDir = path.join(home, 'custom-auth-root');
    regenerateConfig(8317, { configPath, authDir });
    const parsed = load(fs.readFileSync(configPath, 'utf8')) as Record<string, any>;
    expect(parsed['auth-dir']).toBe(authDir.split(path.sep).join('/'));
  });
});
