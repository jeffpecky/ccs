import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '../../..');

describe('CCS Bar release workflow', () => {
  test('checks Swift harness before publishing and creates floating release when absent', () => {
    const workflow = readFileSync(join(repoRoot, '.github/workflows/bar-release.yml'), 'utf8');
    const checkIndex = workflow.indexOf('swift run ccs-bar-check');
    const uploadIndex = workflow.indexOf('gh release upload ccs-bar-latest');

    expect(checkIndex).toBeGreaterThan(-1);
    expect(uploadIndex).toBeGreaterThan(checkIndex);
    expect(workflow).toMatch(
      /gh release view ccs-bar-latest[\s\S]*gh release create ccs-bar-latest/
    );
  });
});
