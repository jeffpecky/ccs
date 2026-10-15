import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as childProcess from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { CodexAdapter } from '../../../src/targets/codex-adapter';
import * as signalForwarder from '../../../src/utils/signal-forwarder';

// NOTE: the browser-codex-overrides helper module was stripped (a36a1238);
// this literal preserves coverage of the surviving generic
// runtimeConfigOverrides path in codex-adapter (strings derive from the
// assertions below: server name ccs_browser, pinned @playwright/mcp version).
const BROWSER_MCP_OVERRIDES = [
  'mcp_servers.ccs_browser.command="npx.cmd"',
  'mcp_servers.ccs_browser.args=["-y","@playwright/mcp@0.0.70"]',
];

function createMockChild(): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  exitCode: number | null;
  killed: boolean;
  pid: number;
  unref: () => EventEmitter;
  kill: () => boolean;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    exitCode: number | null;
    killed: boolean;
    pid: number;
    unref: () => EventEmitter;
    kill: () => boolean;
  };

  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.killed = false;
  child.pid = process.pid;
  child.unref = () => child;
  child.kill = () => {
    child.killed = true;
    child.exitCode = 1;
    return true;
  };

  return child;
}

describe('codex-adapter exec', () => {
  const originalPlatform = process.platform;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-codex-adapter-exec-'));
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('launches Windows cmd wrappers via cmd.exe when runtime overrides include browser MCP args', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    const fakeCodex = path.join(tmpDir, 'codex.cmd');
    fs.writeFileSync(fakeCodex, '');

    const spawnSpy = spyOn(childProcess, 'spawn').mockImplementation(
      () => createMockChild() as unknown as ReturnType<typeof childProcess.spawn>
    );
    const signalSpy = spyOn(signalForwarder, 'wireChildProcessSignals').mockImplementation(
      () => undefined
    );

    try {
      const adapter = new CodexAdapter();
      const binaryInfo = {
        path: fakeCodex,
        needsShell: true,
        features: ['config-overrides'],
      };
      const args = adapter.buildArgs('default', ['--version'], {
        profileType: 'default',
        creds: {
          profile: 'default',
          baseUrl: '',
          apiKey: '',
          runtimeConfigOverrides: BROWSER_MCP_OVERRIDES,
        },
        binaryInfo,
      });

      adapter.exec(args, {}, { binaryInfo });

      expect(spawnSpy).toHaveBeenCalledTimes(1);
      const [command, options] = spawnSpy.mock.calls[0] as [
        string,
        Record<string, unknown> | undefined,
      ];
      // ComSpec/SystemRoot casing varies per Windows install (e.g.
      // C:\WINDOWS\system32\cmd.exe), so compare the trusted system cmd.exe
      // path case-insensitively against the env-derived expectation.
      const expectedShell = path.win32.normalize(
        path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe')
      );
      expect(String(options?.shell ?? '').toLowerCase()).toBe(expectedShell.toLowerCase());
      expect(command).toContain(fakeCodex);
      expect(command).toContain('mcp_servers.ccs_browser.args=');
      expect(command).toContain('@playwright/mcp@0.0.70');
    } finally {
      spawnSpy.mockRestore();
      signalSpy.mockRestore();
    }
  });
});
