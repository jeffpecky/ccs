import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '../../..');

describe('CCS Bar release workflow', () => {
  test('stages both platform assets from same SHA and publishes once', () => {
    const workflow = readFileSync(join(repoRoot, '.github/workflows/bar-release.yml'), 'utf8');
    const checkIndex = workflow.indexOf('swift run ccs-bar-check');
    const uploadIndex = workflow.indexOf('gh release upload');

    expect(checkIndex).toBeGreaterThan(-1);
    expect(uploadIndex).toBeGreaterThan(checkIndex);
    expect(workflow).toContain('needs: [macos, windows]');
    expect(workflow).toContain('github.sha');
    expect(workflow.match(/gh release upload/g)?.length).toBe(1);
    expect(workflow).toContain('release-metadata.json');
    expect(workflow).toContain('macos-bar/VERSION');
    expect(workflow).not.toContain('windows-bar/VERSION');
  });
});
