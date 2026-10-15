/**
 * Unit Tests for Beta Channel Implementation (Phase 3)
 *
 * Tests the beta channel functionality added in Phase 3:
 * - Beta channel updates in update-checker.ts
 * - fetchVersionFromNpmTag function for 'dev' tag
 * - checkForUpdates with targetTag parameter
 * - Direct install beta rejection
 * - Beta stability warning display
 * - handleCheckFailed with targetTag
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

describe('Beta Channel Implementation (Phase 3)', function () {
  let updateCheckerModule;
  let originalFsExistsSync;
  let originalFsReadFileSync;
  let originalFsWriteFileSync;
  let originalFsMkdirSync;
  let originalHttpsGet;
  let mockFileSystem = {};
  let httpsRequests = [];
  let cacheFilePath;
  let cacheDirPath;

  beforeAll(async function () {
    // Note: Build is handled by CI before tests run (bun run build:all)
    // Import the built module
    updateCheckerModule = await import('../../../dist/utils/update-checker.js');
  });

  beforeEach(function () {
    // Reset mocks
    mockFileSystem = {};
    httpsRequests = [];
    cacheFilePath = undefined;
    cacheDirPath = undefined;

    // Store original functions
    originalFsExistsSync = fs.existsSync;
    originalFsReadFileSync = fs.readFileSync;
    originalFsWriteFileSync = fs.writeFileSync;
    originalFsMkdirSync = fs.mkdirSync;
    originalHttpsGet = https.get;

    // Mock fs.existsSync
    fs.existsSync = (filePath) => {
      const key = String(filePath);
      if (key.endsWith('/update-check.json') || key.endsWith('\\update-check.json')) {
        cacheFilePath = key;
        cacheDirPath = path.dirname(key);
      }
      if (key.endsWith('/cache') || key.endsWith('\\cache')) {
        cacheDirPath = key;
      }
      return mockFileSystem[key] !== undefined;
    };

    // Mock fs.readFileSync
    fs.readFileSync = (filePath, encoding) => {
      const key = String(filePath);
      if (mockFileSystem[key]) {
        return mockFileSystem[key];
      }
      throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
    };

    // Mock fs.writeFileSync
    fs.writeFileSync = (filePath, data, encoding) => {
      const key = String(filePath);
      if (key.endsWith('/update-check.json') || key.endsWith('\\update-check.json')) {
        cacheFilePath = key;
        cacheDirPath = path.dirname(key);
      }
      mockFileSystem[key] = data;
    };

    // Mock fs.mkdirSync
    fs.mkdirSync = (dirPath, options) => {
      const key = String(dirPath);
      if (key.endsWith('/cache') || key.endsWith('\\cache')) {
        cacheDirPath = key;
      }
      // Just mark as created for testing
      mockFileSystem[key] = 'directory';
    };

    // Mock https.get
    https.get = (url, options, callback) => {
      httpsRequests.push({ url, options: options || {} });

      // Create mock response object
      const mockRes = {
        statusCode: 200,
        on: function(event, handler) {
          if (event === 'data') {
            // Simulate receiving data
            setTimeout(() => {
              if (url.includes('/dev')) {
                handler('{"version":"5.5.0"}'); // Use a higher version for dev
              } else if (url.includes('/latest')) {
                handler('{"version":"5.4.1"}');
              }
            }, 0);
          } else if (event === 'end') {
            setTimeout(handler, 10);
          }
        }
      };

      // Call callback with mock response
      if (callback) {
        setTimeout(() => callback(mockRes), 0);
      }

      // Return mock request object
      return {
        on: function(event, handler) {
          if (event === 'error') {
            // Don't call error handler by default
          } else if (event === 'timeout') {
            // Don't call timeout handler by default
          }
        },
        destroy: function() {
          // Mock destroy method
        }
      };
    };

    // Force path discovery from module internals to avoid hardcoded ~/.ccs assumptions.
    updateCheckerModule.readCache();
  });

  afterEach(function () {
    // Restore original functions
    fs.existsSync = originalFsExistsSync;
    fs.readFileSync = originalFsReadFileSync;
    fs.writeFileSync = originalFsWriteFileSync;
    fs.mkdirSync = originalFsMkdirSync;
    https.get = originalHttpsGet;
  });

  describe('fetchVersionFromNpmTag function (internal)', function () {
    it('should request from correct npm registry URL for latest tag', async function () {
      // Call checkForUpdates which internally uses fetchVersionFromNpmTag
      const result = await updateCheckerModule.checkForUpdates('5.4.0', true, 'npm', 'latest');

      // Should have made request to correct URL
      const latestRequest = httpsRequests.find(req =>
        req.url === 'https://registry.npmjs.org/@jeffpecky/ccs/latest'
      );
      assert(latestRequest, 'should request latest tag from npm registry');

      // Should return version
      assert.strictEqual(result.status, 'update_available');
      assert.strictEqual(result.latest, '5.4.1');
    });

    it('should request from correct npm registry URL for dev tag', async function () {
      // Call checkForUpdates which internally uses fetchVersionFromNpmTag
      const result = await updateCheckerModule.checkForUpdates('5.4.1', true, 'npm', 'dev');

      // Should have made request to correct URL
      const devRequest = httpsRequests.find(req =>
        req.url === 'https://registry.npmjs.org/@jeffpecky/ccs/dev'
      );
      assert(devRequest, 'should request dev tag from npm registry');

      // Should return version
      assert.strictEqual(result.status, 'update_available');
      assert.strictEqual(result.latest, '5.5.0');
    });

    it('should handle network errors gracefully', async function () {
      // Mock https.get to simulate network error
      https.get = (url, options, callback) => {
        const req = {
          on: function(event, handler) {
            if (event === 'error') {
              setTimeout(() => handler(new Error('Network error')), 0);
            }
          },
          destroy: function() {}
        };
        return req;
      };

      const result = await updateCheckerModule.checkForUpdates('5.4.0', true, 'npm', 'latest');
      assert.strictEqual(result.status, 'check_failed');
      assert.strictEqual(result.reason, 'npm_registry_error');
    });

    it('should handle timeout errors gracefully', async function () {
      // Mock https.get to simulate timeout
      https.get = (url, options, callback) => {
        const mockRes = {
          statusCode: 200,
          on: function(event, handler) {
            // Don't send any data to trigger timeout
          }
        };

        if (callback) {
          setTimeout(() => callback(mockRes), 0);
        }

        return {
          on: function(event, handler) {
            if (event === 'timeout') {
              setTimeout(() => {
                handler();
                this.destroy();
              }, 100);
            }
          },
          destroy: function() {}
        };
      };

      const result = await updateCheckerModule.checkForUpdates('5.4.0', true, 'npm', 'latest');
      assert.strictEqual(result.status, 'check_failed');
      assert.strictEqual(result.reason, 'npm_registry_error');
    });

    it('should handle invalid JSON response', async function () {
      // Mock https.get to return invalid JSON
      https.get = (url, options, callback) => {
        const mockRes = {
          statusCode: 200,
          on: function(event, handler) {
            if (event === 'data') {
              setTimeout(() => handler('invalid json'), 0);
            } else if (event === 'end') {
              setTimeout(handler, 10);
            }
          }
        };

        if (callback) {
          setTimeout(() => callback(mockRes), 0);
        }

        return {
          on: function() {},
          destroy: function() {}
        };
      };

      const result = await updateCheckerModule.checkForUpdates('5.4.0', true, 'npm', 'latest');
      assert.strictEqual(result.status, 'check_failed');
      assert.strictEqual(result.reason, 'npm_registry_error');
    });

    it('should handle non-200 status codes', async function () {
      // Mock https.get to return 404
      https.get = (url, options, callback) => {
        const mockRes = {
          statusCode: 404,
          on: function(event, handler) {
            if (event === 'end') {
              setTimeout(handler, 0);
            }
          }
        };

        if (callback) {
          setTimeout(() => callback(mockRes), 0);
        }

        return {
          on: function() {},
          destroy: function() {}
        };
      };

      const result = await updateCheckerModule.checkForUpdates('5.4.0', true, 'npm', 'latest');
      assert.strictEqual(result.status, 'check_failed');
      assert.strictEqual(result.reason, 'npm_registry_error');
    });
  });

  describe('checkForUpdates with targetTag parameter', function () {
    function getCacheFilePath() {
      return cacheFilePath || path.join(os.homedir(), '.ccs', 'cache', 'update-check.json');
    }

    beforeEach(function () {
      // Set up a fresh cache
      const cacheData = {
        last_check: 0,
        latest_version: null,
        dismissed_version: null
      };
      mockFileSystem[getCacheFilePath()] = JSON.stringify(cacheData);
    });

    it('should use latest tag when targetTag is "latest"', async function () {
      const result = await updateCheckerModule.checkForUpdates('5.4.0', true, 'npm', 'latest');

      // Should request latest tag
      const latestRequest = httpsRequests.find(req =>
        req.url.includes('/latest')
      );
      assert(latestRequest, 'should request latest tag');

      // Should return update available
      assert.strictEqual(result.status, 'update_available');
      assert.strictEqual(result.latest, '5.4.1');
      assert.strictEqual(result.current, '5.4.0');
    });

    it('should use dev tag when targetTag is "dev"', async function () {
      const result = await updateCheckerModule.checkForUpdates('5.4.0', true, 'npm', 'dev');

      // Should request dev tag
      const devRequest = httpsRequests.find(req =>
        req.url.includes('/dev')
      );
      assert(devRequest, 'should request dev tag');

      // Should return update available (dev version newer)
      assert.strictEqual(result.status, 'update_available');
      assert.strictEqual(result.latest, '5.5.0');
      assert.strictEqual(result.current, '5.4.0');
    });

    it('should reject beta for direct install', async function () {
      const result = await updateCheckerModule.checkForUpdates('5.4.1', true, 'direct', 'dev');

      // Should return check_failed for beta on direct install
      assert.strictEqual(result.status, 'check_failed');
      assert.strictEqual(result.reason, 'beta_not_supported');
      assert.strictEqual(result.message, '--beta requires npm installation method');

      // Should not make any HTTP requests
      assert.strictEqual(httpsRequests.length, 0, 'should not make HTTP requests');
    });

    it('should allow beta for npm install', async function () {
      const result = await updateCheckerModule.checkForUpdates('5.4.1', true, 'npm', 'dev');

      // Should NOT return check_failed for npm
      assert.notStrictEqual(result.status, 'check_failed');

      // Should make HTTP request
      assert(httpsRequests.length > 0, 'should make HTTP requests');
    });

    it('should use different fetch error for npm vs direct', async function () {
      // Mock https.get to fail
      https.get = (url, options, callback) => {
        const req = {
          on: function(event, handler) {
            if (event === 'error') {
              setTimeout(() => handler(new Error('Network error')), 0);
            }
          },
          destroy: function() {}
        };
        return req;
      };

      // Test npm install
      const npmResult = await updateCheckerModule.checkForUpdates('5.4.1', true, 'npm', 'latest');
      assert.strictEqual(npmResult.status, 'check_failed');
      assert.strictEqual(npmResult.reason, 'npm_registry_error');

      // Reset requests
      httpsRequests = [];

      // Test direct install
      const directResult = await updateCheckerModule.checkForUpdates('5.4.1', true, 'direct', 'latest');
      assert.strictEqual(directResult.status, 'check_failed');
      assert.strictEqual(directResult.reason, 'github_api_error');
    });

    it('should update cache with correct version from target tag', async function () {
      await updateCheckerModule.checkForUpdates('5.4.0', true, 'npm', 'dev');

      // Check cache was updated with dev version
      const cachePath = getCacheFilePath();
      const cacheData = JSON.parse(mockFileSystem[cachePath]);

      // Dev versions are now stored in dev_version field (not latest_version)
      assert.strictEqual(cacheData.dev_version, '5.5.0');
      assert(cacheData.last_check > 0, 'should update timestamp');
    });

    it('should use cached result when within interval', async function () {
      // Set up cache with recent check - use dev_version for dev channel
      const cacheData = {
        last_check: Date.now() - 1000, // 1 second ago
        latest_version: null,
        dev_version: '5.5.0',
        dismissed_version: null
      };
      mockFileSystem[getCacheFilePath()] = JSON.stringify(cacheData);

      // Call with force=false to use cache
      const result = await updateCheckerModule.checkForUpdates('5.4.0', false, 'npm', 'dev');

      // Should not make HTTP requests
      assert.strictEqual(httpsRequests.length, 0, 'should use cached result');

      // Should return cached update
      assert.strictEqual(result.status, 'update_available');
      assert.strictEqual(result.latest, '5.5.0');
    });
  });

  describe('Version comparison with dev versions', function () {
    it('should correctly compare dev version as newer', async function () {
      const result = await updateCheckerModule.checkForUpdates('5.4.0', true, 'npm', 'dev');

      // 5.5.0 should be newer than 5.4.0
      assert.strictEqual(result.status, 'update_available');
      assert.strictEqual(result.latest, '5.5.0');
    });

    it('should correctly handle same dev version', async function () {
      // Mock same version response
      https.get = (url, options, callback) => {
        const mockRes = {
          statusCode: 200,
          on: function(event, handler) {
            if (event === 'data') {
              setTimeout(() => handler('{"version":"5.4.1"}'), 0);
            } else if (event === 'end') {
              setTimeout(handler, 10);
            }
          }
        };

        if (callback) {
          setTimeout(() => callback(mockRes), 0);
        }

        return {
          on: function() {},
          destroy: function() {}
        };
      };

      const result = await updateCheckerModule.checkForUpdates('5.4.1', true, 'npm', 'latest');

      // Same version should not trigger update
      assert.strictEqual(result.status, 'no_update');
      assert.strictEqual(result.reason, 'latest');
    });

    it('should correctly handle older dev version', async function () {
      // Mock older version response
      https.get = (url, options, callback) => {
        const mockRes = {
          statusCode: 200,
          on: function(event, handler) {
            if (event === 'data') {
              setTimeout(() => handler('{"version":"5.4.0"}'), 0);
            } else if (event === 'end') {
              setTimeout(handler, 10);
            }
          }
        };

        if (callback) {
          setTimeout(() => callback(mockRes), 0);
        }

        return {
          on: function() {},
          destroy: function() {}
        };
      };

      const result = await updateCheckerModule.checkForUpdates('5.4.1', true, 'npm', 'dev');

      // Older version should not trigger update
      assert.strictEqual(result.status, 'no_update');
      assert.strictEqual(result.reason, 'latest');
    });
  });

  describe('Cache functionality', function () {
    function getCacheFilePath() {
      return cacheFilePath || path.join(os.homedir(), '.ccs', 'cache', 'update-check.json');
    }

    function getCacheDirPath() {
      return cacheDirPath || path.dirname(getCacheFilePath());
    }

    it('should create cache directory if not exists', async function () {
      // Ensure no cache exists
      const cacheDir = getCacheDirPath();
      delete mockFileSystem[cacheDir];

      await updateCheckerModule.checkForUpdates('5.4.0', true, 'npm', 'latest');

      // Should create directory
      assert(mockFileSystem[cacheDir], 'should create cache directory');
    });

    it('should handle dismissed versions correctly', async function () {
      // Set up cache with dismissed version - use dev_version for dev channel
      const cacheData = {
        last_check: Date.now() - 1000,
        latest_version: null,
        dev_version: '5.5.0',
        dismissed_version: '5.5.0'
      };
      mockFileSystem[getCacheFilePath()] = JSON.stringify(cacheData);

      const result = await updateCheckerModule.checkForUpdates('5.4.1', false, 'npm', 'dev');

      // Should not show update for dismissed version
      assert.strictEqual(result.status, 'no_update');
      assert.strictEqual(result.reason, 'dismissed');
    });

    it('should handle corrupted cache gracefully', async function () {
      // Set up corrupted cache
      mockFileSystem[getCacheFilePath()] = 'invalid json';

      // Should not throw error
      const result = await updateCheckerModule.checkForUpdates('5.4.0', true, 'npm', 'latest');

      // Should work normally
      assert(result.status === 'update_available' || result.status === 'no_update');
    });
  });
});
