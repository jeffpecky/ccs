import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '../../..');
const workflowPath = join(repoRoot, '.github/workflows/bar-release.yml');
const workflow = readFileSync(workflowPath, 'utf8');

describe('CCS Bar release workflow', () => {
  test('single unified workflow replaces per-platform release workflows', () => {
    expect(existsSync(workflowPath)).toBe(true);
    expect(existsSync(join(repoRoot, '.github/workflows/bar-release-windows.yml'))).toBe(false);
    expect(existsSync(join(repoRoot, '.github/workflows/bar-release-macos.yml'))).toBe(false);
  });

  test('runs both platform check suites before publishing', () => {
    expect(workflow).toContain('swift run ccs-bar-check');
    expect(workflow).toContain('dotnet test windows-bar/CCSBar.sln -c Release');
    expect(workflow).toContain('needs: [macos, windows]');

    const publishIndex = workflow.indexOf('publish:');
    expect(publishIndex).toBeGreaterThan(-1);
    expect(workflow.indexOf('swift run ccs-bar-check')).toBeLessThan(publishIndex);
    expect(workflow.indexOf('dotnet test windows-bar/CCSBar.sln -c Release')).toBeLessThan(
      publishIndex,
    );
  });

  test('pins every checkout to triggering commit', () => {
    expect(workflow.match(/uses: actions\/checkout@v4/g)?.length).toBe(3);
    expect(workflow.match(/ref: \$\{\{ github\.sha \}\}/g)?.length).toBe(3);
    expect(workflow).not.toContain('ref: main');
  });

  test('stages both platform assets from same SHA and publishes once', () => {
    expect(workflow).toContain('release-metadata.json');
    expect(workflow).toContain('macos-bar/VERSION');
    expect(workflow).not.toContain('windows-bar/VERSION');
    expect(workflow).toContain('CCS-Bar.app.zip');
    expect(workflow).toContain('CCS-Bar-windows-x64.zip');
    expect(workflow).toContain('CCS-Bar-windows-x64.zip.sha256');
    expect(workflow).toContain('version.txt');
    expect(
      workflow.match(/gh release upload ccs-bar-latest artifacts\/\* --clobber/g)?.length,
    ).toBe(1);
  });

  test('creates floating release when missing and keeps rollback assets', () => {
    expect(workflow).not.toContain('gh release delete ccs-bar-latest');
    expect(workflow).toContain('gh release view ccs-bar-latest');
    expect(workflow).toContain('gh release create ccs-bar-latest');
    expect(workflow).toContain('ccs-bar-rollback-${GITHUB_SHA}');
    expect(workflow).toContain('trap restore_backup ERR');
    expect(workflow).toContain('gh release download ccs-bar-latest');
  });

  test('triggers only on bar changes to main', () => {
    expect(workflow).toContain("'macos-bar/**'");
    expect(workflow).toContain("'windows-bar/**'");
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('branches: [main]');
  });
});
