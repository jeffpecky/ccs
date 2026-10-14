import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DroidRawSettingsConflictError,
  DroidRawSettingsValidationError,
  getDroidDashboardDiagnostics,
  getDroidRawSettings,
  maskApiKeyPreview,
  resolveDroidConfigPaths,
  saveDroidRawSettings,
  summarizeDroidCustomModels,
} from '../../../src/web-server/services/droid-dashboard-service';

const testRoot = path.join(os.tmpdir(), `ccs-droid-dashboard-test-${Date.now()}`);

beforeEach(() => {
  fs.mkdirSync(testRoot, { recursive: true });
  process.env.CCS_HOME = testRoot;
});

afterEach(() => {
  delete process.env.CCS_HOME;
  if (fs.existsSync(testRoot)) {
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
});

describe('droid-dashboard-service', () => {
  it('resolves droid config paths on unix-like platforms', () => {
    const resolved = resolveDroidConfigPaths({
      platform: 'darwin',
      env: {
        CCS_HOME: '/tmp/ccs-home',
      } as NodeJS.ProcessEnv,
      homeDir: '/Users/tester',
    });

    expect(resolved.settingsPath).toBe(path.join('/tmp/ccs-home', '.factory', 'settings.json'));
    expect(resolved.legacyConfigPath).toBe(path.join('/tmp/ccs-home', '.factory', 'config.json'));
    expect(resolved.settingsDisplayPath).toBe('~/.factory/settings.json');
    expect(resolved.legacyConfigDisplayPath).toBe('~/.factory/config.json');
  });

  it('resolves droid config paths on windows platforms', () => {
    const resolved = resolveDroidConfigPaths({
      platform: 'win32',
      env: {} as NodeJS.ProcessEnv,
      homeDir: 'C:/Users/test',
    });

    expect(resolved.settingsPath).toBe(path.join('C:/Users/test', '.factory', 'settings.json'));
    expect(resolved.legacyConfigPath).toBe(path.join('C:/Users/test', '.factory', 'config.json'));
    expect(resolved.legacyConfigDisplayPath).toBe('~/.factory/config.json');
  });

  it('masks api key preview with only suffix', () => {
    expect(maskApiKeyPreview('sk-abcdefghijklmnop')).toBe('***mnop');
  });

  it('summarizes custom model entries with provider breakdown and ownership', () => {
    const summary = summarizeDroidCustomModels([
      {
        displayName: 'CCS codex',
        model: 'gpt-5-codex',
        baseUrl: 'http://127.0.0.1:8317/v1',
        apiKey: 'secret-token-1234',
        provider: 'openai',
      },
      {
        displayName: 'Factory team profile',
        model: 'claude-sonnet-4-5',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'another-token-9999',
        provider: 'anthropic',
      },
      {
        displayName: 'bad entry',
      },
    ]);

    expect(summary.customModelCount).toBe(2);
    expect(summary.ccsManagedCount).toBe(1);
    expect(summary.userManagedCount).toBe(1);
    expect(summary.invalidModelEntryCount).toBe(1);
    expect(summary.providerBreakdown.openai).toBe(1);
    expect(summary.providerBreakdown.anthropic).toBe(1);
    expect(summary.customModels[0].apiKeyPreview).toBe('***1234');
  });

  it('supports legacy snake_case model fields in summaries', () => {
    const summary = summarizeDroidCustomModels([
      {
        model_display_name: 'Kimi K2 Thinking Nvidia',
        model: 'moonshotai/kimi-k2-thinking',
        base_url: 'https://integrate.api.nvidia.com/v1',
        api_key: 'legacy-token-1234',
        provider: 'generic-chat-completion-api',
        max_tokens: 220000,
      },
    ]);

    expect(summary.customModelCount).toBe(1);
    expect(summary.invalidModelEntryCount).toBe(0);
    expect(summary.providerBreakdown['generic-chat-completion-api']).toBe(1);
    expect(summary.customModels[0].displayName).toBe('Kimi K2 Thinking Nvidia');
    expect(summary.customModels[0].maxOutputTokens).toBe(220000);
    expect(summary.customModels[0].apiKeyPreview).toBe('***1234');
  });

  it('returns raw settings payload for missing settings file', async () => {
    const raw = await getDroidRawSettings();

    expect(raw.exists).toBe(false);
    expect(raw.path).toBe('~/.factory/settings.json');
    expect(raw.rawText).toBe('{}');
    expect(raw.settings).toBeNull();
  });

  it('returns parseError when settings.json is invalid JSON', async () => {
    const settingsDir = path.join(testRoot, '.factory');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(settingsDir, 'settings.json'), '{ invalid-json');

    const raw = await getDroidRawSettings();

    expect(raw.exists).toBe(true);
    expect(raw.parseError).toBeString();
    expect(raw.settings).toBeNull();
    expect(raw.rawText).toContain('invalid-json');
  });

  it(
    'includes structured docs links for fact-checking providers',
    async () => {
      const diagnostics = await getDroidDashboardDiagnostics();

      expect(diagnostics.docsReference.links.length).toBeGreaterThan(0);
      expect(diagnostics.docsReference.providerDocs.length).toBeGreaterThan(0);
      expect(diagnostics.docsReference.links.every((link) => link.url.startsWith('https://'))).toBe(
        true
      );
      expect(
        diagnostics.docsReference.providerDocs.some((doc) => doc.provider === 'anthropic')
      ).toBe(true);
    },
    10000
  );

  it('falls back to legacy config custom_models when settings customModels is absent', async () => {
    const settingsDir = path.join(testRoot, '.factory');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(settingsDir, 'settings.json'), JSON.stringify({ model: 'custom:legacy' }));
    fs.writeFileSync(
      path.join(settingsDir, 'config.json'),
      JSON.stringify({
        custom_models: [
          {
            model_display_name: 'Legacy OpenAI',
            model: 'gpt-5.2',
            base_url: 'https://api.openai.com/v1',
            api_key: 'legacy-openai-1234',
            provider: 'openai',
          },
        ],
      })
    );

    const diagnostics = await getDroidDashboardDiagnostics();

    expect(diagnostics.byok.customModelCount).toBe(1);
    expect(diagnostics.byok.customModels[0].displayName).toBe('Legacy OpenAI');
    expect(diagnostics.byok.customModels[0].provider).toBe('openai');
  });

  it('warns when settings.json uses legacy custom_models key', async () => {
    const settingsDir = path.join(testRoot, '.factory');
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(settingsDir, 'settings.json'),
      JSON.stringify({
        custom_models: [
          {
            model_display_name: 'Legacy Generic',
            model: 'glm-4.7',
            base_url: 'https://api.z.ai/api/coding/paas/v4',
            api_key: 'legacy-zai-1234',
            provider: 'generic-chat-completion-api',
          },
        ],
      })
    );

    const diagnostics = await getDroidDashboardDiagnostics();

    expect(
      diagnostics.warnings.some((warning) => warning.includes('legacy "custom_models" key'))
    ).toBe(true);
    expect(diagnostics.byok.customModelCount).toBe(1);
  });

  it('saves valid raw settings content', async () => {
    const result = await saveDroidRawSettings({
      rawText: JSON.stringify({
        model: 'custom:test-model',
        customModels: [],
      }),
    });

    const settingsPath = path.join(testRoot, '.factory', 'settings.json');
    const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

    expect(result.success).toBe(true);
    expect(result.mtime).toBeGreaterThan(0);
    expect(written.model).toBe('custom:test-model');
  });

  it('rejects invalid JSON while saving raw settings', async () => {
    await expect(saveDroidRawSettings({ rawText: '{ invalid-json' })).rejects.toThrow(
      DroidRawSettingsValidationError
    );
  });

  it('rejects stale writes with conflict error', async () => {
    const settingsDir = path.join(testRoot, '.factory');
    fs.mkdirSync(settingsDir, { recursive: true });
    const settingsPath = path.join(settingsDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ customModels: [] }));

    await expect(
      saveDroidRawSettings({
        rawText: JSON.stringify({ model: 'custom:next', customModels: [] }),
        expectedMtime: 1,
      })
    ).rejects.toThrow(DroidRawSettingsConflictError);
  });
});
