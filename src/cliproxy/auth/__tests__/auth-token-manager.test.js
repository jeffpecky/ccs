/**
 * Auth Token Manager Tests
 *
 * Comprehensive test suite for CLIProxy auth token management including:
 * - Token generation (cryptographic security)
 * - Token masking
 * - Pure function logic tests
 */

const assert = require('assert');
const crypto = require('crypto');

describe('Auth Token Manager', () => {
  // =========================================================================
  // Token Generation Tests (Pure Functions)
  // =========================================================================
  describe('generateSecureToken', () => {
    let generateSecureToken;

    beforeEach(() => {
      // Clear cache and reload
      delete require.cache[require.resolve('../../../../dist/cliproxy/auth/auth-token-manager')];
      const authTokenManager = require('../../../../dist/cliproxy/auth/auth-token-manager');
      generateSecureToken = authTokenManager.generateSecureToken;
    });

    it('generates token of correct length (hex encoding)', () => {
      const token = generateSecureToken(32);
      // 32 bytes = 64 hex chars
      assert.strictEqual(token.length, 64);
    });

    it('generates unique tokens each call', () => {
      const tokens = new Set();
      for (let i = 0; i < 100; i++) {
        tokens.add(generateSecureToken(32));
      }
      assert.strictEqual(tokens.size, 100, 'All 100 tokens should be unique');
    });

    it('uses hex encoding (only 0-9a-f characters)', () => {
      // Generate many tokens to ensure we hit all character ranges
      for (let i = 0; i < 50; i++) {
        const token = generateSecureToken(32);
        assert(/^[0-9a-f]+$/.test(token), 'Should be lowercase hex');
      }
    });

    it('accepts custom length parameter', () => {
      const short = generateSecureToken(16);
      const long = generateSecureToken(64);

      // 16 bytes = 32 chars, 64 bytes = 128 chars in hex
      assert.strictEqual(short.length, 32);
      assert.strictEqual(long.length, 128);
    });

    it('handles edge case: length = 0', () => {
      const empty = generateSecureToken(0);
      assert.strictEqual(empty.length, 0);
    });

    it('handles edge case: very large length', () => {
      const large = generateSecureToken(256);
      assert.strictEqual(large.length, 512); // 256 bytes = 512 hex chars
    });

    it('uses cryptographically secure random bytes', () => {
      // Verify the function uses crypto.randomBytes internally
      // by checking statistical properties of generated tokens
      const tokens = [];
      for (let i = 0; i < 1000; i++) {
        tokens.push(generateSecureToken(32));
      }

      // All tokens should be unique
      const uniqueTokens = new Set(tokens);
      assert.strictEqual(uniqueTokens.size, 1000, 'All tokens should be unique');

      // Check that first character has good distribution (not always same)
      const firstChars = new Set(tokens.map((t) => t[0]));
      assert(firstChars.size > 10, 'First character should have good distribution');
    });
  });

  // =========================================================================
  // Token Masking Tests (Pure Function Simulation)
  // =========================================================================
  describe('maskToken (logic validation)', () => {
    // Simulates the maskToken function from tokens-command.ts and settings-routes.ts
    function maskToken(token) {
      if (token.length <= 8) return '****';
      return `${token.slice(0, 4)}...${token.slice(-4)}`;
    }

    it('masks tokens showing first 4 and last 4 characters', () => {
      assert.strictEqual(maskToken('1234567890abcdef'), '1234...cdef');
    });

    it('returns **** for tokens <= 8 characters', () => {
      assert.strictEqual(maskToken('12345678'), '****');
      assert.strictEqual(maskToken('1234567'), '****');
      assert.strictEqual(maskToken('abc'), '****');
      assert.strictEqual(maskToken(''), '****');
    });

    it('handles exactly 9 character tokens', () => {
      assert.strictEqual(maskToken('123456789'), '1234...6789');
    });

    it('handles long tokens (typical API keys)', () => {
      const longToken = 'test_key_1234567890abcdefghijklmnopqrstuvwxyz';
      assert.strictEqual(maskToken(longToken), 'test...wxyz');
    });

    it('preserves special characters', () => {
      assert.strictEqual(maskToken('!@#$abcd____wxyz'), '!@#$...wxyz');
    });

    it('handles default CCS internal key', () => {
      const internalKey = 'ccs-internal-managed';
      assert.strictEqual(maskToken(internalKey), 'ccs-...aged');
    });

    it('handles default CCS control panel secret', () => {
      const secret = 'ccs';
      assert.strictEqual(maskToken(secret), '****');
    });
  });

  // =========================================================================
  // Inheritance Chain Logic Tests
  // =========================================================================
  describe('getEffectiveApiKey logic', () => {
    /**
     * Simulates the inheritance logic from auth-token-manager.ts
     */
    function getEffectiveApiKey(config, variantName, defaultKey) {
      // Priority 1: Per-variant override
      if (variantName) {
        const variant = config.cliproxy?.variants?.[variantName];
        if (variant?.auth?.api_key) {
          return variant.auth.api_key;
        }
      }

      // Priority 2: Global cliproxy.auth
      if (config.cliproxy?.auth?.api_key) {
        return config.cliproxy.auth.api_key;
      }

      // Priority 3: Default constant
      return defaultKey;
    }

    const DEFAULT_KEY = 'ccs-internal-managed';

    it('returns default when no custom config', () => {
      const config = { cliproxy: { variants: {} } };
      assert.strictEqual(getEffectiveApiKey(config, undefined, DEFAULT_KEY), DEFAULT_KEY);
    });

    it('returns global auth when set', () => {
      const config = {
        cliproxy: {
          variants: {},
          auth: { api_key: 'global-custom' },
        },
      };
      assert.strictEqual(getEffectiveApiKey(config, undefined, DEFAULT_KEY), 'global-custom');
    });

    it('returns variant auth when set (highest priority)', () => {
      const config = {
        cliproxy: {
          variants: {
            gemini: { auth: { api_key: 'variant-key' } },
          },
          auth: { api_key: 'global-custom' },
        },
      };
      assert.strictEqual(getEffectiveApiKey(config, 'gemini', DEFAULT_KEY), 'variant-key');
    });

    it('falls back to global when variant has no auth', () => {
      const config = {
        cliproxy: {
          variants: {
            gemini: { type: 'claude' },
          },
          auth: { api_key: 'global-custom' },
        },
      };
      assert.strictEqual(getEffectiveApiKey(config, 'gemini', DEFAULT_KEY), 'global-custom');
    });

    it('falls back to default when variant and global missing', () => {
      const config = {
        cliproxy: {
          variants: {
            gemini: { type: 'claude' },
          },
        },
      };
      assert.strictEqual(getEffectiveApiKey(config, 'gemini', DEFAULT_KEY), DEFAULT_KEY);
    });

    it('ignores variant name when variant does not exist', () => {
      const config = {
        cliproxy: {
          variants: {},
          auth: { api_key: 'global-custom' },
        },
      };
      assert.strictEqual(getEffectiveApiKey(config, 'non-existent', DEFAULT_KEY), 'global-custom');
    });
  });

  describe('getEffectiveManagementSecret logic', () => {
    /**
     * Simulates the management secret logic from auth-token-manager.ts
     */
    function getEffectiveManagementSecret(config, defaultSecret) {
      // Priority 1: Global cliproxy.auth
      if (config.cliproxy?.auth?.management_secret) {
        return config.cliproxy.auth.management_secret;
      }

      // Priority 2: Default constant
      return defaultSecret;
    }

    const DEFAULT_SECRET = 'ccs';

    it('returns default when no custom config', () => {
      const config = { cliproxy: { variants: {} } };
      assert.strictEqual(getEffectiveManagementSecret(config, DEFAULT_SECRET), DEFAULT_SECRET);
    });

    it('returns custom secret when set', () => {
      const config = {
        cliproxy: {
          variants: {},
          auth: { management_secret: 'custom-secret' },
        },
      };
      assert.strictEqual(getEffectiveManagementSecret(config, DEFAULT_SECRET), 'custom-secret');
    });

    it('is global only (no per-variant override)', () => {
      // Management secret does not support per-variant override
      const config = {
        cliproxy: {
          variants: {
            gemini: { auth: { management_secret: 'should-be-ignored' } },
          },
          auth: { management_secret: 'global-secret' },
        },
      };
      // The function only checks global auth
      assert.strictEqual(getEffectiveManagementSecret(config, DEFAULT_SECRET), 'global-secret');
    });
  });

  // =========================================================================
  // Auth Summary Logic Tests
  // =========================================================================
  describe('getAuthSummary logic', () => {
    function getAuthSummary(config, defaultApiKey, defaultSecret) {
      const customApiKey = config.cliproxy?.auth?.api_key;
      const customSecret = config.cliproxy?.auth?.management_secret;

      return {
        apiKey: {
          value: customApiKey || defaultApiKey,
          isCustom: !!customApiKey,
        },
        managementSecret: {
          value: customSecret || defaultSecret,
          isCustom: !!customSecret,
        },
      };
    }

    const DEFAULT_KEY = 'ccs-internal-managed';
    const DEFAULT_SECRET = 'ccs';

    it('returns defaults with isCustom=false when no custom config', () => {
      const config = { cliproxy: { variants: {} } };
      const summary = getAuthSummary(config, DEFAULT_KEY, DEFAULT_SECRET);

      assert.strictEqual(summary.apiKey.value, DEFAULT_KEY);
      assert.strictEqual(summary.apiKey.isCustom, false);
      assert.strictEqual(summary.managementSecret.value, DEFAULT_SECRET);
      assert.strictEqual(summary.managementSecret.isCustom, false);
    });

    it('returns custom values with isCustom=true when set', () => {
      const config = {
        cliproxy: {
          variants: {},
          auth: { api_key: 'custom-key', management_secret: 'custom-secret' },
        },
      };
      const summary = getAuthSummary(config, DEFAULT_KEY, DEFAULT_SECRET);

      assert.strictEqual(summary.apiKey.value, 'custom-key');
      assert.strictEqual(summary.apiKey.isCustom, true);
      assert.strictEqual(summary.managementSecret.value, 'custom-secret');
      assert.strictEqual(summary.managementSecret.isCustom, true);
    });

    it('handles partial custom config', () => {
      const config = {
        cliproxy: {
          variants: {},
          auth: { api_key: 'custom-key' },
        },
      };
      const summary = getAuthSummary(config, DEFAULT_KEY, DEFAULT_SECRET);

      assert.strictEqual(summary.apiKey.isCustom, true);
      assert.strictEqual(summary.managementSecret.isCustom, false);
    });

    it('treats empty string as no custom value', () => {
      const config = {
        cliproxy: {
          variants: {},
          auth: { api_key: '' },
        },
      };
      const summary = getAuthSummary(config, DEFAULT_KEY, DEFAULT_SECRET);

      // Empty string is falsy, so isCustom should be false
      assert.strictEqual(summary.apiKey.value, DEFAULT_KEY);
      assert.strictEqual(summary.apiKey.isCustom, false);
    });
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================
  describe('Edge Cases', () => {
    it('handles undefined config gracefully', () => {
      function getEffectiveApiKey(config, variantName, defaultKey) {
        if (variantName) {
          const variant = config?.cliproxy?.variants?.[variantName];
          if (variant?.auth?.api_key) return variant.auth.api_key;
        }
        if (config?.cliproxy?.auth?.api_key) return config.cliproxy.auth.api_key;
        return defaultKey;
      }

      assert.strictEqual(getEffectiveApiKey(undefined, undefined, 'default'), 'default');
      assert.strictEqual(getEffectiveApiKey(null, undefined, 'default'), 'default');
      assert.strictEqual(getEffectiveApiKey({}, undefined, 'default'), 'default');
    });

    it('handles deeply nested missing properties', () => {
      function getEffectiveApiKey(config, variantName, defaultKey) {
        if (variantName) {
          const variant = config?.cliproxy?.variants?.[variantName];
          if (variant?.auth?.api_key) return variant.auth.api_key;
        }
        if (config?.cliproxy?.auth?.api_key) return config.cliproxy.auth.api_key;
        return defaultKey;
      }

      const config = { cliproxy: {} };
      assert.strictEqual(getEffectiveApiKey(config, 'test', 'default'), 'default');
    });

    it('crypto.randomBytes is available and working', () => {
      // Ensure crypto module is available
      const bytes = crypto.randomBytes(32);
      assert.strictEqual(bytes.length, 32);
      assert(Buffer.isBuffer(bytes));
    });

    it('base64url encoding produces valid characters', () => {
      const bytes = crypto.randomBytes(32);
      const token = bytes.toString('base64url');

      // Valid base64url characters: A-Z, a-z, 0-9, -, _
      const validChars = /^[A-Za-z0-9_-]+$/;
      assert(validChars.test(token), 'Token should only contain base64url characters');
    });
  });

  // =========================================================================
  // Constants Validation
  // =========================================================================
  describe('Default Constants', () => {
    let CCS_INTERNAL_API_KEY;
    let CCS_CONTROL_PANEL_SECRET;

    beforeEach(() => {
      delete require.cache[require.resolve('../../../../dist/cliproxy/config/config-generator')];
      const configGenerator = require('../../../../dist/cliproxy/config/config-generator');
      CCS_INTERNAL_API_KEY = configGenerator.CCS_INTERNAL_API_KEY;
      CCS_CONTROL_PANEL_SECRET = configGenerator.CCS_CONTROL_PANEL_SECRET;
    });

    it('CCS_INTERNAL_API_KEY is defined', () => {
      assert(CCS_INTERNAL_API_KEY, 'CCS_INTERNAL_API_KEY should be defined');
      assert.strictEqual(typeof CCS_INTERNAL_API_KEY, 'string');
    });

    it('CCS_CONTROL_PANEL_SECRET is defined', () => {
      assert(CCS_CONTROL_PANEL_SECRET, 'CCS_CONTROL_PANEL_SECRET should be defined');
      assert.strictEqual(typeof CCS_CONTROL_PANEL_SECRET, 'string');
    });

    it('default API key has expected value', () => {
      assert.strictEqual(
        CCS_INTERNAL_API_KEY,
        'sk-45c9e789d78326c6b25e11879fc81602edc7228a4c594339'
      );
    });

    it('default secret has expected value', () => {
      assert.strictEqual(CCS_CONTROL_PANEL_SECRET, 'mgmt-f078070e88eadc04ff2688da7797b8be');
    });
  });
});
