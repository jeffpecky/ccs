import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '../../..');

function readSource(relative: string): string {
  return readFileSync(join(repoRoot, relative), 'utf8');
}

// cdb67a9b ("sync macos-bar with upstream, remove auth") dropped client-side
// nonce/proof signing: while dashboard auth is disabled (authMode "loopback",
// docs/ccs-bar.md) the server trusts plain loopback reads, matching upstream,
// which has no per-request bar gate at all. These checks pin that contract so
// the client and server cannot silently drift apart again.
describe('Swift CCS Bar loopback probe contract (no per-request auth)', () => {
  test('probe discovers the server with a plain GET /api/bar/summary', () => {
    const probe = readSource('macos-bar/Sources/CCSBarCore/BarServerProbe.swift');

    expect(probe).toContain('api/bar/summary');
    expect(probe).not.toContain('x-ccs-bar-nonce');
    expect(probe).not.toContain('x-ccs-bar-token');
    expect(probe).not.toContain('.auth-token');
    expect(probe).not.toContain('HMAC');
  });

  test('client sends unsigned summary, analytics, and mutation requests', () => {
    const client = readSource('macos-bar/Sources/CCSBarCore/CCSBarClient.swift');

    expect(client).toContain('api/bar/summary');
    expect(client).toContain('api/bar/analytics');
    expect(client).not.toContain('x-ccs-bar-nonce');
    expect(client).not.toContain('x-ccs-bar-token');
    expect(client).not.toContain('HMAC<SHA256>');
    expect(client).not.toContain('authenticatedRequest');
    expect(client).not.toContain('.auth-token');
  });

  test('harness has no proof-signing checks to satisfy', () => {
    const harness = readSource('macos-bar/Sources/CCSBarCheck/main.swift');

    expect(harness).not.toContain('probe auth:');
    expect(harness).not.toContain('client auth:');
    expect(harness).not.toContain('x-ccs-bar-nonce');
    expect(harness).not.toContain('x-ccs-bar-token');
  });
});
