import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '../../..');

describe('Swift CCS Bar authenticated probe contract', () => {
  test('sends nonce and validates SHA-256 HMAC proof using token file', () => {
    const probe = readFileSync(
      join(repoRoot, 'macos-bar/Sources/CCSBarCore/BarServerProbe.swift'),
      'utf8'
    );
    const client = readFileSync(
      join(repoRoot, 'macos-bar/Sources/CCSBarCore/CCSBarClient.swift'),
      'utf8'
    );

    expect(probe).toContain('x-ccs-bar-nonce');
    expect(probe).toContain('x-ccs-bar-token');
    expect(probe).toContain('CCSBarClient.proof');
    expect(client).toContain('HMAC<SHA256>');
    expect(probe).toContain('.auth-token');
    expect(probe).not.toMatch(/return http\.statusCode == 200/);
  });

  test('harness covers valid, missing, and invalid proof responses', () => {
    const harness = readFileSync(
      join(repoRoot, 'macos-bar/Sources/CCSBarCheck/main.swift'),
      'utf8'
    );

    expect(harness).toContain('probe auth: valid proof accepted');
    expect(harness).toContain('probe auth: request proof sent');
    expect(harness).toContain('probe auth: missing proof rejected');
    expect(harness).toContain('probe auth: invalid proof rejected');
    expect(harness).toContain('probe auth: nonce header sent');
  });

  test('client signs summary, analytics, and mutation requests', () => {
    const client = readFileSync(
      join(repoRoot, 'macos-bar/Sources/CCSBarCore/CCSBarClient.swift'),
      'utf8'
    );
    expect(client).toContain('x-ccs-bar-nonce');
    expect(client).toContain('x-ccs-bar-token');
    expect(client).toContain('HMAC<SHA256>');
    expect(client).toMatch(/summary[\s\S]*authenticatedRequest/);
    expect(client).toMatch(/analytics[\s\S]*authenticatedRequest/);
    expect(client).toMatch(/func post[\s\S]*authenticatedRequest/);
    expect(client).toMatch(/authToken: String\? = BarServerProbe\.loadAuthToken\(\)/);
  });

  test('harness checks auth headers on reads and mutations', () => {
    const harness = readFileSync(
      join(repoRoot, 'macos-bar/Sources/CCSBarCheck/main.swift'),
      'utf8'
    );

    expect(harness).toContain('client auth: summary signed');
    expect(harness).toContain('client auth: analytics signed');
    expect(harness).toContain('client auth: mutation signed');
  });
});
