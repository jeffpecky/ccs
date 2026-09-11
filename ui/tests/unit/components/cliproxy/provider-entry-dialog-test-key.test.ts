import { describe, expect, it } from 'vitest';

import { getProviderTestApiKey } from '@/components/cliproxy/ai-providers/provider-entry-dialog';

describe('provider test key selection', () => {
  it('uses first entered connector key for OpenAI-compatible tests', () => {
    expect(getProviderTestApiKey(true, '', ' first-key \nsecond-key')).toBe('first-key');
  });

  it('uses single key for non-connector providers', () => {
    expect(getProviderTestApiKey(false, ' single-key ', 'connector-key')).toBe('single-key');
  });
});
