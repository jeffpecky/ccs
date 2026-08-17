import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, '../../../../');
const forbiddenViewportHeightPattern = /\b(?:h-screen|min-h-screen)\b|calc\(100(?:d|l|s)?vh/i;

function readSource(relativePath: string): string {
  return readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

describe('Token Saver page contract', () => {
  it('relies on shared layout for viewport height', () => {
    expect(readSource('src/pages/token-saver.tsx')).not.toMatch(forbiddenViewportHeightPattern);
  });

  it('stays registered in router and sidebar navigation', () => {
    const appSource = readSource('src/App.tsx');
    const sidebarSource = readSource('src/components/layout/app-sidebar.tsx');

    expect(appSource).toContain('path="/token-saver"');
    expect(appSource).toContain('<TokenSaverPage />');
    expect(sidebarSource).toContain("path: '/token-saver'");
    expect(sidebarSource).toContain("label: 'Token Saver'");
  });
});
