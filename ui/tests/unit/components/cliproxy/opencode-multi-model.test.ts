import { describe, expect, it } from 'vitest';

import {
  normalizeSelectedOpenCodeModels,
  removeSelectedOpenCodeModel,
} from '@/components/cliproxy/cli-provider-editor/use-opencode-editor';

describe('OpenCode multi-model state', () => {
  it('migrates legacy active model into selected models', () => {
    expect(normalizeSelectedOpenCodeModels(undefined, 'model-a')).toEqual(['model-a']);
  });

  it('normalizes unique selected models', () => {
    expect(normalizeSelectedOpenCodeModels(['model-a', ' model-b ', 'model-a'], 'model-c')).toEqual(
      ['model-a', 'model-b']
    );
  });

  it('moves active model to first remaining model after removal', () => {
    expect(removeSelectedOpenCodeModel(['model-a', 'model-b'], 'model-a', 'model-a')).toEqual({
      models: ['model-b'],
      activeModel: 'model-b',
      subagentModel: 'model-b',
    });
  });

  it('allows removing final model and clears dependent selections', () => {
    expect(removeSelectedOpenCodeModel(['model-a'], 'model-a', 'model-a')).toEqual({
      models: [],
      activeModel: '',
      subagentModel: '',
    });
  });
});
