import { describe, expect, it } from 'bun:test';
import { buildOpenCodeModel } from '../../../src/web-server/routes/opencode-settings-route';

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
