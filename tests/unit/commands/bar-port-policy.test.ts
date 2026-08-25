import { describe, expect, it } from 'bun:test';
import { BAR_PORT_CANDIDATES } from '../../../src/commands/bar/bar-server-probe';

describe('CCS Bar port policy', () => {
  it('prefers dashboard ports before legacy Bar ports', () => {
    expect(BAR_PORT_CANDIDATES).toEqual([8080, 8181, 3000, 3001, 3002, 8000]);
  });
});
