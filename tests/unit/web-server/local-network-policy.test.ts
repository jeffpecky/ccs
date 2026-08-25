import { describe, expect, it } from 'bun:test';
import { DEFAULT_LOCAL_DASHBOARD_HOST, DEFAULT_LOCAL_DASHBOARD_PORT } from '../../../src/web-server/server-defaults';

describe('local dashboard network policy', () => {
  it('uses IPv4 loopback on the normal CCS port', () => {
    expect(DEFAULT_LOCAL_DASHBOARD_HOST).toBe('127.0.0.1');
    expect(DEFAULT_LOCAL_DASHBOARD_PORT).toBe(8080);
  });
});
