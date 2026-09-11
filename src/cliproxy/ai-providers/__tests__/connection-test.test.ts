import { describe, expect, it } from 'bun:test';

import { testAiProviderConnection } from '../service';

describe('AI provider connection tests', () => {
  it('rejects OpenAI-compatible tests without a key before fetching', async () => {
    const result = await testAiProviderConnection({
      family: 'openai-compatibility',
      baseUrl: 'https://example.invalid/v1',
    });
    expect(result).toEqual({
      success: false,
      message: 'API key is required for testing connection',
    });
  });
});
