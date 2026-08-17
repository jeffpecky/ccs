import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

describe('bundle import boundaries', () => {
  it('imports HomePage directly and keeps the pages barrel out of App', () => {
    const app = readSource('src/App.tsx');

    expect(app).toContain("import { HomePage } from '@/pages/home';");
    expect(app).not.toMatch(/from ['"]@\/pages['"]/);
  });

  it('removes the unused route-page barrel', () => {
    expect(existsSync(resolve(process.cwd(), 'src/pages/index.tsx'))).toBe(false);
  });

  it('gives production CodeEditor consumers one lazy boundary', () => {
    const consumers = [
      'src/pages/settings/index.tsx',
      'src/pages/cliproxy-ai-providers.tsx',
      'src/components/cliproxy/provider-editor/raw-editor-section.tsx',
      'src/components/cliproxy/cli-provider-editor/cli-raw-editor-section.tsx',
      'src/components/copilot/config-form/raw-editor-section.tsx',
    ];

    for (const file of consumers) {
      const source = readSource(file);
      expect(source, file).toContain("from '@/components/shared/lazy-code-editor'");
      expect(source, file).not.toContain("from '@/components/shared/code-editor'");
      expect(source, file).not.toContain("import('@/components/shared/code-editor')");
    }

    expect(readSource('src/components/shared/lazy-code-editor.tsx')).toContain(
      "import('@/components/shared/code-editor')"
    );
  });

  it('keeps shared i18n dependencies outside the main chunk', () => {
    const viteConfig = readSource('vite.config.ts');

    expect(viteConfig).toMatch(/node_modules.*i18next.*react-i18next.*return 'i18n-vendor'/s);
  });

  it('assigns only Recharts modules to the charts chunk', () => {
    const viteConfig = readSource('vite.config.ts');

    expect(viteConfig).not.toContain("charts: ['recharts']");
    expect(viteConfig).toContain("if (id.includes('/node_modules/recharts/')) return 'charts';");
    expect(viteConfig).toContain(
      "if (id.includes('/node_modules/lodash/')) return 'lodash-vendor';"
    );
    expect(viteConfig).toContain(
      "if (id.includes('/node_modules/@babel/runtime/')) return 'babel-runtime';"
    );
  });
});
