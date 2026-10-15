import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createApiProfile } from '../../../src/api/services/profile-writer';

describe('profile-writer Anthropic direct', () => {
  let tempHome = '';
  let originalCcsHome: string | undefined;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-profile-writer-'));
    originalCcsHome = process.env.CCS_HOME;
    process.env.CCS_HOME = tempHome;
  });

  afterEach(() => {
    mock.restore();

    if (originalCcsHome === undefined) {
      delete process.env.CCS_HOME;
    } else {
      process.env.CCS_HOME = originalCcsHome;
    }

    if (tempHome && fs.existsSync(tempHome)) {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('creates native env structure for sk-ant- API key', () => {
    const result = createApiProfile(
      'anthropic-test',
      '',
      'sk-ant-api03-testkey123',
      { default: 'claude-sonnet-4-5-20250929', opus: 'claude-opus-4-5-20251101', sonnet: 'claude-sonnet-4-5-20250929', haiku: 'claude-haiku-4-5-20251001' }
    );

    expect(result.success).toBe(true);

    const settingsPath = path.join(tempHome, '.ccs', 'anthropic-test.settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

    // Native mode: ANTHROPIC_API_KEY present, no BASE_URL or AUTH_TOKEN
    expect(settings.env.ANTHROPIC_API_KEY).toBe('sk-ant-api03-testkey123');
    expect(settings.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(settings.env.ANTHROPIC_MODEL).toBe('claude-sonnet-4-5-20250929');
  });

  it('creates native env structure for api.anthropic.com URL', () => {
    const result = createApiProfile(
      'anthropic-url',
      'https://api.anthropic.com',
      'some-key-123',
      { default: 'claude-sonnet-4-5-20250929', opus: 'claude-sonnet-4-5-20250929', sonnet: 'claude-sonnet-4-5-20250929', haiku: 'claude-sonnet-4-5-20250929' }
    );

    expect(result.success).toBe(true);

    const settingsPath = path.join(tempHome, '.ccs', 'anthropic-url.settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

    expect(settings.env.ANTHROPIC_API_KEY).toBe('some-key-123');
    expect(settings.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  it('creates proxy env structure for non-Anthropic keys', () => {
    const result = createApiProfile(
      'proxy-test',
      'https://api.z.ai/api/anthropic',
      'ghp_testkey123',
      { default: 'glm-5', opus: 'glm-5', sonnet: 'glm-5', haiku: 'glm-5' }
    );

    expect(result.success).toBe(true);

    const settingsPath = path.join(tempHome, '.ccs', 'proxy-test.settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

    // Proxy mode: BASE_URL + AUTH_TOKEN, no ANTHROPIC_API_KEY
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('https://api.z.ai/api/anthropic');
    expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBe('ghp_testkey123');
    expect(settings.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('persists droid as the saved target for generic API profiles', () => {
    const result = createApiProfile(
      'hf-target',
      'https://router.huggingface.co/v1',
      'hf_testkey123',
      {
        default: 'openai/gpt-oss-120b:fastest',
        opus: 'openai/gpt-oss-120b:fastest',
        sonnet: 'openai/gpt-oss-120b:fastest',
        haiku: 'openai/gpt-oss-120b:fastest',
      },
      'droid'
    );

    expect(result.success).toBe(true);

    const configPath = path.join(tempHome, '.ccs', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    expect(config.profiles['hf-target']).toBe('~/.ccs/hf-target.settings.json');
    expect(config.profile_targets['hf-target']).toBe('droid');
  });

  it('does not persist a non-default target entry when the target is claude', () => {
    const result = createApiProfile(
      'hf-target-claude',
      'https://router.huggingface.co/v1',
      'hf_testkey123',
      {
        default: 'openai/gpt-oss-120b:fastest',
        opus: 'openai/gpt-oss-120b:fastest',
        sonnet: 'openai/gpt-oss-120b:fastest',
        haiku: 'openai/gpt-oss-120b:fastest',
      },
      'claude'
    );

    expect(result.success).toBe(true);

    const configPath = path.join(tempHome, '.ccs', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    expect(config.profiles['hf-target-claude']).toBe('~/.ccs/hf-target-claude.settings.json');
    expect(config.profile_targets?.['hf-target-claude']).toBeUndefined();
  });

  it('preserves OpenRouter ANTHROPIC_API_KEY blank behavior', () => {
    const result = createApiProfile(
      'openrouter-test',
      'https://openrouter.ai/api/v1',
      'sk-or-testkey',
      { default: 'anthropic/claude-opus-4.5', opus: 'anthropic/claude-opus-4.5', sonnet: 'anthropic/claude-opus-4.5', haiku: 'anthropic/claude-opus-4.5' }
    );

    expect(result.success).toBe(true);

    const settingsPath = path.join(tempHome, '.ccs', 'openrouter-test.settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

    // OpenRouter: proxy mode with ANTHROPIC_API_KEY explicitly blank
    expect(settings.env.ANTHROPIC_BASE_URL).toBe('https://openrouter.ai/api/v1');
    expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-or-testkey');
    expect(settings.env.ANTHROPIC_API_KEY).toBe('');
  });

  // NOTE: two WebSearch-setup rollback tests were removed: the WebSearch hook
  // feature was stripped from this fork in a36a1238. Re-add if it returns.

});
