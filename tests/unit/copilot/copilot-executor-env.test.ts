import { describe, expect, it } from 'bun:test';
import { generateCopilotEnv } from '../../../src/copilot/copilot-executor';
import type { CopilotConfig } from '../../../src/config/unified-config-types';

const baseConfig: CopilotConfig = {
  enabled: true,
  auto_start: false,
  port: 4141,
  account_type: 'individual',
  rate_limit: null,
  wait_on_limit: true,
  model: 'gpt-4.1',
};

describe('generateCopilotEnv', () => {
  it('normalizes deprecated raptor-mini model selections to the safe default', () => {
    const env = generateCopilotEnv({
      ...baseConfig,
      model: 'raptor-mini',
      opus_model: 'raptor-mini',
      sonnet_model: 'raptor-mini',
      haiku_model: 'raptor-mini',
    });

    expect(env.ANTHROPIC_MODEL).toBe('gpt-4.1');
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('gpt-4.1');
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('gpt-4.1');
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('gpt-4.1');
    expect(env.ANTHROPIC_SMALL_FAST_MODEL).toBe('gpt-4.1');
  });

  it('falls back deprecated haiku overrides to the selected base model', () => {
    const env = generateCopilotEnv({
      ...baseConfig,
      model: 'claude-sonnet-4.5',
      haiku_model: 'raptor-mini',
    });

    expect(env.ANTHROPIC_MODEL).toBe('claude-sonnet-4.5');
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('claude-sonnet-4.5');
    expect(env.ANTHROPIC_SMALL_FAST_MODEL).toBe('claude-sonnet-4.5');
  });

  it('includes inherited CLAUDE_CONFIG_DIR when provided', () => {
    const env = generateCopilotEnv(baseConfig, '/tmp/.ccs/instances/pro');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/tmp/.ccs/instances/pro');
  });

  it('omits CLAUDE_CONFIG_DIR when inheritance is not configured', () => {
    const env = generateCopilotEnv(baseConfig);
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
  });
});
