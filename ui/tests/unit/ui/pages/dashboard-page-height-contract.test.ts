import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, '../../../../');

const layoutManagedRouteFiles = [
  'src/pages/home.tsx',
  'src/pages/analytics/index.tsx',
  'src/pages/cliproxy.tsx',
  'src/pages/cliproxy-ai-providers.tsx',
  'src/pages/cliproxy-control-panel.tsx',
  'src/pages/copilot.tsx',
  'src/pages/cursor.tsx',
  'src/pages/settings/index.tsx',
  'src/pages/health.tsx',
] as const;

const forbiddenViewportHeightPattern = /\b(?:h-screen|min-h-screen)\b|calc\(100(?:d|l|s)?vh/i;

function readSource(relativePath: string): string {
  return readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

describe('dashboard route height contract', () => {
  it('routes home through the direct page import', () => {
    expect(readSource('src/App.tsx')).toContain("import { HomePage } from '@/pages/home';");
  });

  it.each(layoutManagedRouteFiles)(
    '%s relies on the shared layout for viewport height',
    (relativePath) => {
      const source = readSource(relativePath);

      expect(source).not.toMatch(forbiddenViewportHeightPattern);
    }
  );
});
