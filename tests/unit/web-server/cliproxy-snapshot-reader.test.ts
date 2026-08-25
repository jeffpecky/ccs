/**
 * CLIProxy snapshot reader — startup/event-loop safety contract.
 *
 * The reader sits on the /api/bar/summary cost-mapping path, so its filesystem
 * work must be asynchronous (off the event loop) and bounded (a pathologically
 * large snapshot must never be slurped into memory).
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { loadCliproxySnapshotDetails } from '../../../src/web-server/usage/cliproxy-snapshot-reader';

function detail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: 'claude-sonnet-4',
    timestamp: '2026-08-01T00:00:00.000Z',
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    requestCount: 1,
    cost: 0.01,
    failed: false,
    ...overrides,
  };
}

describe('cliproxy snapshot reader', () => {
  let tempHome = '';
  let originalCcsHome: string | undefined;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-cliproxy-snapshot-'));
    originalCcsHome = process.env.CCS_HOME;
    process.env.CCS_HOME = tempHome;
  });

  afterEach(() => {
    if (originalCcsHome === undefined) delete process.env.CCS_HOME;
    else process.env.CCS_HOME = originalCcsHome;
    fs.rmSync(tempHome, { recursive: true, force: true });
    tempHome = '';
  });

  function writeSnapshot(content: string): void {
    const dir = path.join(tempHome, '.ccs', 'cache', 'cliproxy-usage');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'latest.json'), content, 'utf-8');
  }

  it('reads normalized details from a v3 snapshot', async () => {
    writeSnapshot(
      JSON.stringify({ version: 3, timestamp: Date.now(), details: [detail()] })
    );

    const details = await loadCliproxySnapshotDetails();

    expect(details).toHaveLength(1);
    expect(details[0]?.model).toBe('claude-sonnet-4');
  });

  it('returns empty for missing, corrupt, or unsupported snapshots', async () => {
    expect(await loadCliproxySnapshotDetails()).toEqual([]);

    writeSnapshot('{not json');
    expect(await loadCliproxySnapshotDetails()).toEqual([]);

    writeSnapshot(JSON.stringify({ version: 2, timestamp: Date.now(), daily: [] }));
    expect(await loadCliproxySnapshotDetails()).toEqual([]);
  });

  it('skips snapshots beyond the size bound instead of blocking on them', async () => {
    // A snapshot larger than the reader's hard cap must not be parsed; the
    // bar glance degrades to no cliproxy rows rather than stalling the loop.
    const hugeDetails = JSON.stringify({
      version: 3,
      timestamp: Date.now(),
      details: Array.from({ length: 4096 }, (_, i) =>
        detail({ model: `model-${i}`, timestamp: `2026-08-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z` })
      ),
    });

    writeSnapshot(hugeDetails.padEnd(33 * 1024 * 1024, ' '));

    const startedAt = Date.now();
    const details = await loadCliproxySnapshotDetails();
    expect(details).toEqual([]);
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });
});
