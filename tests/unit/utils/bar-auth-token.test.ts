import { describe, expect, test } from 'bun:test';
import {
  BarAuthNonceCache,
  createBarAuthProof,
  isMatchingBarAuthProof,
  normalizeBarAuthPath,
} from '../../../src/utils/bar-auth-token';

const token = '01'.repeat(32);
const nonce = 'ab'.repeat(16);

describe('Bar auth protocol', () => {
  test('binds proofs to direction, method, normalized path, and nonce', () => {
    const request = createBarAuthProof(token, 'request', 'GET', '/api/bar/summary?refresh=true', nonce);
    expect(isMatchingBarAuthProof(token, 'request', 'GET', '/api/bar/summary?refresh=true', nonce, request)).toBe(true);
    expect(isMatchingBarAuthProof(token, 'response', 'GET', '/api/bar/summary?refresh=true', nonce, request)).toBe(false);
    expect(isMatchingBarAuthProof(token, 'request', 'POST', '/api/bar/summary?refresh=true', nonce, request)).toBe(false);
    expect(isMatchingBarAuthProof(token, 'request', 'GET', '/api/bar/analytics?refresh=true', nonce, request)).toBe(false);
  });

  test('normalizes path without changing query meaning', () => {
    expect(normalizeBarAuthPath('/api/bar/summary?b=2&a=1')).toBe('/api/bar/summary?a=1&b=2');
    expect(normalizeBarAuthPath('api/bar/summary')).toBe('/api/bar/summary');
  });

  test('rejects replayed mutation nonces and evicts by TTL and bound', () => {
    let now = 1000;
    const cache = new BarAuthNonceCache(2, 100, () => now);
    expect(cache.consume(nonce)).toBe(true);
    expect(cache.consume(nonce)).toBe(false);
    expect(cache.consume('cd'.repeat(16))).toBe(true);
    expect(cache.consume('ef'.repeat(16))).toBe(true);
    expect(cache.size).toBe(2);
    now += 101;
    expect(cache.consume(nonce)).toBe(true);
  });
});
