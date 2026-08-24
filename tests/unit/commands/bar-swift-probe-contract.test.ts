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

    expect(probe).toContain('x-ccs-bar-nonce');
    expect(probe).toContain('x-ccs-bar-token');
    expect(probe).toContain('HMAC<SHA256>');
    expect(probe).toContain('.auth-token');
    expect(probe).not.toMatch(/return http\.statusCode == 200/);
  });

  test('harness covers valid, missing, and invalid proof responses', () => {
    const harness = readFileSync(
      join(repoRoot, 'macos-bar/Sources/CCSBarCheck/main.swift'),
      'utf8'
    );

    expect(harness).toContain('probe auth: valid proof accepted');
    expect(harness).toContain('probe auth: missing proof rejected');
    expect(harness).toContain('probe auth: invalid proof rejected');
    expect(harness).toContain('probe auth: nonce header sent');
  });
});
