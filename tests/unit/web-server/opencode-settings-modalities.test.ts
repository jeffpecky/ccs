import { describe, expect, it } from 'bun:test';
import {
  buildOpenCodeModel,
  buildOpenCodeSettings,
  normalizeOpenCodeModels,
} from '../../../src/web-server/routes/opencode-settings-route';

describe('OpenCode model modalities', () => {
  it('advertises image input for custom routed model IDs', () => {
    expect(buildOpenCodeModel('gpt-5.6-sol')).toEqual({
      name: 'gpt-5.6-sol',
      modalities: {
        input: ['text', 'image'],
        output: ['text'],
      },
    });
  });
});

describe('OpenCode multi-model settings', () => {
  it('normalizes unique selected models and keeps a valid active model', () => {
    expect(normalizeOpenCodeModels(['model-a', ' model-b ', 'model-a', ''], 'missing')).toEqual({
      models: ['model-a', 'model-b'],
      activeModel: 'model-a',
    });
  });

  it('replaces stale CCS models while preserving unrelated OpenCode settings', () => {
    const existing = {
      theme: 'dark',
      provider: {
        other: { models: { untouched: {} } },
        ccs: { options: { old: true }, models: { stale: {} } },
      },
    };

    expect(
      buildOpenCodeSettings(existing, {
        baseUrl: 'http://127.0.0.1:8317/v1',
        apiKey: 'key',
        models: ['model-a', 'model-b'],
        activeModel: 'model-b',
        subagentModel: 'model-c',
      })
    ).toEqual({
      theme: 'dark',
      model: 'ccs/model-b',
      provider: {
        other: { models: { untouched: {} } },
        ccs: {
          npm: '@ai-sdk/openai-compatible',
          name: 'CCS',
          options: { baseURL: 'http://127.0.0.1:8317/v1', apiKey: 'key' },
          models: {
            'model-a': buildOpenCodeModel('model-a'),
            'model-b': buildOpenCodeModel('model-b'),
            'model-c': buildOpenCodeModel('model-c'),
          },
        },
      },
      agent: {
        explorer: {
          description: 'Fast explorer subagent for codebase navigation',
          mode: 'subagent',
          model: 'ccs/model-c',
        },
      },
    });
  });
});
