import { describe, expect, it } from 'bun:test';

import { ensureCliproxyService } from '../../service-manager';

describe('ensureCliproxyService', () => {
  it('fails fast without attempting a runtime install when the local binary is missing', async () => {
    // Inject stubs via the deps seam instead of bun's `mock.module()`. The
    // module-level mock approach is process-wide and was previously leaking
    // stubbed binary-manager / stats-fetcher modules into unrelated test
    // suites (notably cliproxy-stats-routes-*) that import them transitively.
    const ensureBinaryCalls: Array<unknown> = [];

    const result = await ensureCliproxyService(8317, false, {
      ensureBinaryFn: async (_verbose, options) => {
        ensureBinaryCalls.push(options);
        throw new Error(
          'CLIProxy Plus binary is not installed locally. Install CLIProxy from the dashboard control panel when you have network access.'
        );
      },
      detectRunningProxyFn: async () => ({ running: false, verified: false }),
      configNeedsRegenerationFn: () => false,
      withStartupLockFn: async (fn) => await fn(),
    });

    expect(result).toEqual({
      started: false,
      alreadyRunning: false,
      port: 8317,
      error:
        'Failed to prepare binary: CLIProxy Plus binary is not installed locally. Install CLIProxy from the dashboard control panel when you have network access.',
    });
    expect(ensureBinaryCalls).toEqual([
      {
        allowInstall: false,
        skipAutoUpdate: true,
      },
    ]);
  });
});
