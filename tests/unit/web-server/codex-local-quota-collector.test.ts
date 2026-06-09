/**
 * Tests for the Codex local quota collector (zero network).
 *
 * Uses a temp fixture rollout-*.jsonl read via the real Bun.spawn(['tail', ...])
 * default impl (macOS-safe) plus injected fs seams for the directory walk.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getCodexLocalQuota } from '../../../src/web-server/usage/codex-local-quota-collector';

let tmpDir: string;
let codexHome: string;
let sessionsDir: string;

function tokenCountLine(rateLimits: unknown): string {
  return JSON.stringify({
    timestamp: '2026-06-09T14:36:48.896Z',
    type: 'event_msg',
    payload: { type: 'token_count', info: {}, rate_limits: rateLimits },
  });
}

function writeRollout(name: string, lines: string[]): string {
  const day = path.join(sessionsDir, '2026', '06', '09');
  fs.mkdirSync(day, { recursive: true });
  const file = path.join(day, name);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-local-quota-'));
  codexHome = path.join(tmpDir, '.codex');
  sessionsDir = path.join(codexHome, 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('getCodexLocalQuota', () => {
  it('parses the last non-null rate_limits into a normalized quota', async () => {
    writeRollout('rollout-2026-06-09T10-00-00-aaaa.jsonl', [
      tokenCountLine(null),
      tokenCountLine({
        primary: { used_percent: 0.0, window_minutes: 300, resets_at: 1781033803 },
        secondary: { used_percent: 48.0, window_minutes: 10080, resets_at: 1781192122 },
        plan_type: 'pro',
      }),
    ]);

    const quota = await getCodexLocalQuota({ env: { CODEX_HOME: codexHome }, now: Date.now() });
    expect(quota).not.toBeNull();
    // min(100-0, 100-48) = 52
    expect(quota?.quotaPercentage).toBe(52);
    expect(quota?.tier).toBe('pro');
    // soonest reset = min(1781033803, 1781192122) -> primary
    expect(quota?.nextReset).toBe(new Date(1781033803 * 1000).toISOString());
    expect(quota?.stale).toBe(false);
  });

  it('returns null when every rate_limits is null (exec-mode session)', async () => {
    // A newer session (later filename) with only null rate_limits wins the sort.
    writeRollout('rollout-2026-06-09T11-00-00-bbbb.jsonl', [
      tokenCountLine(null),
      tokenCountLine(null),
    ]);
    const quota = await getCodexLocalQuota({ env: { CODEX_HOME: codexHome }, now: Date.now() });
    expect(quota).toBeNull();
  });

  it('flags stale when the source file mtime is older than 5 minutes', async () => {
    const file = writeRollout('rollout-2026-06-09T12-00-00-cccc.jsonl', [
      tokenCountLine({
        primary: { used_percent: 10, window_minutes: 300, resets_at: 1781033803 },
        secondary: { used_percent: 5, window_minutes: 10080, resets_at: 1781192122 },
        plan_type: 'plus',
      }),
    ]);
    const mtime = fs.statSync(file).mtimeMs;
    // now = mtime + 6 minutes -> stale
    const quota = await getCodexLocalQuota({
      env: { CODEX_HOME: codexHome },
      now: mtime + 6 * 60 * 1000,
    });
    expect(quota?.stale).toBe(true);
    expect(quota?.tier).toBe('plus');
  });

  it('returns null when there are no rollout files at all', async () => {
    const emptyHome = path.join(tmpDir, '.codex-empty');
    fs.mkdirSync(path.join(emptyHome, 'sessions'), { recursive: true });
    const quota = await getCodexLocalQuota({ env: { CODEX_HOME: emptyHome }, now: Date.now() });
    expect(quota).toBeNull();
  });
});
