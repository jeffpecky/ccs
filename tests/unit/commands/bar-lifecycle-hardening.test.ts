import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import {
  defaultFindRunningServer,
  resolveBarPort,
} from '../../../src/commands/bar/bar-server-probe';
import {
  serializeBarServerProcessRecord,
  getProcessBirthIdentity,
  parseBarServerProcessRecord,
  claimStaleBarServerProcessRecord,
  removeBarDiscoveryIfNoProcess,
  removeBarServerProcessRecordIfOwned,
  stopDetachedBarServer,
  stopBarServerProcessFile,
  stopRecordedBarServer,
  waitForProcessExit,
} from '../../../src/commands/bar/bar-process-control';
import { parseLaunchIdFlag, parsePortFlag, validatePortArgs } from '../../../src/commands/bar/port-arg';
import {
  getLatestLaunchPointerPath,
  LATEST_LAUNCH_SCHEMA,
  readLatestLaunchPointer,
} from '../../../src/commands/bar/bar-paths';
import { handleBarServe } from '../../../src/commands/bar/serve-subcommand';
import { handleBarStop } from '../../../src/commands/bar/stop-subcommand';
import type { LatestLaunchPointer } from '../../../src/commands/bar/bar-paths';

// Dispatcher suites mock.module('launch-subcommand') and those patches persist
// across files in a Bun worker, so load a private real instance here.
let moduleSeq = 0;

async function loadTransactionalLaunch() {
  moduleSeq += 1;
  return import(
    `../../../src/commands/bar/launch-subcommand?test=${Date.now()}-${moduleSeq}`
  ) as Promise<{
    handleBarLaunch: (args: string[], deps?: Record<string, unknown>) => Promise<void>;
    BarServerTimeoutError: new (baseUrl: string, timeoutSeconds: number) => Error;
  }>;
}

let tempHome: string;
let originalHome: string | undefined;
let originalCcsHome: string | undefined;
const liveChildren = new Set<ReturnType<typeof spawn>>();

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-bar-lifecycle-'));
  originalHome = process.env.HOME;
  originalCcsHome = process.env.CCS_HOME;
  process.env.HOME = tempHome;
  process.env.CCS_HOME = path.join(tempHome, '.ccs');
  process.exitCode = 0;
});

afterEach(async () => {
  const exits = [...liveChildren].map((child) => waitForChildExit(child, 5_000));
  for (const child of liveChildren) {
    try {
      child.kill('SIGKILL');
    } catch {
      // Already exited.
    }
  }
  await Promise.allSettled(exits);
  liveChildren.clear();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalCcsHome === undefined) delete process.env.CCS_HOME;
  else process.env.CCS_HOME = originalCcsHome;
  process.exitCode = 0;
  fs.rmSync(tempHome, { recursive: true, force: true });
});

describe('strict Bar port parsing', () => {
  it('rejects numeric prefixes, fractions, signs, whitespace, and out-of-range values', () => {
    for (const raw of ['3999junk', '3.5', '+3999', ' 3999', '0', '65536']) {
      expect(parsePortFlag(['--port', raw])).toEqual({ present: true, port: null });
    }
    expect(parsePortFlag(['--port', '3999'])).toEqual({ present: true, port: 3999 });
  });

  it('rejects unknown and duplicate launch options', () => {
    expect(validatePortArgs(['--porrt', '3999'])).toBe('Unknown option: --porrt');
    expect(validatePortArgs(['--port', '3999', '--port', '4000'])).toBe('Duplicate option: --port');
  });

  it('rejects malformed persisted ports in both discovery files', () => {
    const ccsDir = process.env.CCS_HOME!;
    fs.mkdirSync(path.join(ccsDir, 'bar'), { recursive: true });
    fs.writeFileSync(path.join(ccsDir, 'bar.json'), JSON.stringify({ port: 3999.5 }));
    fs.writeFileSync(
      path.join(ccsDir, 'bar', 'launch.json'),
      JSON.stringify({ args: ['ccs.js', 'bar', 'serve', '--port', '4555junk'] })
    );
    expect(resolveBarPort(ccsDir)).toBeNull();
  });
});

describe('verified Bar process stopping', () => {
  const rawRecord = serializeBarServerProcessRecord({ pid: 4321, birthIdentity: 'birth-a' });

  it('does not signal when the PID birth identity changed', async () => {
    let signaled = false;
    const outcome = await stopRecordedBarServer(rawRecord, {
      getProcessBirthIdentity: () => 'birth-b',
      killProcess: () => {
        signaled = true;
      },
    });
    expect(outcome.result).toBe('identity-mismatch');
    expect(signaled).toBe(false);
  });

  it('polls Windows process state until exit instead of assuming SIGTERM succeeded', async () => {
    const states = [true, true, false];
    let sleeps = 0;

    const outcome = await waitForProcessExit(4321, 'birth-a', 1_000, {
      getProcessBirthIdentity: () => (states.shift() ?? false ? 'birth-a' : null),
      sleep: async () => {
        sleeps += 1;
      },
    });

    expect(outcome).toBe('exited');
    expect(sleeps).toBe(2);
  });

  it('returns timeout when Windows target remains alive for the bounded wait', async () => {
    let now = 0;
    const outcome = await waitForProcessExit(4321, 'birth-a', 250, {
      getProcessBirthIdentity: () => 'birth-a',
      now: () => now,
      sleep: async () => {
        now += 100;
      },
    });

    expect(outcome).toBe('timeout');
  });

  it('observes Windows exit reached during the final bounded sleep', async () => {
    let now = 0;
    const states = [true, false];

    const outcome = await waitForProcessExit(4321, 'birth-a', 50, {
      getProcessBirthIdentity: () => (states.shift() ?? false ? 'birth-a' : null),
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });

    expect(outcome).toBe('exited');
    expect(now).toBe(50);
  });

  it('preserves server.pid and bar.json on mismatch, EPERM, and timeout', async () => {
    for (const failure of [
      'identity-mismatch',
      'permission-denied',
      'signal-failed',
      'timeout',
    ] as const) {
      const ccsDir = path.join(tempHome, failure);
      const pidPath = path.join(ccsDir, 'bar', 'server.pid');
      const barJsonPath = path.join(ccsDir, 'bar.json');
      fs.mkdirSync(path.dirname(pidPath), { recursive: true });
      fs.writeFileSync(pidPath, rawRecord);
      fs.writeFileSync(barJsonPath, '{}');

      await handleBarStop([], {
        getCcsDir: () => ccsDir,
        getProcessBirthIdentity: () => (failure === 'identity-mismatch' ? 'birth-b' : 'birth-a'),
        killProcess: () => {
          if (failure === 'permission-denied') {
            const err = new Error('not permitted') as NodeJS.ErrnoException;
            err.code = 'EPERM';
            throw err;
          }
          if (failure === 'signal-failed') throw new Error('signal transport failed');
        },
        waitForProcessExit: async () => (failure === 'timeout' ? 'timeout' : 'exited'),
      });

      expect(fs.existsSync(pidPath)).toBe(true);
      expect(fs.existsSync(barJsonPath)).toBe(true);
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;
    }
  });

  it('never signals a legacy integer PID and gives manual recovery guidance', async () => {
    const ccsDir = path.join(tempHome, 'legacy');
    const pidPath = path.join(ccsDir, 'bar', 'server.pid');
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    fs.writeFileSync(pidPath, '4321');
    let signaled = false;

    await handleBarStop([], {
      getCcsDir: () => ccsDir,
      killProcess: () => {
        signaled = true;
      },
    });

    expect(signaled).toBe(false);
    expect(fs.existsSync(pidPath)).toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it('atomically preserves a replacement record written while the old process stops', async () => {
    const pidPath = path.join(tempHome, 'race', 'server.pid');
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    fs.writeFileSync(pidPath, rawRecord);
    const replacement = serializeBarServerProcessRecord({
      pid: 9876,
      birthIdentity: 'replacement-birth',
    });

    const outcome = await stopBarServerProcessFile(pidPath, {
      getProcessBirthIdentity: () => 'birth-a',
      killProcess: () => fs.writeFileSync(pidPath, replacement),
      waitForProcessExit: async () => 'exited',
    });

    expect(outcome.result).toBe('stopped');
    expect(fs.readFileSync(pidPath, 'utf8')).toBe(replacement);
  });

  it('does not let an old serve cleanup unlink a replacement record', () => {
    const pidPath = path.join(tempHome, 'serve-race', 'server.pid');
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    const replacement = serializeBarServerProcessRecord({
      pid: 9876,
      birthIdentity: 'replacement-birth',
    });
    fs.writeFileSync(pidPath, replacement);

    removeBarServerProcessRecordIfOwned(pidPath, { pid: 4321, birthIdentity: 'birth-a' });

    expect(fs.readFileSync(pidPath, 'utf8')).toBe(replacement);
  });

  it('stops a real recorded process through the claimed process file', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    liveChildren.add(child);
    const birthIdentity = await waitForBirthIdentity(child.pid!);
    const pidPath = path.join(tempHome, 'real-stop', 'server.pid');
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    fs.writeFileSync(pidPath, serializeBarServerProcessRecord({ pid: child.pid!, birthIdentity }));

    const childExit = waitForChildExit(child, 5_000);
    const outcome = await stopBarServerProcessFile(pidPath);
    await childExit;

    expect(outcome.result).toBe('stopped');
    expect(fs.existsSync(pidPath)).toBe(false);
    liveChildren.delete(child);
  }, 30000);

  it('stops a real recorded process through the launch-move stop path', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    liveChildren.add(child);
    const birthIdentity = await waitForBirthIdentity(child.pid!);
    const ccsDir = path.join(tempHome, 'real-move');
    const pidPath = path.join(ccsDir, 'bar', 'server.pid');
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    fs.writeFileSync(pidPath, serializeBarServerProcessRecord({ pid: child.pid!, birthIdentity }));
    const childExit = waitForChildExit(child, 5_000);
    await stopDetachedBarServer(ccsDir);
    await childExit;

    expect(fs.existsSync(pidPath)).toBe(false);
    liveChildren.delete(child);
  }, 30000);
});

describe('Bar serve publication ownership', () => {
  it('publishes server.pid before bar.json so old-stop cleanup preserves replacement discovery', async () => {
    const ccsDir = path.join(tempHome, 'serve-publication');
    const pidPath = path.join(ccsDir, 'bar', 'server.pid');
    const barJsonPath = path.join(ccsDir, 'bar.json');
    const publicationOrder: string[] = [];
    let oldStopRemovedDiscovery: boolean | null = null;

    await handleBarServe(['--port', '4555'], {
      getCcsDir: () => ccsDir,
      findRunningServer: async () => null,
      getPort: async () => 4555,
      startServer: async () => ({ port: 4555, baseUrl: 'http://127.0.0.1:4555' }),
      getProcessBirthIdentity: () => 'replacement-birth',
      writeFile: (filePath, content) => {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
        publicationOrder.push(filePath);
        if (filePath === barJsonPath) {
          oldStopRemovedDiscovery = removeBarDiscoveryIfNoProcess(barJsonPath, pidPath);
        }
      },
      onSignal: () => {},
      exit: (code) => {
        throw new Error(`unexpected exit ${code}`);
      },
    });

    expect(publicationOrder).toEqual([pidPath, barJsonPath]);
    expect(oldStopRemovedDiscovery).toBe(false);
    expect(fs.existsSync(pidPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(barJsonPath, 'utf8')).port).toBe(4555);
  });

  it('conditionally rolls back its owned process record when discovery publication fails', async () => {
    const ccsDir = path.join(tempHome, 'serve-rollback');
    const pidPath = path.join(ccsDir, 'bar', 'server.pid');
    const barJsonPath = path.join(ccsDir, 'bar.json');

    await expect(
      handleBarServe(['--port', '4555'], {
        getCcsDir: () => ccsDir,
        findRunningServer: async () => null,
        getPort: async () => 4555,
        startServer: async () => ({ port: 4555, baseUrl: 'http://127.0.0.1:4555' }),
        getProcessBirthIdentity: () => 'replacement-birth',
        writeFile: (filePath, content) => {
          if (filePath === barJsonPath) throw new Error('discovery write failed');
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, content);
        },
        onSignal: () => {},
        exit: (code) => {
          throw new Error(`exit ${code}`);
        },
      })
    ).rejects.toThrow('exit 1');

    expect(fs.existsSync(pidPath)).toBe(false);
  });
});

describe('transactional detached launch', () => {
  interface LaunchHarness {
    ccsDir: string;
    events: string[];
    pointerPath: string;
    launchesDir: string;
  }

  function makeLaunchHarness(name: string): LaunchHarness {
    const ccsDir = path.join(tempHome, name);
    fs.mkdirSync(ccsDir, { recursive: true });
    return {
      ccsDir,
      events: [],
      pointerPath: getLatestLaunchPointerPath(ccsDir),
      launchesDir: path.join(ccsDir, 'bar', 'launches'),
    };
  }

  async function loadLaunch() {
    return import('../../../src/commands/bar/launch-subcommand');
  }

  it('kills a bound-but-unresponsive detached child and preserves prior discovery state', async () => {
    const harness = makeLaunchHarness('unresponsive-child');
    const port = 4577;
    const priorBarJson = path.join(harness.ccsDir, 'bar.json');
    const priorLaunchJson = path.join(harness.ccsDir, 'bar', 'launch.json');
    fs.mkdirSync(path.dirname(priorLaunchJson), { recursive: true });
    fs.writeFileSync(priorBarJson, '{"port":3000,"baseUrl":"http://127.0.0.1:3000"}');
    fs.writeFileSync(priorLaunchJson, '{"schema":1,"prior":true}');

    const unresponsiveChild = spawn(
      process.execPath,
      [
        '-e',
        `const net=require('net');net.createServer(s=>{s.on('error',()=>{})}).listen(${port},'127.0.0.1');setInterval(()=>{},1000);`,
      ],
      { stdio: 'ignore' }
    );
    liveChildren.add(unresponsiveChild);

    let killed = false;
    const { handleBarLaunch, BarServerTimeoutError } = await loadTransactionalLaunch();
    await handleBarLaunch(['--port', String(port)], {
      getCcsDir: () => harness.ccsDir,
      findRunningServer: async () => null,
      getPort: async () => port,
      spawnDetachedServer: (_p: number, logPath: string) => {
        harness.events.push('spawn');
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.closeSync(fs.openSync(logPath, 'a'));
        return {
          pid: unresponsiveChild.pid,
          kill: () => {
            killed = true;
            try {
              unresponsiveChild.kill('SIGKILL');
            } catch {
              /* already gone */
            }
            return true;
          },
        };
      },
      waitForServerLive: async () => {
        harness.events.push('health-failed');
        throw new BarServerTimeoutError(`http://127.0.0.1:${port}`, 10);
      },
      writeLaunchDescriptor: () => {
        harness.events.push('descriptor');
      },
      openApp: async () => {},
      appInstallPath: path.join(tempHome, 'Applications', 'CCS Bar.app'),
    });

    expect(killed).toBe(true);
    await waitForChildExit(unresponsiveChild, 5_000);
    liveChildren.delete(unresponsiveChild);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;

    expect(fs.readFileSync(priorBarJson, 'utf8')).toBe('{"port":3000,"baseUrl":"http://127.0.0.1:3000"}');
    expect(fs.readFileSync(priorLaunchJson, 'utf8')).toBe('{"schema":1,"prior":true}');

    const pointer = JSON.parse(fs.readFileSync(harness.pointerPath, 'utf8')) as LatestLaunchPointer;
    expect(pointer.schema).toBe(LATEST_LAUNCH_SCHEMA);
    expect(typeof pointer.launchId).toBe('string');
    expect(pointer.launchId.length).toBeGreaterThan(0);
    expect(pointer.port).toBe(port);
    expect(pointer.logPath).toBe(path.join(harness.launchesDir, pointer.launchId, 'serve.log'));
    expect(fs.existsSync(pointer.logPath)).toBe(true);
    expect(pointer.status).toBe('failed');

    const launchDirs = fs.readdirSync(harness.launchesDir);
    expect(launchDirs.sort()).toEqual([pointer.launchId].sort());
  }, 30000);

  it('publishes discovery and descriptor only after authenticated health succeeds', async () => {
    const harness = makeLaunchHarness('publication-order');
    const { handleBarLaunch } = await loadTransactionalLaunch();

    await handleBarLaunch(['--port', '4556'], {
      getCcsDir: () => harness.ccsDir,
      findRunningServer: async () => null,
      getPort: async () => 4556,
      spawnDetachedServer: () => {
        harness.events.push('spawn');
        return { pid: 455601, kill: () => true };
      },
      waitForServerLive: async () => {
        harness.events.push('health-ok');
      },
      writeLaunchDescriptor: () => {
        harness.events.push('descriptor');
      },
      openApp: async () => {},
      appInstallPath: path.join(tempHome, 'Applications', 'CCS Bar.app'),
    });

    expect(harness.events.indexOf('spawn')).toBeGreaterThanOrEqual(0);
    expect(harness.events.indexOf('health-ok')).toBeGreaterThan(harness.events.indexOf('spawn'));
    expect(harness.events.indexOf('descriptor')).toBeGreaterThan(harness.events.indexOf('health-ok'));
    expect(process.exitCode).toBe(0);

    const pointer = JSON.parse(fs.readFileSync(harness.pointerPath, 'utf8')) as LatestLaunchPointer;
    expect(pointer.status).toBe('ready');
    const barJson = JSON.parse(
      fs.readFileSync(path.join(harness.ccsDir, 'bar.json'), 'utf8')
    ) as { port: number; launchId?: string };
    expect(barJson.port).toBe(4556);
    expect(barJson.launchId).toBe(pointer.launchId);
  });

  it('stamps one launch identity across pointer, per-launch log, and discovery', async () => {
    const harness = makeLaunchHarness('identity-threading');
    const ids = ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002'];
    let idIndex = 0;
    const { handleBarLaunch } = await loadTransactionalLaunch();

    for (const expectedId of ids) {
      await handleBarLaunch(['--port', '4558'], {
        getCcsDir: () => harness.ccsDir,
        createLaunchId: () => ids[idIndex++]!,
        findRunningServer: async () => null,
        getPort: async () => 4558,
        spawnDetachedServer: () => ({ pid: 455801, kill: () => true }),
        waitForServerLive: async () => {},
        writeLaunchDescriptor: () => {},
        openApp: async () => {},
        appInstallPath: path.join(tempHome, 'Applications', 'CCS Bar.app'),
      });
      expect(process.exitCode).toBe(0);
    }

    const pointer = JSON.parse(fs.readFileSync(harness.pointerPath, 'utf8')) as LatestLaunchPointer;
    expect(pointer.launchId).toBe(ids[1]);
    expect(pointer.status).toBe('ready');
    const barJson = JSON.parse(
      fs.readFileSync(path.join(harness.ccsDir, 'bar.json'), 'utf8')
    ) as { launchId?: string };
    expect(barJson.launchId).toBe(ids[1]);
    expect(fs.readdirSync(harness.launchesDir).sort()).toEqual([...ids].sort());
  });

  it('replaces the latest-launch pointer without append-only history files', () => {
    const ccsDir = path.join(tempHome, 'pointer-replace');
    const barDir = path.join(ccsDir, 'bar');
    fs.mkdirSync(barDir, { recursive: true });
    const pointerPath = getLatestLaunchPointerPath(ccsDir);
    const first: LatestLaunchPointer = {
      schema: LATEST_LAUNCH_SCHEMA,
      launchId: 'bbbbbbbb-0000-4000-8000-00000000000a',
      port: 4559,
      startedAt: '2026-08-24T10:00:00.000Z',
      logPath: path.join(barDir, 'launches', 'bbbbbbbb-0000-4000-8000-00000000000a', 'serve.log'),
      status: 'ready',
    };
    const second: LatestLaunchPointer = { ...first, launchId: 'cccccccc-0000-4000-8000-00000000000b' };

    const writePointer = (pointer: LatestLaunchPointer): void => {
      const tmp = `${pointerPath}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(pointer, null, 2));
      fs.renameSync(tmp, pointerPath);
    };
    writePointer(first);
    writePointer(second);

    const raw = fs.readFileSync(pointerPath, 'utf8');
    expect(JSON.parse(raw).launchId).toBe(second.launchId);
    expect(raw.match(/launchId/g)?.length).toBe(1);
    expect(fs.readdirSync(barDir)).toEqual(['latest-launch.json']);
  });

  it('reclaims a pointer lock owned by a verified-dead process', async () => {
    const harness = makeLaunchHarness('dead-pointer-lock');
    fs.mkdirSync(path.dirname(harness.pointerPath), { recursive: true });
    fs.writeFileSync(`${harness.pointerPath}.lock`, JSON.stringify({ pid: 99999999, birthIdentity: 'dead', createdAt: new Date().toISOString(), launchId: 'dead-launch' }));
    const { defaultWriteLatestLaunchPointer } = await loadTransactionalLaunch();
    expect(defaultWriteLatestLaunchPointer(harness.pointerPath, {
      schema: LATEST_LAUNCH_SCHEMA,
      launchId: 'aaaaaaaa-0000-4000-8000-000000000001',
      port: 4600,
      startedAt: new Date().toISOString(),
      logPath: 'serve.log',
      status: 'starting',
    })).toBe(true);
    expect(fs.existsSync(`${harness.pointerPath}.lock`)).toBe(false);
  });

  it('never steals a pointer lock owned by this live process', async () => {
    const harness = makeLaunchHarness('live-pointer-lock');
    fs.mkdirSync(path.dirname(harness.pointerPath), { recursive: true });
    const { getProcessBirthIdentity } = await import('../../../src/commands/bar/bar-process-control');
    fs.writeFileSync(`${harness.pointerPath}.lock`, JSON.stringify({ pid: process.pid, birthIdentity: getProcessBirthIdentity(process.pid), createdAt: new Date(0).toISOString(), launchId: 'live-launch' }));
    const { defaultWriteLatestLaunchPointer } = await loadTransactionalLaunch();
    expect(() => defaultWriteLatestLaunchPointer(harness.pointerPath, {
      schema: LATEST_LAUNCH_SCHEMA,
      launchId: 'aaaaaaaa-0000-4000-8000-000000000002',
      port: 4600,
      startedAt: new Date().toISOString(),
      logPath: 'serve.log',
      status: 'starting',
    })).toThrow('Timed out acquiring');
    expect(JSON.parse(fs.readFileSync(`${harness.pointerPath}.lock`, 'utf8')).launchId).toBe('live-launch');
  });

  it('lets only latest concurrent launch publish shared state', async () => {
    const harness = makeLaunchHarness('concurrent-latest-owner');
    const firstReady = Promise.withResolvers<void>();
    const secondClaimed = Promise.withResolvers<void>();
    const ids = ['11111111-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000002'];
    const launches = await Promise.all(ids.map(async (launchId, index) => {
      const { handleBarLaunch } = await loadTransactionalLaunch();
      return handleBarLaunch(['--port', String(4601 + index)], {
        getCcsDir: () => harness.ccsDir,
        createLaunchId: () => launchId,
        findRunningServer: async () => null,
        getPort: async () => 4601 + index,
        spawnDetachedServer: () => ({ pid: 46010 + index, kill: () => true }),
        waitForServerLive: async () => {
          if (index === 0) { firstReady.resolve(); await secondClaimed.promise; }
          else { await firstReady.promise; secondClaimed.resolve(); }
        },
        openApp: async () => {},
        appInstallPath: path.join(tempHome, 'CCS Bar.exe'),
      });
    }));
    await Promise.all(launches);

    expect(JSON.parse(fs.readFileSync(harness.pointerPath, 'utf8')).launchId).toBe(ids[1]);
    expect(JSON.parse(fs.readFileSync(path.join(harness.ccsDir, 'bar.json'), 'utf8'))).toMatchObject({ port: 4602, launchId: ids[1] });
    expect(JSON.parse(fs.readFileSync(path.join(harness.ccsDir, 'bar', 'launch.json'), 'utf8')).args).toContain('4602');
  });

  it('does not spawn when starting ownership is rejected', async () => {
    const harness = makeLaunchHarness('starting-rejected');
    let spawned = false;
    const { handleBarLaunch } = await loadTransactionalLaunch();
    await handleBarLaunch(['--port', '4603'], {
      getCcsDir: () => harness.ccsDir,
      findRunningServer: async () => null,
      getPort: async () => 4603,
      writeLatestLaunchPointer: () => false,
      spawnDetachedServer: () => { spawned = true; },
      waitForServerLive: async () => {},
      openApp: async () => {},
      appInstallPath: path.join(tempHome, 'CCS Bar.exe'),
    });
    expect(spawned).toBe(false);
  });

  it('superseded rollback never restores or removes newer shared state', async () => {
    const harness = makeLaunchHarness('rollback-superseded');
    const newerId = '44444444-0000-4000-8000-000000000004';
    const { handleBarLaunch, BarServerTimeoutError } = await loadTransactionalLaunch();
    let spawns = 0;
    await handleBarLaunch(['--port', '4604'], {
      getCcsDir: () => harness.ccsDir,
      createLaunchId: () => '33333333-0000-4000-8000-000000000003',
      findRunningServer: async () => ({ port: 3000, baseUrl: 'http://127.0.0.1:3000' }),
      getPort: async () => 4604,
      stopDetachedServer: async () => {},
      spawnDetachedServer: () => { spawns++; return { pid: 46040, kill: () => true }; },
      waitForDetachedChildExit: async () => true,
      waitForServerLive: async (baseUrl: string) => {
        fs.writeFileSync(harness.pointerPath, JSON.stringify({ schema: LATEST_LAUNCH_SCHEMA, launchId: newerId, port: 4605, startedAt: '9999-01-01T00:00:00.000Z', logPath: 'newer.log', status: 'ready' }));
        fs.mkdirSync(path.join(harness.ccsDir, 'bar'), { recursive: true });
        fs.writeFileSync(path.join(harness.ccsDir, 'bar.json'), JSON.stringify({ port: 4605, launchId: newerId }));
        fs.writeFileSync(path.join(harness.ccsDir, 'bar', 'launch.json'), '{"newer":true}');
        throw new BarServerTimeoutError(baseUrl, 1);
      },
      openApp: async () => {},
      appInstallPath: path.join(tempHome, 'CCS Bar.exe'),
    } as never);
    expect(spawns).toBe(1);
    expect(JSON.parse(fs.readFileSync(harness.pointerPath, 'utf8')).launchId).toBe(newerId);
    expect(JSON.parse(fs.readFileSync(path.join(harness.ccsDir, 'bar.json'), 'utf8')).launchId).toBe(newerId);
    expect(fs.readFileSync(path.join(harness.ccsDir, 'bar', 'launch.json'), 'utf8')).toBe('{"newer":true}');
    process.exitCode = 0;
  });
});

describe('atomic process record publication', () => {
  it('publishes server.pid via atomic replace with no temporary siblings left behind', async () => {
    const ccsDir = path.join(tempHome, 'serve-atomic-pid');
    const pidPath = path.join(ccsDir, 'bar', 'server.pid');

    await handleBarServe(['--port', '4561'], {
      getCcsDir: () => ccsDir,
      findRunningServer: async () => null,
      getPort: async () => 4561,
      startServer: async () => ({ port: 4561, baseUrl: 'http://127.0.0.1:4561' }),
      getProcessBirthIdentity: () => 'atomic-birth',
      onSignal: () => {},
      exit: (code) => {
        throw new Error(`unexpected exit ${code}`);
      },
    });

    expect(fs.readdirSync(path.join(ccsDir, 'bar'))).toEqual(['server.pid']);
    expect(parseBarServerProcessRecord(fs.readFileSync(pidPath, 'utf8'))).toEqual({
      pid: process.pid,
      birthIdentity: 'atomic-birth',
    });
  });
});

describe('corrupt process record escape hatch', () => {
  // Simulates a torn write: valid JSON prefix, truncated tail.
  const tornRecord = '{"pid": 1234, "birthIdent';

  it('claims a torn unparsable record instead of wedging serve forever', () => {
    const pidPath = path.join(tempHome, 'claim-torn', 'server.pid');
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    fs.writeFileSync(pidPath, tornRecord);

    expect(claimStaleBarServerProcessRecord(pidPath)).toBe('claimed-stale');
    expect(fs.existsSync(pidPath)).toBe(false);
    expect(fs.readdirSync(path.dirname(pidPath))).toEqual([]);
  });

  it('still preserves legacy integer records for manual verification', () => {
    const pidPath = path.join(tempHome, 'claim-legacy-guard', 'server.pid');
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    fs.writeFileSync(pidPath, '4321\n');

    expect(claimStaleBarServerProcessRecord(pidPath)).toBe('preserved');
    expect(fs.readFileSync(pidPath, 'utf8')).toBe('4321\n');
  });

  it('keeps preserving legacy records through the claimed stop path', async () => {
    const pidPath = path.join(tempHome, 'legacy-stop-guard', 'server.pid');
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    fs.writeFileSync(pidPath, '4321\n');

    let signaled = false;
    const outcome = await stopBarServerProcessFile(pidPath, {
      getProcessBirthIdentity: () => null,
      killProcess: () => {
        signaled = true;
      },
    });

    expect(outcome.result).toBe('legacy-record');
    expect(signaled).toBe(false);
    expect(fs.existsSync(pidPath)).toBe(true);
  });

  it('unwedges stop by removing a corrupt record that names no verifiable process', async () => {
    const ccsDir = path.join(tempHome, 'stop-corrupt');
    const pidPath = path.join(ccsDir, 'bar', 'server.pid');
    const barJsonPath = path.join(ccsDir, 'bar.json');
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    fs.writeFileSync(pidPath, tornRecord);
    fs.writeFileSync(barJsonPath, '{}');

    let killCalled = false;
    await handleBarStop([], {
      getCcsDir: () => ccsDir,
      killProcess: () => {
        killCalled = true;
      },
    });

    expect(killCalled).toBe(false);
    expect(process.exitCode).toBe(0);
    expect(fs.existsSync(pidPath)).toBe(false);
    expect(fs.existsSync(barJsonPath)).toBe(false);
    process.exitCode = 0;
  });

  it('keeps refusing injected invalid records through the isolated read path', async () => {
    const ccsDir = path.join(tempHome, 'stop-invalid-injected');
    const pidPath = path.join(ccsDir, 'bar', 'server.pid');
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    fs.writeFileSync(pidPath, 'not-a-number');

    await handleBarStop([], {
      getCcsDir: () => ccsDir,
      readPidFile: () => 'not-a-number',
      killProcess: () => {},
    });

    expect(process.exitCode).toBe(1);
    expect(fs.readFileSync(pidPath, 'utf8')).toBe('not-a-number');
    process.exitCode = 0;
  });
});

describe('race-safe stale claim', () => {
  function staleRecord(): string {
    return serializeBarServerProcessRecord({ pid: 999333, birthIdentity: 'ghost-birth' });
  }

  it('restores a fresh replacement record swapped in before the stale unlink', () => {
    const pidPath = path.join(tempHome, 'claim-race-replace', 'server.pid');
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    const stale = staleRecord();
    fs.writeFileSync(pidPath, stale);
    const replacement = serializeBarServerProcessRecord({
      pid: 9876,
      birthIdentity: 'replacement-birth',
    });

    let identityCalls = 0;
    const result = claimStaleBarServerProcessRecord(pidPath, {
      getProcessBirthIdentity: () => {
        identityCalls += 1;
        if (identityCalls === 1) {
          // A concurrent serve publishes its own record before our unlink.
          fs.writeFileSync(pidPath, replacement);
        }
        return null;
      },
    });

    expect(result).toBe('preserved');
    expect(fs.readFileSync(pidPath, 'utf8')).toBe(replacement);
  });

  it('restores the record when its process turns out alive after claiming', () => {
    const pidPath = path.join(tempHome, 'claim-race-alive', 'server.pid');
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    const original = staleRecord();
    fs.writeFileSync(pidPath, original);
    const verdicts: (string | null)[] = [null, 'alive-now'];

    const result = claimStaleBarServerProcessRecord(pidPath, {
      getProcessBirthIdentity: () => verdicts.shift() ?? 'alive-now',
    });

    expect(result).toBe('preserved');
    expect(fs.readFileSync(pidPath, 'utf8')).toBe(original);
  });

  it('claims a verified-stale modern record end to end', () => {
    const pidPath = path.join(tempHome, 'claim-stale-ok', 'server.pid');
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    fs.writeFileSync(pidPath, staleRecord());

    const result = claimStaleBarServerProcessRecord(pidPath, {
      getProcessBirthIdentity: () => null,
    });

    expect(result).toBe('claimed-stale');
    expect(fs.existsSync(pidPath)).toBe(false);
  });
});

describe('latest-launch pointer reader', () => {
  function validPointerJson(status: string): string {
    return JSON.stringify({
      schema: LATEST_LAUNCH_SCHEMA,
      launchId: 'aaaaaaaa-0000-4000-8000-00000000000a',
      port: 4555,
      startedAt: '2026-08-25T00:00:00.000Z',
      logPath: '/tmp/serve.log',
      status,
    });
  }

  it('rejects pointers without explicit status semantics', () => {
    const dir = path.join(tempHome, 'pointer-read');
    fs.mkdirSync(dir, { recursive: true });
    const pointerPath = path.join(dir, 'latest-launch.json');

    fs.writeFileSync(
      pointerPath,
      JSON.stringify({
        schema: LATEST_LAUNCH_SCHEMA,
        launchId: 'aaaaaaaa-0000-4000-8000-00000000000a',
        port: 4555,
        startedAt: '2026-08-25T00:00:00.000Z',
        logPath: '/tmp/serve.log',
      })
    );
    expect(readLatestLaunchPointer(pointerPath)).toBeNull();

    fs.writeFileSync(pointerPath, validPointerJson('mangled'));
    expect(readLatestLaunchPointer(pointerPath)).toBeNull();

    fs.writeFileSync(pointerPath, validPointerJson('ready'));
    expect(readLatestLaunchPointer(pointerPath)?.status).toBe('ready');

    fs.writeFileSync(pointerPath, validPointerJson('failed'));
    expect(readLatestLaunchPointer(pointerPath)?.status).toBe('failed');
  });
});

describe('launch failure containment', () => {
  interface MoveHarness {
    ccsDir: string;
    events: string[];
    logPaths: string[];
  }

  function makeMoveHarness(name: string): MoveHarness {
    const ccsDir = path.join(tempHome, name);
    fs.mkdirSync(ccsDir, { recursive: true });
    return { ccsDir, events: [], logPaths: [] };
  }

  it('awaits confirmed killed-child exit before spawning the rollback restore and avoids legacy serve.log', async () => {
    const h = makeMoveHarness('rollback-order');
    const { handleBarLaunch, BarServerTimeoutError } = await loadTransactionalLaunch();
    let healthCalls = 0;

    await handleBarLaunch(['--port', '4580'], {
      getCcsDir: () => h.ccsDir,
      findRunningServer: async () => ({ port: 3000, baseUrl: 'http://127.0.0.1:3000' }),
      getPort: async (opts: { port: number[] }) => opts.port[0]!,
      stopDetachedServer: async () => {},
      spawnDetachedServer: (_port: number, logPath: string) => {
        h.logPaths.push(logPath);
        h.events.push(h.logPaths.length === 1 ? 'spawn' : 'restore-spawn');
        return {
          pid: 458001,
          kill: () => {
            h.events.push('kill');
            return true;
          },
        };
      },
      waitForDetachedChildExit: async () => {
        h.events.push('child-exited');
        return true;
      },
      waitForServerLive: async (baseUrl: string) => {
        healthCalls += 1;
        if (healthCalls === 1) throw new BarServerTimeoutError(baseUrl, 10);
        h.events.push(`restore-health:${baseUrl}`);
      },
      writeLaunchDescriptor: () => {},
      openApp: async () => {},
      appInstallPath: path.join(tempHome, 'Applications', 'CCS Bar.app'),
    } as never);

    expect(process.exitCode).toBe(1);
    process.exitCode = 0;

    expect(h.events.indexOf('kill')).toBeGreaterThanOrEqual(0);
    expect(h.events.indexOf('child-exited')).toBeGreaterThan(h.events.indexOf('kill'));
    expect(h.events.indexOf('restore-spawn')).toBeGreaterThan(h.events.indexOf('child-exited'));

    const restoreLog = h.logPaths[1]!;
    expect(restoreLog).not.toBe(path.join(h.ccsDir, 'bar', 'serve.log'));
    expect(restoreLog).toContain(path.join('bar', 'launches'));
    expect(fs.existsSync(path.join(h.ccsDir, 'bar', 'serve.log'))).toBe(false);

    const pointer = JSON.parse(
      fs.readFileSync(getLatestLaunchPointerPath(h.ccsDir), 'utf8')
    ) as LatestLaunchPointer;
    expect(pointer.status).toBe('failed');
    expect(fs.existsSync(path.dirname(pointer.logPath))).toBe(true);
  }, 30000);

  it('never fires the rollback restore when nothing was displaced', async () => {
    const h = makeMoveHarness('no-displaced-no-restore');
    const { handleBarLaunch, BarServerTimeoutError } = await loadTransactionalLaunch();
    let spawns = 0;
    let kills = 0;
    let healthCalls = 0;

    await handleBarLaunch(['--port', '4581'], {
      getCcsDir: () => h.ccsDir,
      findRunningServer: async () => null,
      getPort: async () => 4581,
      spawnDetachedServer: () => {
        spawns += 1;
        h.events.push('spawn');
        return {
          pid: 458101,
          kill: () => {
            kills += 1;
            h.events.push('kill');
            return true;
          },
        };
      },
      waitForDetachedChildExit: async () => {
        h.events.push('child-exited');
        return true;
      },
      waitForServerLive: async (baseUrl: string) => {
        healthCalls += 1;
        throw new BarServerTimeoutError(baseUrl, 10);
      },
      writeLaunchDescriptor: () => {},
      openApp: async () => {},
      appInstallPath: path.join(tempHome, 'Applications', 'CCS Bar.app'),
    } as never);

    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    expect(spawns).toBe(1);
    expect(kills).toBe(1);
    expect(healthCalls).toBe(1);
    expect(h.events).toEqual(['spawn', 'kill', 'child-exited']);
  }, 30000);

  it('sends exactly one kill when dashboard auth blocks the spawned child', async () => {
    const ccsDir = path.join(tempHome, 'auth-single-kill');
    fs.mkdirSync(ccsDir, { recursive: true });
    const { handleBarLaunch, BarServerAuthRequiredError } = await loadTransactionalLaunch();
    let kills = 0;
    let exitConfirms = 0;

    await handleBarLaunch(['--port', '4582'], {
      getCcsDir: () => ccsDir,
      findRunningServer: async () => null,
      getPort: async () => 4582,
      spawnDetachedServer: () => ({
        pid: 458201,
        kill: () => {
          kills += 1;
          return true;
        },
      }),
      waitForDetachedChildExit: async () => {
        exitConfirms += 1;
        return true;
      },
      waitForServerLive: async () => {
        throw new BarServerAuthRequiredError('http://127.0.0.1:4582', 401);
      },
      writeLaunchDescriptor: () => {},
      openApp: async () => {},
      appInstallPath: path.join(tempHome, 'Applications', 'CCS Bar.app'),
    } as never);

    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    expect(kills).toBe(1);
    expect(exitConfirms).toBe(1);
  }, 30000);

  it('rejects --launch-id in user-facing launch args', async () => {
    const ccsDir = path.join(tempHome, 'launch-reject-id');
    fs.mkdirSync(ccsDir, { recursive: true });
    const { handleBarLaunch } = await loadTransactionalLaunch();
    let spawnCalled = false;

    await handleBarLaunch(['--launch-id', 'aaaaaaaa-0000-4000-8000-00000000000a'], {
      getCcsDir: () => ccsDir,
      findRunningServer: async () => null,
      spawnDetachedServer: () => {
        spawnCalled = true;
      },
      openApp: async () => {},
      appInstallPath: path.join(tempHome, 'Applications', 'CCS Bar.app'),
    } as never);

    expect(process.exitCode).toBe(1);
    expect(spawnCalled).toBe(false);
    expect(fs.existsSync(getLatestLaunchPointerPath(ccsDir))).toBe(false);
    process.exitCode = 0;
  });
});

describe('ownership-safe cleanup with launch identity', () => {
  let pidPath = '';

  beforeEach(() => {
    pidPath = path.join(tempHome, 'cleanup-owner', 'server.pid');
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(path.dirname(pidPath), { recursive: true, force: true });
  });

  function writeOwnedRecord(): string {
    const record = serializeBarServerProcessRecord({
      pid: 4321,
      birthIdentity: 'birth-a',
      launchId: 'dddddddd-0000-4000-8000-00000000000d',
    });
    fs.writeFileSync(pidPath, record);
    return record;
  }

  it('removes the record only when process, birth identity, and launch id all match', () => {
    writeOwnedRecord();
    removeBarServerProcessRecordIfOwned(pidPath, {
      pid: 4321,
      birthIdentity: 'birth-a',
      launchId: 'dddddddd-0000-4000-8000-00000000000d',
    });
    expect(fs.existsSync(pidPath)).toBe(false);
  });

  it('preserves the record when a different launch id owns it now', () => {
    const record = writeOwnedRecord();
    removeBarServerProcessRecordIfOwned(pidPath, {
      pid: 4321,
      birthIdentity: 'birth-a',
      launchId: 'eeeeeeee-0000-4000-8000-00000000000e',
    });
    expect(fs.readFileSync(pidPath, 'utf8')).toBe(record);
  });

  it('preserves the record when the birth identity differs even with matching launch id', () => {
    const record = writeOwnedRecord();
    removeBarServerProcessRecordIfOwned(pidPath, {
      pid: 4321,
      birthIdentity: 'birth-b',
      launchId: 'dddddddd-0000-4000-8000-00000000000d',
    });
    expect(fs.readFileSync(pidPath, 'utf8')).toBe(record);
  });

  it('parses records carrying a launch id and rejects malformed launch ids', () => {
    expect(parseBarServerProcessRecord(writeOwnedRecord())).toEqual({
      pid: 4321,
      birthIdentity: 'birth-a',
      launchId: 'dddddddd-0000-4000-8000-00000000000d',
    });
    expect(
      parseBarServerProcessRecord(
        JSON.stringify({ pid: 5, birthIdentity: 'b', launchId: 'bad id!' })
      )
    ).toBeNull();
    expect(
      parseBarServerProcessRecord(JSON.stringify({ pid: 5, birthIdentity: 'b', launchId: '' }))
    ).toBeNull();
  });
});

describe('launched serve defers discovery to the launcher', () => {
  const LAUNCH_ID = 'ffffffff-0000-4000-8000-0000000000ff';

  function baseServeDeps(ccsDir: string) {
    return {
      getCcsDir: () => ccsDir,
      findRunningServer: async () => null,
      startServer: async () => ({ port: 4560, baseUrl: 'http://127.0.0.1:4560' }),
      getPort: async () => 4560,
      writeFile: (filePath: string, content: string) => {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
      },
      removeFile: () => {},
      onSignal: () => {},
      exit: (code: number) => {
        throw new Error(`__EXIT_${code}__`);
      },
      getProcessBirthIdentity: () => 'test-birth',
    };
  }

  it('writes a launch-stamped process record but never discovery', async () => {
    const ccsDir = path.join(tempHome, 'serve-launched');
    const deps = baseServeDeps(ccsDir);
    const written: Record<string, string> = {};
    deps.writeFile = (filePath: string, content: string) => {
      written[filePath] = content;
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content);
    };

    await handleBarServe(['--port', '4560', '--launch-id', LAUNCH_ID], deps as never);

    const pidPath = path.join(ccsDir, 'bar', 'server.pid');
    expect(written[pidPath]).toBeDefined();
    expect(JSON.parse(written[pidPath])).toEqual({
      pid: process.pid,
      birthIdentity: 'test-birth',
      launchId: LAUNCH_ID,
    });
    expect(written[path.join(ccsDir, 'bar.json')]).toBeUndefined();
    expect(fs.existsSync(path.join(ccsDir, 'bar.json'))).toBe(false);
  });

  it('cleans up only when the recorded launch id matches on shutdown', async () => {
    const ccsDir = path.join(tempHome, 'serve-launched-shutdown');
    const deps = baseServeDeps(ccsDir);
    const removals: unknown[] = [];
    let signalHandler: (() => void) | null = null;
    deps.onSignal = (_signal: string, handler: () => void) => {
      signalHandler = handler;
    };
    deps.writeFile = () => {};

    await handleBarServe(['--port', '4560', '--launch-id', LAUNCH_ID], {
      ...deps,
      removeProcessRecordIfOwned: (filePath: string, record: unknown) => {
        removals.push({ filePath, record });
      },
    } as never);

    expect(signalHandler).not.toBeNull();
    expect(() => (signalHandler as () => void)()).toThrow('__EXIT_0__');
    expect(removals).toHaveLength(1);
    const entry = removals[0] as { filePath: string; record: { launchId?: string } };
    expect(entry.filePath).toContain('server.pid');
    expect(entry.record.launchId).toBe(LAUNCH_ID);
  });

  it('refuses to publish over a living foreign process record before binding', async () => {
    const ccsDir = path.join(tempHome, 'serve-live-foreign');
    const barDir = path.join(ccsDir, 'bar');
    fs.mkdirSync(barDir, { recursive: true });
    const pidPath = path.join(barDir, 'server.pid');
    const foreign = serializeBarServerProcessRecord({ pid: 999111, birthIdentity: 'foreign' });
    fs.writeFileSync(pidPath, foreign);
    const deps = baseServeDeps(ccsDir);
    let started = false;
    deps.startServer = async () => {
      started = true;
      return { port: 4560, baseUrl: 'http://127.0.0.1:4560' };
    };
    deps.getProcessBirthIdentity = (pid: number) =>
      pid === 999111 ? 'still-running' : 'test-birth';

    await expect(
      handleBarServe(['--port', '4560'], deps as never)
    ).rejects.toThrow('__EXIT_1__');

    expect(started).toBe(false);
    expect(fs.readFileSync(pidPath, 'utf8')).toBe(foreign);
    expect(fs.existsSync(path.join(ccsDir, 'bar.json'))).toBe(false);
  });

  it('claims a verifiably stale record before publishing its own', async () => {
    const ccsDir = path.join(tempHome, 'serve-stale-claim');
    const barDir = path.join(ccsDir, 'bar');
    fs.mkdirSync(barDir, { recursive: true });
    const pidPath = path.join(barDir, 'server.pid');
    fs.writeFileSync(
      pidPath,
      serializeBarServerProcessRecord({ pid: 999222, birthIdentity: 'ghost' })
    );
    const deps = baseServeDeps(ccsDir);
    deps.getProcessBirthIdentity = (pid: number) => (pid === 999222 ? null : 'test-birth');

    await handleBarServe(['--port', '4560'], deps as never);

    const published = JSON.parse(fs.readFileSync(pidPath, 'utf8')) as { pid: number };
    expect(published.pid).toBe(process.pid);
  });

  it('requires --port in launched mode', async () => {
    const ccsDir = path.join(tempHome, 'serve-launched-no-port');
    await expect(
      handleBarServe(['--launch-id', LAUNCH_ID], baseServeDeps(ccsDir) as never)
    ).rejects.toThrow('__EXIT_1__');
  });

  it('rejects malformed --launch-id values loudly', () => {
    expect(validatePortArgs(['--launch-id'])).toBe('Missing value for --launch-id');
    expect(validatePortArgs(['--launch-id', 'a', '--launch-id', 'b'])).toBe(
      'Duplicate option: --launch-id'
    );
    expect(parseLaunchIdFlag(['--launch-id', 'has space']).launchId).toBeNull();
    expect(parseLaunchIdFlag(['--launch-id', 'ok-id_1']).launchId).toBe('ok-id_1');
    expect(parseLaunchIdFlag([]).present).toBe(false);
  });
});

async function waitForBirthIdentity(pid: number): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const identity = getProcessBirthIdentity(pid);
    if (identity !== null) return identity;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Process ${pid} never became observable`);
}

async function waitForChildExit(
  child: ReturnType<typeof spawn>,
  timeoutMs: number
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.removeListener('exit', onExit);
      reject(new Error(`Process ${child.pid} did not emit exit within ${timeoutMs}ms`));
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolve();
    };
    child.once('exit', onExit);
  });
}

describe('Bar server identity probe', () => {
  it('ignores unrelated services returning 401 or 403 without a CCS proof', async () => {
    for (const status of [401, 403]) {
      const server = http.createServer((_req, res) => {
        res.writeHead(status);
        res.end();
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as { port: number }).port;
      const ccsDir = path.join(tempHome, `status-${status}`);
      fs.mkdirSync(ccsDir, { recursive: true });
      fs.writeFileSync(path.join(ccsDir, 'bar.json'), JSON.stringify({ port }));
      try {
        const result = await defaultFindRunningServer(ccsDir);
        expect(result?.port).not.toBe(port);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  });
});
