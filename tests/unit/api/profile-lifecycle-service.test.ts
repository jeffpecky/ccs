import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  copyApiProfile,
  discoverApiProfileOrphans,
  exportApiProfile,
  importApiProfileBundle,
  registerApiProfileOrphans,
} from '../../../src/api/services/profile-lifecycle-service';
import {
  loadConfigSafe,
  runWithScopedConfigDir,
  setGlobalConfigDir,
} from '../../../src/utils/config-manager';

describe('profile lifecycle service', () => {
  let tempHome = '';
  let originalCcsHome: string | undefined;
  let originalCcsDir: string | undefined;
  let originalUnifiedMode: string | undefined;

  function getScopedCcsDir(): string {
    return path.join(tempHome, '.ccs');
  }

  async function runInScopedCcsDir<T>(fn: () => T): Promise<T> {
    return await runWithScopedConfigDir(getScopedCcsDir(), fn);
  }

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-profile-lifecycle-'));
    originalCcsHome = process.env.CCS_HOME;
    originalCcsDir = process.env.CCS_DIR;
    originalUnifiedMode = process.env.CCS_UNIFIED_CONFIG;
    process.env.CCS_HOME = tempHome;
    delete process.env.CCS_DIR;
    delete process.env.CCS_UNIFIED_CONFIG;
    setGlobalConfigDir(undefined);
  });

  afterEach(() => {
    mock.restore();

    if (originalCcsHome === undefined) {
      delete process.env.CCS_HOME;
    } else {
      process.env.CCS_HOME = originalCcsHome;
    }

    if (originalCcsDir === undefined) {
      delete process.env.CCS_DIR;
    } else {
      process.env.CCS_DIR = originalCcsDir;
    }

    if (originalUnifiedMode === undefined) {
      delete process.env.CCS_UNIFIED_CONFIG;
    } else {
      process.env.CCS_UNIFIED_CONFIG = originalUnifiedMode;
    }

    setGlobalConfigDir(undefined);

    if (tempHome && fs.existsSync(tempHome)) {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('discovers only API profile orphans (skips registered and reserved names)', async () => {
    const ccsDir = path.join(tempHome, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });

    fs.writeFileSync(
      path.join(ccsDir, 'config.json'),
      JSON.stringify({ profiles: { glm: '~/.ccs/glm.settings.json' } }, null, 2) + '\n'
    );

    fs.writeFileSync(
      path.join(ccsDir, 'glm.settings.json'),
      JSON.stringify(
        { env: { ANTHROPIC_BASE_URL: 'https://api.example.com', ANTHROPIC_AUTH_TOKEN: 'token' } },
        null,
        2
      ) + '\n'
    );
    fs.writeFileSync(
      path.join(ccsDir, 'extra.settings.json'),
      JSON.stringify(
        { env: { ANTHROPIC_BASE_URL: 'https://api.example.com', ANTHROPIC_AUTH_TOKEN: 'token' } },
        null,
        2
      ) + '\n'
    );
    fs.writeFileSync(
      path.join(ccsDir, 'gemini.settings.json'),
      JSON.stringify(
        { env: { ANTHROPIC_BASE_URL: 'https://api.example.com', ANTHROPIC_AUTH_TOKEN: 'token' } },
        null,
        2
      ) + '\n'
    );

    const result = await runInScopedCcsDir(() => discoverApiProfileOrphans());
    expect(result.orphans.map((orphan) => orphan.name)).toEqual(['extra']);
  });

  it('treats explicit empty names list as no-op during orphan registration', async () => {
    const ccsDir = path.join(tempHome, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });

    fs.writeFileSync(
      path.join(ccsDir, 'lonely.settings.json'),
      JSON.stringify(
        { env: { ANTHROPIC_BASE_URL: 'https://api.example.com', ANTHROPIC_AUTH_TOKEN: 'token' } },
        null,
        2
      ) + '\n'
    );
    fs.writeFileSync(
      path.join(ccsDir, 'config.json'),
      JSON.stringify({ profiles: {} }, null, 2) + '\n'
    );

    const result = await runInScopedCcsDir(() => registerApiProfileOrphans({ names: [] }));
    expect(result.registered).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
  // NOTE: four WebSearch-setup tests (register/copy/import failure + disabled
  // scenarios) were removed: the WebSearch hook feature was stripped from this
  // fork in a36a1238. Re-add them if the feature returns.

  it('registers malformed orphan settings when force bypasses validation', async () => {
    const ccsDir = path.join(tempHome, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });

    const malformedPath = path.join(ccsDir, 'bad.settings.json');
    fs.writeFileSync(malformedPath, '{ invalid json', 'utf8');
    fs.writeFileSync(path.join(ccsDir, 'config.json'), JSON.stringify({ profiles: {} }, null, 2) + '\n');

    const result = await runInScopedCcsDir(() =>
      registerApiProfileOrphans({ names: ['bad'], force: true })
    );
    const config = await runInScopedCcsDir(() => loadConfigSafe());

    expect(result.registered).toEqual(['bad']);
    expect(result.skipped).toEqual([]);
    expect(config.profiles.bad).toBe('~/.ccs/bad.settings.json');
    expect(fs.existsSync(path.join(ccsDir, 'hooks', 'websearch-transformer.cjs'))).toBe(false);
    expect(fs.readFileSync(malformedPath, 'utf8')).toBe('{ invalid json');
  });

  it('redacts all sensitive env values during export when includeSecrets=false', async () => {
    const ccsDir = path.join(tempHome, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });

    fs.writeFileSync(
      path.join(ccsDir, 'config.json'),
      JSON.stringify({ profiles: { glm: '~/.ccs/glm.settings.json' } }, null, 2) + '\n'
    );
    fs.writeFileSync(
      path.join(ccsDir, 'glm.settings.json'),
      JSON.stringify(
        {
          env: {
            ANTHROPIC_BASE_URL: 'https://api.example.com',
            ANTHROPIC_AUTH_TOKEN: 'token-1',
            OPENROUTER_API_KEY: 'token-2',
          },
        },
        null,
        2
      ) + '\n'
    );

    const result = await runInScopedCcsDir(() => exportApiProfile('glm', false));
    expect(result.success).toBe(true);
    expect(result.bundle?.settings).toBeDefined();

    const env = (result.bundle?.settings.env as Record<string, unknown>) || {};
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('__CCS_REDACTED__');
    expect(env.OPENROUTER_API_KEY).toBe('__CCS_REDACTED__');
  });

  it('rejects invalid source profile names in copy flow', async () => {
    const result = await runInScopedCcsDir(() => copyApiProfile('../escape', 'safe-name'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid source profile name');
  });

  it('rejects import bundle with invalid profile target', async () => {
    const result = await runInScopedCcsDir(() =>
      importApiProfileBundle({
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        profile: { name: 'glm', target: 'invalid-target' },
        settings: {
          env: {
            ANTHROPIC_BASE_URL: 'https://api.example.com',
            ANTHROPIC_AUTH_TOKEN: 'token',
          },
        },
      })
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid bundle profile target');
  });

  it('clears and warns for all redacted sensitive env keys on import', async () => {
    const ccsDir = path.join(tempHome, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });
    fs.writeFileSync(
      path.join(ccsDir, 'config.json'),
      JSON.stringify({ profiles: {} }, null, 2) + '\n'
    );

    const result = await runInScopedCcsDir(() =>
      importApiProfileBundle({
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        profile: { name: 'redacted-import', target: 'claude' },
        settings: {
          env: {
            ANTHROPIC_BASE_URL: 'https://api.example.com',
            ANTHROPIC_AUTH_TOKEN: '__CCS_REDACTED__',
            OPENROUTER_API_KEY: '__CCS_REDACTED__',
          },
        },
      })
    );

    expect(result.success).toBe(true);
    expect(result.warnings?.length).toBeGreaterThan(0);

    const settingsPath = path.join(ccsDir, 'redacted-import.settings.json');
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      env: Record<string, string>;
    };
    expect(parsed.env.ANTHROPIC_AUTH_TOKEN).toBe('');
    expect(parsed.env.OPENROUTER_API_KEY).toBe('');
  });
});
