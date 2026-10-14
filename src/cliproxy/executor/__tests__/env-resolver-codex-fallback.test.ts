import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'bun:test';
import { buildClaudeEnvironment } from '../env-resolver';

const tempDirs: string[] = [];

function createCodexSettingsFile(models: {
  defaultModel: string;
  opusModel: string;
  sonnetModel: string;
  haikuModel: string;
}): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-codex-fallback-'));
  tempDirs.push(tempDir);

  const settingsPath = path.join(tempDir, 'codex-test.settings.json');
  fs.writeFileSync(
    settingsPath,
    JSON.stringify(
      {
        env: {
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:8317/api/provider/codex',
          ANTHROPIC_AUTH_TOKEN: 'test-token',
          ANTHROPIC_MODEL: models.defaultModel,
          ANTHROPIC_DEFAULT_OPUS_MODEL: models.opusModel,
          ANTHROPIC_DEFAULT_SONNET_MODEL: models.sonnetModel,
          ANTHROPIC_DEFAULT_HAIKU_MODEL: models.haikuModel,
        },
      },
      null,
      2
    ) + '\n'
  );

  return settingsPath;
}

describe('buildClaudeEnvironment codex fallback normalization', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const tempDir = tempDirs.pop();
      if (tempDir) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  it('normalizes codex effort aliases when reasoning proxy is unavailable', () => {
    const settingsPath = createCodexSettingsFile({
      defaultModel: 'gpt-5.3-codex-high',
      opusModel: 'gpt-5.3-codex-xhigh',
      sonnetModel: 'gpt-5.3-codex-high',
      haikuModel: 'gpt-5.4-mini-medium',
    });

    const env = buildClaudeEnvironment({
      provider: 'codex',
      useRemoteProxy: false,
      localPort: 8317,
      customSettingsPath: settingsPath,
      verbose: false,
    });

    expect(env.ANTHROPIC_MODEL).toBe('gpt-5.3-codex(high)');
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('gpt-5.3-codex(xhigh)');
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('gpt-5.3-codex(high)');
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('gpt-5.4-mini(medium)');
  });

  it('keeps codex effort aliases when reasoning proxy is active', () => {
    const settingsPath = createCodexSettingsFile({
      defaultModel: 'gpt-5.3-codex-high',
      opusModel: 'gpt-5.3-codex-xhigh',
      sonnetModel: 'gpt-5.3-codex-high',
      haikuModel: 'gpt-5.4-mini-medium',
    });

    const env = buildClaudeEnvironment({
      provider: 'codex',
      useRemoteProxy: false,
      localPort: 8317,
      customSettingsPath: settingsPath,
      codexReasoningPort: 9444,
      verbose: false,
    });

    expect(env.ANTHROPIC_MODEL).toBe('gpt-5.3-codex-high');
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('gpt-5.3-codex-xhigh');
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('gpt-5.3-codex-high');
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('gpt-5.4-mini-medium');
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:9444/api/provider/codex');
  });

  it('propagates inherited CLAUDE_CONFIG_DIR when provided', () => {
    const settingsPath = createCodexSettingsFile({
      defaultModel: 'gpt-5.3-codex',
      opusModel: 'gpt-5.3-codex',
      sonnetModel: 'gpt-5.3-codex',
      haikuModel: 'gpt-5-mini',
    });

    const env = buildClaudeEnvironment({
      provider: 'codex',
      useRemoteProxy: false,
      localPort: 8317,
      customSettingsPath: settingsPath,
      claudeConfigDir: '/tmp/.ccs/instances/pro',
      verbose: false,
    });

    expect(env.CLAUDE_CONFIG_DIR).toBe('/tmp/.ccs/instances/pro');
  });
});
