/**
 * Integration tests for the OAuth credential guard wired into the
 * /:provider/start-url route (Phase 3 + Phase 4).
 *
 * The guard table (PLUS_OAUTH_ENV_BY_PROVIDER) is now empty — the binary
 * has built-in OAuth credentials for all providers (Gemini, Antigravity, etc.).
 * CCS no longer needs to check for env vars; it proxies directly to the binary
 * like the original cliproxyapi-dashboard does.
 *
 * These tests verify that the guard returns null for all providers.
 */

import { describe, expect, it } from 'bun:test';

// ---------------------------------------------------------------------------
// Phase 3: pre-fetch credential guard (getPlusOAuthCredentialError)
// ---------------------------------------------------------------------------

describe('start-url route: Phase 3 pre-fetch credential guard', () => {
  it('returns null for gemini on plus (guard table is empty — binary has built-in credentials)', async () => {
    const { getPlusOAuthCredentialError } = await import(
      `../../../cliproxy/auth/oauth-handler?route-guard-gemini-${Date.now()}`
    );

    expect(getPlusOAuthCredentialError('gemini', 'plus')).toBeNull();
  });

  it('returns null for agy on plus (guard table is empty — binary has built-in credentials)', async () => {
    const { getPlusOAuthCredentialError } = await import(
      `../../../cliproxy/auth/oauth-handler?route-guard-agy-${Date.now()}`
    );

    expect(getPlusOAuthCredentialError('agy', 'plus')).toBeNull();
  });

  it('returns null for ghcp on plus (not in guard table)', async () => {
    const { getPlusOAuthCredentialError } = await import(
      `../../../cliproxy/auth/oauth-handler?route-guard-ghcp-${Date.now()}`
    );

    expect(getPlusOAuthCredentialError('ghcp', 'plus')).toBeNull();
  });

  it('returns null for gemini when backend is original', async () => {
    const { getPlusOAuthCredentialError } = await import(
      `../../../cliproxy/auth/oauth-handler?route-guard-gemini-original-${Date.now()}`
    );

    expect(getPlusOAuthCredentialError('gemini', 'original', {})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 4: post-fetch auth-URL guard (getPlusAuthUrlCredentialError)
// ---------------------------------------------------------------------------

describe('start-url route: Phase 4 post-fetch auth-URL guard', () => {
  it('returns null for gemini (guard table is empty — binary has built-in credentials)', async () => {
    const { getPlusAuthUrlCredentialError } = await import(
      `../../../cliproxy/auth/oauth-handler?route-url-guard-gemini-${Date.now()}`
    );

    const anyUrl = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=&state=abc';
    expect(getPlusAuthUrlCredentialError('gemini', anyUrl)).toBeNull();
  });

  it('returns null for agy (guard table is empty — binary has built-in credentials)', async () => {
    const { getPlusAuthUrlCredentialError } = await import(
      `../../../cliproxy/auth/oauth-handler?route-url-guard-agy-${Date.now()}`
    );

    const anyUrl = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=&state=abc';
    expect(getPlusAuthUrlCredentialError('agy', anyUrl)).toBeNull();
  });

  it('returns null for ghcp (not in guard table) even with empty client_id', async () => {
    const { getPlusAuthUrlCredentialError } = await import(
      `../../../cliproxy/auth/oauth-handler?route-url-guard-ghcp-${Date.now()}`
    );

    const anyUrl = 'https://example.com/oauth?client_id=&state=abc';
    expect(getPlusAuthUrlCredentialError('ghcp', anyUrl)).toBeNull();
  });

  it('returns null for malformed authUrl (guard must not throw)', async () => {
    const { getPlusAuthUrlCredentialError } = await import(
      `../../../cliproxy/auth/oauth-handler?route-url-guard-malformed-${Date.now()}`
    );

    expect(getPlusAuthUrlCredentialError('gemini', 'not-a-url')).toBeNull();
    expect(getPlusAuthUrlCredentialError('gemini', '')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 3+4: HTTP response body contract
// Verifies the exact JSON shape the route would return so the UI hook can
// match on data.error and surface data.message to the user.
// ---------------------------------------------------------------------------

describe('start-url route: response body contract', () => {
  it('UI hook can distinguish credential errors by data.error code', () => {
    const missingCreds = { error: 'plus_oauth_credentials_missing', message: 'Friendly message' };
    const missingUrl = {
      error: 'plus_oauth_url_missing_client_id',
      message: 'Friendly URL message',
    };
    const generic = { error: 'some_other_error' };

    function simulateHookErrorResolution(data: Record<string, unknown>): string {
      const isPlusCredentialError =
        data.error === 'plus_oauth_credentials_missing' ||
        data.error === 'plus_oauth_url_missing_client_id';
      return isPlusCredentialError && typeof data.message === 'string'
        ? data.message
        : typeof data.error === 'string'
          ? data.error
          : 'Unknown error';
    }

    expect(simulateHookErrorResolution(missingCreds)).toBe('Friendly message');
    expect(simulateHookErrorResolution(missingUrl)).toBe('Friendly URL message');
    expect(simulateHookErrorResolution(generic)).toBe('some_other_error');
  });
});

describe('status route: duplicate completion polling', () => {
  it('returns the completed account again for duplicate polls after state cleanup', async () => {
    const authRoutes = await import(
      `../cliproxy-auth-routes?duplicate-status-${Date.now()}`
    );
    const account = {
      id: 'newtrial530@gmail.com',
      email: 'newtrial530@gmail.com',
      nickname: undefined,
      provider: 'agy' as const,
      isDefault: false,
    };

    expect(authRoutes.getCompletedManualAuthState('state-123')).toBeNull();
    authRoutes.rememberCompletedManualAuthState('state-123', account);

    expect(authRoutes.getCompletedManualAuthState('state-123')).toEqual({
      status: 'ok',
      account,
    });
  });
});
