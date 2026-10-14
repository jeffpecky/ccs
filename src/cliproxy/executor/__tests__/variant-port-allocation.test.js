/**
 * Variant Port Allocation Tests
 *
 * Tests for port allocation logic in variant-config-adapter.ts.
 * Verifies unique port assignment (8318-8417) for CLIProxy variants.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Set test isolation environment before importing
const testHome = path.join(
  os.tmpdir(),
  `ccs-test-port-${Date.now()}-${Math.random().toString(36).slice(2)}`
);
process.env.CCS_HOME = testHome;

const {
  getNextAvailablePort,
  VARIANT_PORT_BASE,
  VARIANT_PORT_MAX_OFFSET,
  listVariantsFromConfig,
  saveVariantLegacy,
  removeVariantFromLegacyConfig,
} = require('../../../../dist/cliproxy/services/variant-config-adapter');
const { CLIPROXY_DEFAULT_PORT } = require('../../../../dist/cliproxy/config/config-generator');

describe('Variant Port Allocation', function () {
  let configPath;

  beforeEach(function () {
    // Create test directories
    const ccsDir = path.join(testHome, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });
    configPath = path.join(ccsDir, 'config.json');

    // Start with empty config
    fs.writeFileSync(configPath, JSON.stringify({ profiles: {} }));
  });

  afterEach(function () {
    // Clean up config file
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
  });

  afterAll(function () {
    // Clean up test directory
    try {
      fs.rmSync(testHome, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    delete process.env.CCS_HOME;
  });

  describe('Constants', function () {
    it('VARIANT_PORT_BASE equals CLIPROXY_DEFAULT_PORT + 1 (8318)', function () {
      assert.strictEqual(VARIANT_PORT_BASE, CLIPROXY_DEFAULT_PORT + 1);
      assert.strictEqual(VARIANT_PORT_BASE, 8318);
    });

    it('VARIANT_PORT_MAX_OFFSET equals 100 (ports 8318-8417)', function () {
      assert.strictEqual(VARIANT_PORT_MAX_OFFSET, 100);
    });
  });

  describe('getNextAvailablePort - Basic Allocation', function () {
    it('returns VARIANT_PORT_BASE (8318) when no variants exist', function () {
      const port = getNextAvailablePort();
      assert.strictEqual(port, VARIANT_PORT_BASE);
      assert.strictEqual(port, 8318);
    });

    it('returns next available port when some ports used', function () {
      // Create variant on first port
      const settingsPath = path.join(testHome, '.ccs', 'test1.settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({ env: {} }));
      saveVariantLegacy('test1', 'gemini', settingsPath, undefined, 8318);

      const port = getNextAvailablePort();
      assert.strictEqual(port, 8319);
    });

    it('skips used ports and returns first gap', function () {
      const ccsDir = path.join(testHome, '.ccs');

      // Create variants on ports 8318 and 8320 (leaving 8319 as gap)
      const settingsPath1 = path.join(ccsDir, 'test1.settings.json');
      const settingsPath2 = path.join(ccsDir, 'test2.settings.json');
      fs.writeFileSync(settingsPath1, JSON.stringify({ env: {} }));
      fs.writeFileSync(settingsPath2, JSON.stringify({ env: {} }));

      saveVariantLegacy('test1', 'gemini', settingsPath1, undefined, 8318);
      saveVariantLegacy('test2', 'gemini', settingsPath2, undefined, 8320);

      // Should return 8319 (the gap)
      const port = getNextAvailablePort();
      assert.strictEqual(port, 8319);
    });

    it('allocates sequential ports for multiple variants', function () {
      const ccsDir = path.join(testHome, '.ccs');

      for (let i = 0; i < 5; i++) {
        const settingsPath = path.join(ccsDir, `variant${i}.settings.json`);
        fs.writeFileSync(settingsPath, JSON.stringify({ env: {} }));

        const port = getNextAvailablePort();
        assert.strictEqual(port, 8318 + i);

        saveVariantLegacy(`variant${i}`, 'gemini', settingsPath, undefined, port);
      }
    });
  });

  describe('getNextAvailablePort - Boundary Conditions', function () {
    it('returns last port (8417) when 99 ports used', function () {
      const ccsDir = path.join(testHome, '.ccs');

      // Create 99 variants (ports 8318-8416)
      for (let i = 0; i < 99; i++) {
        const settingsPath = path.join(ccsDir, `variant${i}.settings.json`);
        fs.writeFileSync(settingsPath, JSON.stringify({ env: {} }));
        saveVariantLegacy(`variant${i}`, 'gemini', settingsPath, undefined, 8318 + i);
      }

      const port = getNextAvailablePort();
      assert.strictEqual(port, 8417); // Last available port
    });

    it('throws when all 100 ports exhausted', function () {
      const ccsDir = path.join(testHome, '.ccs');

      // Create 100 variants (ports 8318-8417)
      for (let i = 0; i < 100; i++) {
        const settingsPath = path.join(ccsDir, `variant${i}.settings.json`);
        fs.writeFileSync(settingsPath, JSON.stringify({ env: {} }));
        saveVariantLegacy(`variant${i}`, 'gemini', settingsPath, undefined, 8318 + i);
      }

      assert.throws(
        () => getNextAvailablePort(),
        /Port limit reached/,
        'Should throw error when all ports exhausted'
      );
    });

    it('error message includes variant count and recovery hint', function () {
      const ccsDir = path.join(testHome, '.ccs');

      // Create 100 variants
      for (let i = 0; i < 100; i++) {
        const settingsPath = path.join(ccsDir, `variant${i}.settings.json`);
        fs.writeFileSync(settingsPath, JSON.stringify({ env: {} }));
        saveVariantLegacy(`variant${i}`, 'gemini', settingsPath, undefined, 8318 + i);
      }

      try {
        getNextAvailablePort();
        assert.fail('Should have thrown error');
      } catch (err) {
        assert.ok(err.message.includes('100/100'), 'Should include variant count');
        assert.ok(
          err.message.includes('Delete unused variants from the dashboard'),
          'Should include recovery hint'
        );
      }
    });
  });

  describe('getNextAvailablePort - Port Reuse', function () {
    it('reuses port after variant deletion', function () {
      const ccsDir = path.join(testHome, '.ccs');

      // Create variant on port 8318
      const settingsPath = path.join(ccsDir, 'test.settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({ env: {} }));
      saveVariantLegacy('test', 'gemini', settingsPath, undefined, 8318);

      // Next port should be 8319
      let nextPort = getNextAvailablePort();
      assert.strictEqual(nextPort, 8319);

      // Remove the variant
      removeVariantFromLegacyConfig('test');

      // Now 8318 should be available again
      nextPort = getNextAvailablePort();
      assert.strictEqual(nextPort, 8318);
    });

    it('allocates lowest available port (not most recently freed)', function () {
      const ccsDir = path.join(testHome, '.ccs');

      // Create 3 variants on ports 8318, 8319, 8320
      for (let i = 0; i < 3; i++) {
        const settingsPath = path.join(ccsDir, `variant${i}.settings.json`);
        fs.writeFileSync(settingsPath, JSON.stringify({ env: {} }));
        saveVariantLegacy(`variant${i}`, 'gemini', settingsPath, undefined, 8318 + i);
      }

      // Remove middle variant (port 8319)
      removeVariantFromLegacyConfig('variant1');

      // Next allocation should use 8319 (the gap), not 8321
      const nextPort = getNextAvailablePort();
      assert.strictEqual(nextPort, 8319);
    });
  });

  describe('getNextAvailablePort - Legacy Variant Handling', function () {
    it('ignores variants without port field in usage calculation', function () {
      // Create variant without port (legacy format)
      const config = {
        profiles: {},
        cliproxy: {
          legacy_variant: {
            provider: 'gemini',
            settings: '/path/to/settings.json',
            // No port field
          },
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      // Should return first port since legacy variant has no port
      const port = getNextAvailablePort();
      assert.strictEqual(port, 8318);
    });

    it('handles mixed legacy and modern variants', function () {
      const ccsDir = path.join(testHome, '.ccs');

      // Create legacy variant without port
      const config = {
        profiles: {},
        cliproxy: {
          legacy: {
            provider: 'gemini',
            settings: path.join(ccsDir, 'legacy.settings.json'),
            // No port field
          },
          modern: {
            provider: 'gemini',
            settings: path.join(ccsDir, 'modern.settings.json'),
            port: 8318,
          },
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      // Should skip 8318 (used by modern) and return 8319
      const port = getNextAvailablePort();
      assert.strictEqual(port, 8319);
    });
  });

  describe('listVariantsFromConfig', function () {
    it('returns empty object when no variants exist', function () {
      const variants = listVariantsFromConfig();
      assert.deepStrictEqual(variants, {});
    });

    it('includes port field for each variant', function () {
      const ccsDir = path.join(testHome, '.ccs');
      const settingsPath = path.join(ccsDir, 'test.settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({ env: {} }));

      saveVariantLegacy('test', 'gemini', settingsPath, undefined, 8318);

      const variants = listVariantsFromConfig();
      assert.strictEqual(variants.test.port, 8318);
      assert.strictEqual(variants.test.provider, 'gemini');
    });

    it('returns undefined port for legacy variants', function () {
      // Create legacy variant without port
      const config = {
        profiles: {},
        cliproxy: {
          legacy: {
            provider: 'gemini',
            settings: '/path/to/settings.json',
            // No port field
          },
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      const variants = listVariantsFromConfig();
      assert.strictEqual(variants.legacy.port, undefined);
      assert.strictEqual(variants.legacy.provider, 'gemini');
    });
  });
});
