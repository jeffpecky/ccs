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
    expect(workflow.match(/gh release upload "\$STAGE"/g)?.length).toBe(1);
    expect(workflow).toContain('release-metadata.json');
    expect(workflow).toContain('macos-bar/VERSION');
    expect(workflow).not.toContain('windows-bar/VERSION');
  });

  test('pins every checkout to triggering commit', () => {
    const workflow = readFileSync(join(repoRoot, '.github/workflows/bar-release.yml'), 'utf8');
    expect(workflow.match(/uses: actions\/checkout@v4/g)?.length).toBe(3);
    expect(workflow.match(/ref: \$\{\{ github\.sha \}\}/g)?.length).toBe(3);
    expect(workflow).not.toContain('ref: main');
  });

  test('updates floating release without deletion and keeps rollback assets', () => {
    const workflow = readFileSync(join(repoRoot, '.github/workflows/bar-release.yml'), 'utf8');
    expect(workflow).not.toContain('gh release delete ccs-bar-latest');
    expect(workflow).toContain('ccs-bar-rollback-${{ github.sha }}');
    expect(workflow).toContain('trap rollback ERR');
    expect(workflow).toContain('gh release download ccs-bar-latest');
    expect(workflow).toContain('gh release upload ccs-bar-latest artifacts/* --repo jeffpecky/ccs --clobber');
  });
});
