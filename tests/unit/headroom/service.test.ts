import { describe, expect, it } from 'bun:test';

// NOTE: The managed Headroom lifecycle code (buildHeadroomArgs,
// createHeadroomService, maskHeadroomError) was removed by fork commit 1c102eeb;
// only the pure helpers below are still exported by src/headroom/service.ts.
import { getHeadroomEndpoint, isLoopbackHeadroomUrl } from '../../../src/headroom/service';

describe('Headroom process service', () => {
  it('allows lifecycle control only for loopback HTTP targets', () => {
    expect(isLoopbackHeadroomUrl('http://127.0.0.1:8787')).toBe(true);
    expect(isLoopbackHeadroomUrl('http://localhost:8787')).toBe(true);
    expect(isLoopbackHeadroomUrl('http://[::1]:8787')).toBe(true);
    expect(isLoopbackHeadroomUrl('https://headroom.example.test')).toBe(false);
    expect(isLoopbackHeadroomUrl('file:///tmp/headroom')).toBe(false);
  });

  it('extracts validated local port and rejects path-bearing managed URLs', () => {
    expect(getHeadroomEndpoint('http://127.0.0.1:8787')).toEqual({ port: 8787 });
    expect(() => getHeadroomEndpoint('http://127.0.0.1:8787/dashboard')).toThrow();
  });
});
