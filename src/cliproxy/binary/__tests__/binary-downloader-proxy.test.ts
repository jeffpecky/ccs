/**
 * Binary Downloader Proxy Support Tests
 *
 * Tests for proxy environment variable detection and NO_PROXY bypass logic.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { __testExports } from '../downloader';

const { getProxyUrl, shouldBypassProxy, getHostname, getProxyAgent } = __testExports;

describe('Binary Downloader Proxy Support', () => {
  // Store original env vars to restore after tests
  const originalEnv: Record<string, string | undefined> = {};
  const proxyEnvVars = [
    'http_proxy',
    'HTTP_PROXY',
    'https_proxy',
    'HTTPS_PROXY',
    'all_proxy',
    'ALL_PROXY',
    'no_proxy',
    'NO_PROXY',
  ];

  beforeEach(() => {
    // Save original values
    proxyEnvVars.forEach((key) => {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    });
  });

  afterEach(() => {
    // Restore original values
    proxyEnvVars.forEach((key) => {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    });
  });

  describe('getProxyUrl', () => {
    describe('HTTPS requests', () => {
      it('should return undefined when no proxy env vars are set', () => {
        expect(getProxyUrl(true)).toBeUndefined();
      });

      // On Windows, process.env is case-insensitive, so https_proxy and
      // HTTPS_PROXY are the same variable and precedence is unobservable.
      it.skipIf(process.platform === 'win32')('should prefer https_proxy (lowercase)', () => {
        process.env.https_proxy = 'http://proxy1:8080';
        process.env.HTTPS_PROXY = 'http://proxy2:8080';
        expect(getProxyUrl(true)).toBe('http://proxy1:8080');
      });

      it('should fall back to HTTPS_PROXY (uppercase)', () => {
        process.env.HTTPS_PROXY = 'http://proxy:8080';
        expect(getProxyUrl(true)).toBe('http://proxy:8080');
      });

      it('should fall back to all_proxy', () => {
        process.env.all_proxy = 'http://allproxy:8080';
        expect(getProxyUrl(true)).toBe('http://allproxy:8080');
      });

      it('should fall back to ALL_PROXY', () => {
        process.env.ALL_PROXY = 'http://allproxy:8080';
        expect(getProxyUrl(true)).toBe('http://allproxy:8080');
      });

      it('should skip invalid HTTP_PROXY and fall back to ALL_PROXY', () => {
        process.env.HTTP_PROXY = 'not-a-valid-url';
        process.env.ALL_PROXY = 'http://allproxy:8080';
        expect(getProxyUrl(true)).toBe('http://allproxy:8080');
      });
    });

    describe('HTTP requests', () => {
      it('should return undefined when no proxy env vars are set', () => {
        expect(getProxyUrl(false)).toBeUndefined();
      });

      // Windows env vars are case-insensitive; lowercase/uppercase collapse.
      it.skipIf(process.platform === 'win32')('should prefer http_proxy (lowercase)', () => {
        process.env.http_proxy = 'http://proxy1:8080';
        process.env.HTTP_PROXY = 'http://proxy2:8080';
        expect(getProxyUrl(false)).toBe('http://proxy1:8080');
      });

      it('should fall back to HTTP_PROXY (uppercase)', () => {
        process.env.HTTP_PROXY = 'http://proxy:8080';
        expect(getProxyUrl(false)).toBe('http://proxy:8080');
      });

      it('should fall back to all_proxy for HTTP', () => {
        process.env.all_proxy = 'http://allproxy:8080';
        expect(getProxyUrl(false)).toBe('http://allproxy:8080');
      });

      it('should skip invalid HTTP_PROXY and use ALL_PROXY for HTTP', () => {
        process.env.HTTP_PROXY = 'not-a-valid-url';
        process.env.ALL_PROXY = 'http://allproxy:8080';
        expect(getProxyUrl(false)).toBe('http://allproxy:8080');
      });

      it('should not use https_proxy for HTTP requests', () => {
        process.env.https_proxy = 'http://httpsproxy:8080';
        expect(getProxyUrl(false)).toBeUndefined();
      });
    });
  });

  describe('shouldBypassProxy', () => {
    describe('when NO_PROXY is not set', () => {
      it('should return false', () => {
        expect(shouldBypassProxy('example.com')).toBe(false);
      });
    });

    describe('wildcard pattern', () => {
      it('should bypass all hosts with *', () => {
        process.env.NO_PROXY = '*';
        expect(shouldBypassProxy('example.com')).toBe(true);
        expect(shouldBypassProxy('any.host.here')).toBe(true);
      });
    });

    describe('exact match', () => {
      it('should match exact hostname', () => {
        process.env.NO_PROXY = 'example.com';
        expect(shouldBypassProxy('example.com')).toBe(true);
        expect(shouldBypassProxy('other.com')).toBe(false);
      });

      it('should be case-insensitive', () => {
        process.env.NO_PROXY = 'Example.COM';
        expect(shouldBypassProxy('example.com')).toBe(true);
        expect(shouldBypassProxy('EXAMPLE.COM')).toBe(true);
      });

      it('should not match subdomains for exact pattern', () => {
        process.env.NO_PROXY = 'example.com';
        expect(shouldBypassProxy('sub.example.com')).toBe(true); // matches as suffix
        expect(shouldBypassProxy('notexample.com')).toBe(false);
      });
    });

    describe('domain suffix pattern', () => {
      it('should match subdomains with leading dot', () => {
        process.env.NO_PROXY = '.example.com';
        expect(shouldBypassProxy('sub.example.com')).toBe(true);
        expect(shouldBypassProxy('deep.sub.example.com')).toBe(true);
        expect(shouldBypassProxy('example.com')).toBe(true); // exact match without dot
      });

      it('should not match different domains', () => {
        process.env.NO_PROXY = '.example.com';
        expect(shouldBypassProxy('notexample.com')).toBe(false);
        expect(shouldBypassProxy('example.org')).toBe(false);
      });
    });

    describe('multiple patterns', () => {
      it('should check comma-separated list', () => {
        process.env.NO_PROXY = 'localhost,127.0.0.1,.internal.corp';
        expect(shouldBypassProxy('localhost')).toBe(true);
        expect(shouldBypassProxy('127.0.0.1')).toBe(true);
        expect(shouldBypassProxy('api.internal.corp')).toBe(true);
        expect(shouldBypassProxy('external.com')).toBe(false);
      });

      it('should handle whitespace in list', () => {
        process.env.NO_PROXY = ' localhost , example.com , .corp ';
        expect(shouldBypassProxy('localhost')).toBe(true);
        expect(shouldBypassProxy('example.com')).toBe(true);
        expect(shouldBypassProxy('host.corp')).toBe(true);
      });
    });

    describe('lowercase no_proxy', () => {
      it('should respect no_proxy (lowercase)', () => {
        process.env.no_proxy = 'example.com';
        expect(shouldBypassProxy('example.com')).toBe(true);
      });

      // Windows env vars are case-insensitive; lowercase/uppercase collapse.
      it.skipIf(process.platform === 'win32')('should prefer no_proxy over NO_PROXY', () => {
        process.env.no_proxy = 'lower.com';
        process.env.NO_PROXY = 'upper.com';
        expect(shouldBypassProxy('lower.com')).toBe(true);
        expect(shouldBypassProxy('upper.com')).toBe(false);
      });
    });
  });

  describe('getHostname', () => {
    it('should extract hostname from HTTPS URL', () => {
      expect(getHostname('https://example.com/path')).toBe('example.com');
    });

    it('should extract hostname from HTTP URL', () => {
      expect(getHostname('http://api.github.com:443/repos')).toBe('api.github.com');
    });

    it('should return empty string for invalid URL', () => {
      expect(getHostname('not-a-url')).toBe('');
      expect(getHostname('')).toBe('');
    });

    it('should handle localhost', () => {
      expect(getHostname('http://localhost:8080')).toBe('localhost');
    });

    it('should handle IP addresses', () => {
      expect(getHostname('http://192.168.1.1:3000')).toBe('192.168.1.1');
    });
  });

  describe('getProxyAgent', () => {
    describe('when no proxy is configured', () => {
      it('should return false for HTTPS URLs', () => {
        expect(getProxyAgent('https://example.com')).toBe(false);
      });

      it('should return false for HTTP URLs', () => {
        expect(getProxyAgent('http://example.com')).toBe(false);
      });
    });

    describe('when proxy is configured', () => {
      it('should return HttpsProxyAgent for HTTPS URLs', () => {
        process.env.https_proxy = 'http://proxy:8080';
        const agent = getProxyAgent('https://github.com/releases');
        expect(agent).not.toBe(false);
        expect(agent).toBeDefined();
      });

      it('should return HttpProxyAgent for HTTP URLs', () => {
        process.env.http_proxy = 'http://proxy:8080';
        const agent = getProxyAgent('http://example.com');
        expect(agent).not.toBe(false);
        expect(agent).toBeDefined();
      });
    });

    describe('NO_PROXY bypass', () => {
      it('should bypass proxy for NO_PROXY hosts', () => {
        process.env.https_proxy = 'http://proxy:8080';
        process.env.NO_PROXY = 'github.com';
        expect(getProxyAgent('https://github.com/releases')).toBe(false);
      });

      it('should use proxy for non-bypassed hosts', () => {
        process.env.https_proxy = 'http://proxy:8080';
        process.env.NO_PROXY = 'internal.corp';
        const agent = getProxyAgent('https://github.com/releases');
        expect(agent).not.toBe(false);
      });
    });

    describe('error handling', () => {
      it('should return false for invalid proxy URL', () => {
        process.env.https_proxy = 'not-a-valid-url';
        expect(getProxyAgent('https://example.com')).toBe(false);
      });

      it('should keep supporting socks proxy URLs for downloader traffic', () => {
        process.env.https_proxy = 'socks5://proxy:1080';
        expect(getProxyAgent('https://example.com')).not.toBe(false);
      });

      it('should return false for invalid target URL', () => {
        process.env.https_proxy = 'http://proxy:8080';
        expect(getProxyAgent('not-a-url')).toBe(false);
      });
    });
  });
});
