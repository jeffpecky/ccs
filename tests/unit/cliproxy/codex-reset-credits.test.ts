import { describe, expect, it } from 'bun:test';

import {
  consumeCodexResetCredit,
  fetchCodexResetCredits,
} from '../../../src/cliproxy/quota/codex-reset-credits';

describe('Codex reset credits', () => {
  it('normalizes available reset credits', async () => {
    const calls: string[] = [];
    const result = await fetchCodexResetCredits('token-1', async (url) => {
      calls.push(url);
      return new Response(
        JSON.stringify({
          credits: [{ id: 'credit-1', expires_at: '2026-08-24T00:00:00Z' }],
          available_count: 1,
        }),
        { status: 200 }
      );
    });

    expect(calls).toEqual(['https://chatgpt.com/backend-api/wham/rate-limit-reset-credits']);
    expect(result.availableCount).toBe(1);
    expect(result.credits).toEqual([{ id: 'credit-1', expiresAt: '2026-08-24T00:00:00Z' }]);
  });

  it('consumes a reset credit with a server redeem id', async () => {
    const result = await consumeCodexResetCredit('token-1', 'redeem-1', async (_url, init) => {
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe(JSON.stringify({ redeem_request_id: 'redeem-1' }));
      return new Response(JSON.stringify({ code: 'reset', windows_reset: 1 }), { status: 200 });
    });

    expect(result.ok).toBe(true);
    expect(result.windowsReset).toBe(1);
  });
});
