import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// NOTE: Entries pointing at profiles/editor/*, compatible-cli/*, pages/api.tsx and
// shared/settings-dialog.tsx were removed, and cliproxy-ai-providers.tsx was dropped,
// because fork commits 28fe9b08/a6267705/fb7ead37 deleted or changed those files
// (the latter switched cliproxy-ai-providers.tsx from fill-parent to content).
// The contract mechanism is kept intact for future bounded consumers.
const boundedConsumers = [
  {
    file: 'src/components/cliproxy/provider-editor/raw-editor-section.tsx',
    expectedCount: 1,
  },
  {
    file: 'src/components/copilot/config-form/raw-editor-section.tsx',
    expectedCount: 1,
  },
] as const;

const boundedLayoutContracts = [
  {
    file: 'src/components/cliproxy/provider-editor/index.tsx',
    snippets: [
      'min-h-0 flex-1 grid grid-cols-[40%_60%] divide-x overflow-hidden',
      'flex min-h-0 min-w-0 flex-col overflow-hidden',
    ],
  },
] as const;

describe('bounded CodeEditor consumers', () => {
  it.each(boundedConsumers)(
    '$file opts into fill-parent mode for every bounded editor',
    ({ file, expectedCount }) => {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      const matches = source.match(/heightMode="fill-parent"/g) ?? [];

      expect(matches).toHaveLength(expectedCount);
    }
  );

  it.each(boundedLayoutContracts)(
    '$file keeps bounded editor ancestors shrinkable',
    ({ file, snippets }) => {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');

      for (const snippet of snippets) {
        expect(source).toContain(snippet);
      }
    }
  );
});
