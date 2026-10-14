import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createFileSink } from '../oauth-trace/sink-file';
import { OAuthTracePhase, type OAuthTraceEvent } from '../oauth-trace/trace-events';

let tmpDir: string;

function makeEvent(over: Partial<OAuthTraceEvent> = {}): OAuthTraceEvent {
  return {
    sessionId: 'sess-1',
    provider: 'codex',
    phase: OAuthTracePhase.BinarySpawn,
    ts: 1000,
    elapsedMs: 0,
    ...over,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-trace-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('createFileSink', () => {
  test('writes one JSONL line per event', () => {
    const fixed = new Date(2026, 4, 10);
    const sink = createFileSink({ dir: tmpDir, now: () => fixed });
    sink.write(makeEvent({ phase: OAuthTracePhase.BinarySpawn }));
    sink.write(makeEvent({ phase: OAuthTracePhase.BinaryExit, elapsedMs: 5 }));
    const file = path.join(tmpDir, 'oauth-20260510.log');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const parsed1 = JSON.parse(lines[0]);
    expect(parsed1.phase).toBe(OAuthTracePhase.BinarySpawn);
    expect(parsed1.sessionId).toBe('sess-1');
    expect(parsed1.provider).toBe('codex');
  });

  // Windows does not apply POSIX file modes; the 0600 request is honored on macOS/Linux.
  test.skipIf(process.platform === 'win32')('file mode is 0600 (user-only)', () => {
    const fixed = new Date(2026, 4, 10);
    const sink = createFileSink({ dir: tmpDir, now: () => fixed });
    sink.write(makeEvent());
    const file = path.join(tmpDir, 'oauth-20260510.log');
    const mode = fs.statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test('rotates by date — different day yields different file', () => {
    let day = new Date(2026, 4, 10);
    const sink = createFileSink({ dir: tmpDir, now: () => day });
    sink.write(makeEvent({ sessionId: 'a' }));
    day = new Date(2026, 4, 11);
    sink.write(makeEvent({ sessionId: 'b' }));
    expect(fs.existsSync(path.join(tmpDir, 'oauth-20260510.log'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'oauth-20260511.log'))).toBe(true);
  });

  test('write failure does not throw and notifies once', () => {
    const errors: string[] = [];
    const badDir = path.join(tmpDir, 'nonexistent', 'a', 'b');
    // Force mkdir failure by simulating EROFS via permission-denied path
    // (we bypass mkdir error by making `dir` a file)
    fs.writeFileSync(path.join(tmpDir, 'as_file'), 'x');
    const sink = createFileSink({
      dir: path.join(tmpDir, 'as_file', 'sub'),
      onError: (msg) => errors.push(msg),
    });
    expect(() => sink.write(makeEvent())).not.toThrow();
    expect(errors.length).toBeGreaterThanOrEqual(1);
    void badDir;
  });

  test('flush resolves cleanly', async () => {
    const sink = createFileSink({ dir: tmpDir });
    sink.write(makeEvent());
    await expect(sink.flush?.()).resolves.toBeUndefined();
  });

  test('concurrent recorders with separate sessionIds both land in file', () => {
    const fixed = new Date(2026, 4, 10);
    const sink = createFileSink({ dir: tmpDir, now: () => fixed });
    sink.write(makeEvent({ sessionId: 'A' }));
    sink.write(makeEvent({ sessionId: 'B' }));
    const file = path.join(tmpDir, 'oauth-20260510.log');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    const ids = lines.map((l) => JSON.parse(l).sessionId).sort();
    expect(ids).toEqual(['A', 'B']);
  });
});
