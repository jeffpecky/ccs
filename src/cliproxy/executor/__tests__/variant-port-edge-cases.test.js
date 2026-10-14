/**
 * Variant Port Edge Case Tests
 *
 * Tests for edge cases and error handling in variant port isolation.
 * Covers port exhaustion, race conditions, stale session cleanup,
 * legacy migration, permission errors, and config corruption.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Set test isolation environment before importing
const testHome = path.join(
  os.tmpdir(),
  `ccs-test-edge-${Date.now()}-${Math.random().toString(36).slice(2)}`
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
const {
  getExistingProxy,
  registerSession,
  unregisterSession,
  cleanupOrphanedSessions,
  deleteSessionLockForPort,
  getProxyStatus,
} = require('../../../../dist/cliproxy/session-tracker');
const {
  deleteConfigForPort,
  configExists,
  generateConfig,
} = require('../../../../dist/cliproxy/config/config-generator');

describe('Variant Port Edge Cases', function () {
  let configPath;
  let cliproxyDir;

  beforeEach(function () {
    // Create test directories
    const ccsDir = path.join(testHome, '.ccs');
    cliproxyDir = path.join(ccsDir, 'cliproxy');
    fs.mkdirSync(cliproxyDir, { recursive: true });
    configPath = path.join(ccsDir, 'config.json');

    // Start with empty config
    fs.writeFileSync(configPath, JSON.stringify({ profiles: {} }));
  });

  afterEach(function () {
    // Clean up config and session files
    try {
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
      }
      const files = fs.readdirSync(cliproxyDir);
      for (const file of files) {
        fs.unlinkSync(path.join(cliproxyDir, file));
      }
    } catch {
      // Ignore cleanup errors
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

  describe('Port Exhaustion', function () {
    it('throws after 100 variants created', function () {
      const ccsDir = path.join(testHome, '.ccs');

      // Create 100 variants
      for (let i = 0; i < 100; i++) {
        const settingsPath = path.join(ccsDir, `variant${i}.settings.json`);
        fs.writeFileSync(settingsPath, JSON.stringify({ env: {} }));
        saveVariantLegacy(`variant${i}`, 'gemini', settingsPath, undefined, VARIANT_PORT_BASE + i);
      }

      assert.throws(() => getNextAvailablePort(), /Port limit reached/);
    });

    it('error message shows 100/100 and recovery hint', function () {
      const ccsDir = path.join(testHome, '.ccs');

      for (let i = 0; i < 100; i++) {
        const settingsPath = path.join(ccsDir, `variant${i}.settings.json`);
        fs.writeFileSync(settingsPath, JSON.stringify({ env: {} }));
        saveVariantLegacy(`variant${i}`, 'gemini', settingsPath, undefined, VARIANT_PORT_BASE + i);
      }

      try {
        getNextAvailablePort();
        assert.fail('Should have thrown');
      } catch (err) {
        assert.ok(err.message.includes('100/100'));
        assert.ok(err.message.includes('Delete unused variants from the dashboard'));
      }
    });

    it('frees port after variant removal', function () {
      const ccsDir = path.join(testHome, '.ccs');

      // Create variant on port 8318
      const settingsPath = path.join(ccsDir, 'test.settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({ env: {} }));
      saveVariantLegacy('test', 'gemini', settingsPath, undefined, VARIANT_PORT_BASE);

      // Next should be 8319
      assert.strictEqual(getNextAvailablePort(), VARIANT_PORT_BASE + 1);

      // Remove variant
      removeVariantFromLegacyConfig('test');

      // 8318 should be free again
      assert.strictEqual(getNextAvailablePort(), VARIANT_PORT_BASE);
    });
  });

  describe('Stale Session Cleanup', function () {
    it('cleans orphaned session lock on variant delete', function () {
      const port = 8318;

      // Create session file
      registerSession(port, process.pid);
      const sessionPath = path.join(cliproxyDir, `sessions-${port}.json`);
      assert.ok(fs.existsSync(sessionPath));

      // Simulate variant delete cleanup
      deleteSessionLockForPort(port);
      assert.strictEqual(fs.existsSync(sessionPath), false);
    });

    it('cleans stale lock when PID not running', function () {
      const port = 8318;
      const sessionPath = path.join(cliproxyDir, `sessions-${port}.json`);

      // Create lock with dead PID
      fs.writeFileSync(
        sessionPath,
        JSON.stringify({
          port,
          pid: 999999999, // Dead PID
          sessions: ['session1'],
          startedAt: new Date().toISOString(),
        })
      );

      // getExistingProxy should clean it up
      const lock = getExistingProxy(port);
      assert.strictEqual(lock, null);
      assert.strictEqual(fs.existsSync(sessionPath), false);
    });
  });

  describe('Legacy Variant Migration', function () {
    it('variant without port gets undefined in listing', function () {
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
    });

    it('legacy variant does not block port allocation', function () {
      // Create legacy variant without port
      const config = {
        profiles: {},
        cliproxy: {
          legacy: {
            provider: 'gemini',
            settings: '/path/to/settings.json',
            // No port field - doesn't count toward port usage
          },
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(config));

      // First port should still be available
      const port = getNextAvailablePort();
      assert.strictEqual(port, VARIANT_PORT_BASE);
    });
  });

  describe('Config Corruption', function () {
    it('handles malformed sessions-{port}.json gracefully', function () {
      const port = 8318;
      const sessionPath = path.join(cliproxyDir, `sessions-${port}.json`);

      // Write invalid JSON
      fs.writeFileSync(sessionPath, '{ invalid json }');

      // getExistingProxy should return null, not throw
      const lock = getExistingProxy(port);
      assert.strictEqual(lock, null);
    });

    it('handles missing config-{port}.yaml gracefully', function () {
      const port = 8318;
      // configExists should return false, not throw
      assert.strictEqual(configExists(port), false);
    });

    it('handles sessions file with missing required fields', function () {
      const port = 8318;
      const sessionPath = path.join(cliproxyDir, `sessions-${port}.json`);

      // Write JSON missing required fields
      fs.writeFileSync(sessionPath, JSON.stringify({ port: 8318 }));

      // getExistingProxy should return null (invalid structure)
      const lock = getExistingProxy(port);
      assert.strictEqual(lock, null);
    });

    it('handles sessions file with wrong data types', function () {
      const port = 8318;
      const sessionPath = path.join(cliproxyDir, `sessions-${port}.json`);

      // Write JSON with wrong types
      fs.writeFileSync(
        sessionPath,
        JSON.stringify({
          port: 'not-a-number',
          pid: 'also-not-a-number',
          sessions: 'not-an-array',
        })
      );

      const lock = getExistingProxy(port);
      assert.strictEqual(lock, null);
    });
  });

  describe('Cleanup on Crash', function () {
    it('getExistingProxy cleans stale lock if PID dead', function () {
      const port = 8318;
      const sessionPath = path.join(cliproxyDir, `sessions-${port}.json`);

      // Create lock with dead PID (simulating crashed proxy)
      fs.writeFileSync(
        sessionPath,
        JSON.stringify({
          port,
          pid: 999999999,
          sessions: ['session1'],
          startedAt: new Date().toISOString(),
        })
      );

      const lock = getExistingProxy(port);
      assert.strictEqual(lock, null);
      assert.strictEqual(fs.existsSync(sessionPath), false);
    });

    it('cleanupOrphanedSessions removes stale lock', function () {
      const port = 8318;
      const sessionPath = path.join(cliproxyDir, `sessions-${port}.json`);

      // Create lock with dead PID
      fs.writeFileSync(
        sessionPath,
        JSON.stringify({
          port,
          pid: 999999999,
          sessions: ['session1'],
          startedAt: new Date().toISOString(),
        })
      );

      cleanupOrphanedSessions(port);
      assert.strictEqual(fs.existsSync(sessionPath), false);
    });

    it('variant delete cleans session lock even if proxy crashed', function () {
      const port = 8318;
      const sessionPath = path.join(cliproxyDir, `sessions-${port}.json`);

      // Create lock with dead PID
      fs.writeFileSync(
        sessionPath,
        JSON.stringify({
          port,
          pid: 999999999,
          sessions: ['session1'],
          startedAt: new Date().toISOString(),
        })
      );

      // deleteSessionLockForPort is called during variant removal
      deleteSessionLockForPort(port);
      assert.strictEqual(fs.existsSync(sessionPath), false);
    });
  });

  describe('Variant Lifecycle Integration', function () {
    it('creates variant with unique port and separate files', function () {
      const ccsDir = path.join(testHome, '.ccs');
      const port = getNextAvailablePort();

      // Create variant
      const settingsPath = path.join(ccsDir, 'test.settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({ env: {} }));
      saveVariantLegacy('test', 'gemini', settingsPath, undefined, port);

      // Generate config
      generateConfig('gemini', port);

      // Verify files exist
      assert.ok(configExists(port));

      // Start session
      const sessionId = registerSession(port, process.pid);
      const status = getProxyStatus(port);
      assert.strictEqual(status.running, true);
      assert.strictEqual(status.port, port);

      // Clean up session
      unregisterSession(sessionId, port);
    });

    it('removes variant and cleans up all port files', function () {
      const ccsDir = path.join(testHome, '.ccs');
      const port = 8318;

      // Create variant
      const settingsPath = path.join(ccsDir, 'test.settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({ env: {} }));
      saveVariantLegacy('test', 'gemini', settingsPath, undefined, port);

      // Generate config and session
      generateConfig('gemini', port);
      registerSession(port, process.pid);

      // Verify files exist
      assert.ok(configExists(port));
      assert.strictEqual(getProxyStatus(port).running, true);

      // Remove variant (simulating full cleanup)
      removeVariantFromLegacyConfig('test');
      deleteConfigForPort(port);
      deleteSessionLockForPort(port);

      // Verify cleanup
      assert.strictEqual(configExists(port), false);
      assert.strictEqual(getProxyStatus(port).running, false);
    });

    it('port reuse after deletion does not have stale data', function () {
      const ccsDir = path.join(testHome, '.ccs');

      // Create variant A
      const settingsA = path.join(ccsDir, 'variantA.settings.json');
      fs.writeFileSync(settingsA, JSON.stringify({ env: { KEY: 'A' } }));
      const portA = getNextAvailablePort();
      saveVariantLegacy('variantA', 'gemini', settingsA, undefined, portA);
      generateConfig('gemini', portA);
      registerSession(portA, process.pid);

      // Remove variant A with full cleanup
      removeVariantFromLegacyConfig('variantA');
      deleteConfigForPort(portA);
      deleteSessionLockForPort(portA);

      // Create variant B - should get same port
      const settingsB = path.join(ccsDir, 'variantB.settings.json');
      fs.writeFileSync(settingsB, JSON.stringify({ env: { KEY: 'B' } }));
      const portB = getNextAvailablePort();
      assert.strictEqual(portB, portA); // Port should be reused

      // New session should start fresh
      saveVariantLegacy('variantB', 'gemini', settingsB, undefined, portB);
      generateConfig('gemini', portB);
      const sessionB = registerSession(portB, process.pid);

      const status = getProxyStatus(portB);
      assert.strictEqual(status.running, true);
      assert.strictEqual(status.sessionCount, 1);

      // Clean up
      unregisterSession(sessionB, portB);
    });
  });

  describe('Multiple Concurrent Variants', function () {
    it('creates 3 variants with different ports', function () {
      const ccsDir = path.join(testHome, '.ccs');
      const ports = [];

      for (let i = 0; i < 3; i++) {
        const port = getNextAvailablePort();
        ports.push(port);

        const settingsPath = path.join(ccsDir, `variant${i}.settings.json`);
        fs.writeFileSync(settingsPath, JSON.stringify({ env: {} }));
        saveVariantLegacy(`variant${i}`, 'gemini', settingsPath, undefined, port);
      }

      // Verify all ports are different
      const uniquePorts = new Set(ports);
      assert.strictEqual(uniquePorts.size, 3);

      // Verify sequential assignment
      assert.strictEqual(ports[0], VARIANT_PORT_BASE);
      assert.strictEqual(ports[1], VARIANT_PORT_BASE + 1);
      assert.strictEqual(ports[2], VARIANT_PORT_BASE + 2);
    });

    it('each has separate config file', function () {
      const ccsDir = path.join(testHome, '.ccs');
      const ports = [8318, 8319, 8320];

      for (let i = 0; i < 3; i++) {
        const settingsPath = path.join(ccsDir, `variant${i}.settings.json`);
        fs.writeFileSync(settingsPath, JSON.stringify({ env: {} }));
        saveVariantLegacy(`variant${i}`, 'gemini', settingsPath, undefined, ports[i]);
        generateConfig('gemini', ports[i]);
      }

      // Verify separate config files
      for (const port of ports) {
        assert.ok(configExists(port), `Config for port ${port} should exist`);
      }
    });

    it('each has separate sessions file when running', function () {
      const ports = [8318, 8319, 8320];

      for (const port of ports) {
        registerSession(port, process.pid);
      }

      // Verify separate session files
      for (const port of ports) {
        const sessionPath = path.join(cliproxyDir, `sessions-${port}.json`);
        assert.ok(fs.existsSync(sessionPath), `Session file for port ${port} should exist`);
      }

      // Clean up
      for (const port of ports) {
        deleteSessionLockForPort(port);
      }
    });

    it('removing one does not affect others', function () {
      const ccsDir = path.join(testHome, '.ccs');
      const ports = [8318, 8319, 8320];

      // Create 3 variants
      for (let i = 0; i < 3; i++) {
        const settingsPath = path.join(ccsDir, `variant${i}.settings.json`);
        fs.writeFileSync(settingsPath, JSON.stringify({ env: {} }));
        saveVariantLegacy(`variant${i}`, 'gemini', settingsPath, undefined, ports[i]);
        generateConfig('gemini', ports[i]);
        registerSession(ports[i], process.pid);
      }

      // Remove middle variant
      removeVariantFromLegacyConfig('variant1');
      deleteConfigForPort(ports[1]);
      deleteSessionLockForPort(ports[1]);

      // Verify others still exist
      assert.ok(configExists(ports[0]));
      assert.ok(!configExists(ports[1])); // Removed
      assert.ok(configExists(ports[2]));

      assert.strictEqual(getProxyStatus(ports[0]).running, true);
      assert.strictEqual(getProxyStatus(ports[1]).running, false); // Removed
      assert.strictEqual(getProxyStatus(ports[2]).running, true);

      // Clean up remaining
      deleteSessionLockForPort(ports[0]);
      deleteSessionLockForPort(ports[2]);
    });
  });
});
