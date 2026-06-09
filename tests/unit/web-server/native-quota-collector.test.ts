/**
 * Tests for the native subscription quota collector.
 *
 * The Anthropic fetch is ALWAYS mocked — these tests NEVER hit the live usage
 * endpoint. A controllable clock drives TTL / backoff / breaker assertions.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import {
  getNativeAccountRows,
  resetNativeQuotaState,
  type NativeQuotaDeps,
} from '../../../src/web-server/usage/native-quota-collector';
import type { ClaudeQuotaResult } from '../../../src/cliproxy/quota/quota-types';
import type { ClaudeNativeCredentials } from '../../../src/web-server/usage/claude-native-credentials';

// A jump comfortably past any single-call backoff cooldown (<= 60s), used so a
// breaker-test fetch is not blocked by the prior 429's per-call cooldown.
const MAX_COOLDOWN_JUMP = 61_000;

function maxCreds(): ClaudeNativeCredentials {
  return { claudeAiOauth: { accessToken: 'native-tok', subscriptionType: 'max' } };
}

function successQuota(): ClaudeQuotaResult {
  return {
    success: true,
    windows: [],
    coreUsage: {
      fiveHour: {
        rateLimitType: 'five_hour',
        label: 'Session limit',
        remainingPercent: 42,
        resetAt: '2026-06-09T20:00:00.000Z',
        status: 'allowed',
      },
      weekly: {
        rateLimitType: 'seven_day',
        label: 'Weekly limit',
        remainingPercent: 70,
        resetAt: '2026-06-15T00:00:00.000Z',
        status: 'allowed',
      },
    },
    lastUpdated: Date.now(),
    accountId: 'claude-code',
  };
}

function reauthQuota(): ClaudeQuotaResult {
  return {
    success: false,
    windows: [],
    coreUsage: { fiveHour: null, weekly: null },
    lastUpdated: Date.now(),
    accountId: 'claude-code',
    needsReauth: true,
    error: 'Authentication required',
  };
}

function rateLimitedQuota(retryAfter?: string): ClaudeQuotaResult {
  return {
    success: false,
    windows: [],
    coreUsage: { fiveHour: null, weekly: null },
    lastUpdated: Date.now(),
    accountId: 'claude-code',
    httpStatus: 429,
    retryable: true,
    ...(retryAfter ? { errorDetail: `retry-after:${retryAfter}` } : {}),
    error: 'rate limited',
  };
}

/** Build a deps object with a controllable clock + counted fetch. */
function makeDeps(
  fetchImpl: (token: string) => Promise<ClaudeQuotaResult>,
  clock: { now: number },
  credsImpl: () => ClaudeNativeCredentials | null = maxCreds
): NativeQuotaDeps & { fetchCount: () => number } {
  let count = 0;
  return {
    readCredentials: credsImpl,
    fetchClaudeQuota: async (token: string) => {
      count += 1;
      return fetchImpl(token);
    },
    getCodexQuota: async () => null,
    now: () => clock.now,
    sleep: async () => {},
    fetchCount: () => count,
  };
}

beforeEach(() => {
  resetNativeQuotaState();
});

describe('Claude native row mapping', () => {
  it('maps a successful fetch into a claude-code ok row with min remaining', async () => {
    const clock = { now: 1_000_000 };
    const deps = makeDeps(async () => successQuota(), clock);
    const rows = await getNativeAccountRows(deps);

    const row = rows.find((r) => r.provider === 'claude-code');
    expect(row).toBeDefined();
    expect(row?.quotaStatus).toBe('ok');
    // min(42, 70)
    expect(row?.quota_percentage).toBe(42);
    expect(row?.next_reset).toBe('2026-06-09T20:00:00.000Z');
    expect(row?.tier).toBe('max');
    expect(row?.displayName).toBe('Claude Code');
    expect(row?.account_id).toBe('claude-code');
    expect(row?.needsReauth).toBe(false);
  });

  it('emits a reauth error row on 401/needsReauth', async () => {
    const clock = { now: 1_000_000 };
    const deps = makeDeps(async () => reauthQuota(), clock);
    const rows = await getNativeAccountRows(deps);
    const row = rows.find((r) => r.provider === 'claude-code');
    expect(row?.quotaStatus).toBe('error');
    expect(row?.health).toBe('error');
    expect(row?.needsReauth).toBe(true);
  });

  it('omits the claude row when there is no token', async () => {
    const clock = { now: 1_000_000 };
    const deps = makeDeps(
      async () => successQuota(),
      clock,
      () => null
    );
    const rows = await getNativeAccountRows(deps);
    expect(rows.find((r) => r.provider === 'claude-code')).toBeUndefined();
  });

  it('omits the claude row for an unsupported (free) subscription without spending a call', async () => {
    const clock = { now: 1_000_000 };
    const deps = makeDeps(
      async () => successQuota(),
      clock,
      () => ({
        claudeAiOauth: { accessToken: 'x', subscriptionType: 'free' },
      })
    );
    const rows = await getNativeAccountRows(deps);
    expect(rows.find((r) => r.provider === 'claude-code')).toBeUndefined();
    expect(deps.fetchCount()).toBe(0);
  });
});

describe('cache / TTL', () => {
  it('serves cache within TTL and does NOT re-fetch', async () => {
    const clock = { now: 1_000_000 };
    const deps = makeDeps(async () => successQuota(), clock);

    await getNativeAccountRows(deps);
    expect(deps.fetchCount()).toBe(1);

    // Advance < 10 min: still cached.
    clock.now += 5 * 60 * 1000;
    const rows = await getNativeAccountRows(deps);
    expect(deps.fetchCount()).toBe(1);
    expect(rows.find((r) => r.provider === 'claude-code')?.cached).toBe(true);
  });

  it('re-fetches after the TTL expires', async () => {
    const clock = { now: 1_000_000 };
    const deps = makeDeps(async () => successQuota(), clock);

    await getNativeAccountRows(deps);
    clock.now += 11 * 60 * 1000; // past 10-min TTL
    await getNativeAccountRows(deps);
    expect(deps.fetchCount()).toBe(2);
  });
});

describe('in-flight coalescing', () => {
  it('shares ONE fetch across concurrent callers past TTL', async () => {
    const clock = { now: 1_000_000 };
    let resolveFetch: (q: ClaudeQuotaResult) => void = () => {};
    const gate = new Promise<ClaudeQuotaResult>((resolve) => {
      resolveFetch = resolve;
    });
    const deps = makeDeps(async () => gate, clock);

    const p1 = getNativeAccountRows(deps);
    const p2 = getNativeAccountRows(deps);
    resolveFetch(successQuota());
    await Promise.all([p1, p2]);

    expect(deps.fetchCount()).toBe(1);
  });
});

describe('Retry-After + backoff + circuit breaker', () => {
  it('honors Retry-After: no fetch until the cooldown elapses', async () => {
    const t0 = 1_000_000;
    const clock = { now: t0 };
    const deps = makeDeps(async () => rateLimitedQuota('30'), clock);

    await getNativeAccountRows(deps); // fetch #1 -> 429, cooldown = t0 + 30s
    expect(deps.fetchCount()).toBe(1);

    // Within the 30s Retry-After cooldown -> zero network even though there is
    // no cached row yet.
    clock.now = t0 + 10_000;
    await getNativeAccountRows(deps);
    expect(deps.fetchCount()).toBe(1);

    // Past the 30s cooldown -> a fetch is allowed again.
    clock.now = t0 + 31_000;
    await getNativeAccountRows(deps);
    expect(deps.fetchCount()).toBe(2);
  });

  it('trips the breaker after 3 consecutive 429s, then a success closes it', async () => {
    const clock = { now: 1_000_000 };
    let mode: 'fail' | 'ok' = 'fail';
    const deps = makeDeps(
      async () => (mode === 'fail' ? rateLimitedQuota() : successQuota()),
      clock
    );

    // Three 429s; each separated past the per-call cooldown so they actually fetch.
    for (let i = 0; i < 3; i++) {
      await getNativeAccountRows(deps);
      // jump past TTL and any backoff cooldown
      clock.now += 11 * 60 * 1000 + MAX_COOLDOWN_JUMP;
    }
    expect(deps.fetchCount()).toBe(3);

    // Breaker is open now -> zero network even past TTL.
    await getNativeAccountRows(deps);
    expect(deps.fetchCount()).toBe(3);

    // Advance past the 15-min breaker cooldown; allow a success which closes it.
    clock.now += 16 * 60 * 1000;
    mode = 'ok';
    await getNativeAccountRows(deps);
    expect(deps.fetchCount()).toBe(4);

    // After success, breaker closed: another fetch past TTL proceeds.
    clock.now += 11 * 60 * 1000;
    await getNativeAccountRows(deps);
    expect(deps.fetchCount()).toBe(5);
  });
});

describe('stale-on-fail', () => {
  it('returns the last good row when a subsequent fetch rejects', async () => {
    const clock = { now: 1_000_000 };
    let mode: 'ok' | 'throw' = 'ok';
    const deps = makeDeps(async () => {
      if (mode === 'throw') throw new Error('network down');
      return successQuota();
    }, clock);

    await getNativeAccountRows(deps); // good row cached
    mode = 'throw';
    clock.now += 11 * 60 * 1000; // force re-fetch
    const rows = await getNativeAccountRows(deps);
    const row = rows.find((r) => r.provider === 'claude-code');
    expect(row).toBeDefined();
    expect(row?.quotaStatus).toBe('ok');
    expect(row?.cached).toBe(true);
  });

  it('omits the row when the first-ever fetch fails (no prior cache)', async () => {
    const clock = { now: 1_000_000 };
    const deps = makeDeps(async () => {
      throw new Error('network down');
    }, clock);
    const rows = await getNativeAccountRows(deps);
    expect(rows.find((r) => r.provider === 'claude-code')).toBeUndefined();
  });
});

describe('Codex path', () => {
  it('maps a local Codex quota into a codex ok row', async () => {
    const clock = { now: 1_000_000 };
    const deps: NativeQuotaDeps = {
      readCredentials: () => null, // no claude row
      getCodexQuota: async () => ({
        quotaPercentage: 52,
        nextReset: '2026-06-09T19:00:00.000Z',
        tier: 'pro',
        stale: false,
      }),
      now: () => clock.now,
    };
    const rows = await getNativeAccountRows(deps);
    const row = rows.find((r) => r.provider === 'codex');
    expect(row?.quotaStatus).toBe('ok');
    expect(row?.quota_percentage).toBe(52);
    expect(row?.tier).toBe('pro');
    expect(row?.health).toBe('ok');
  });

  it('flags health warning when the Codex source is stale', async () => {
    const clock = { now: 1_000_000 };
    const deps: NativeQuotaDeps = {
      readCredentials: () => null,
      getCodexQuota: async () => ({
        quotaPercentage: 10,
        nextReset: null,
        tier: null,
        stale: true,
      }),
      now: () => clock.now,
    };
    const rows = await getNativeAccountRows(deps);
    expect(rows.find((r) => r.provider === 'codex')?.health).toBe('warning');
  });

  it('omits the codex row when there is no rate_limits (exec-mode)', async () => {
    const clock = { now: 1_000_000 };
    const deps: NativeQuotaDeps = {
      readCredentials: () => null,
      getCodexQuota: async () => null,
      now: () => clock.now,
    };
    const rows = await getNativeAccountRows(deps);
    expect(rows.find((r) => r.provider === 'codex')).toBeUndefined();
  });
});
