import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import ProfileContextSyncLock from '../../../src/management/profile-context-sync-lock';

import {
  buildHeadroomArgs,
  createHeadroomService,
  getHeadroomEndpoint,
  isLoopbackHeadroomUrl,
  maskHeadroomError,
} from '../../../src/headroom/service';

describe('Headroom process service', () => {
  it('builds fixed official command arguments for code-aware and Kompress modes', () => {
    expect(buildHeadroomArgs({ port: 8787, codeAware: false, kompress: true })).toEqual([
      'proxy',
      '--port',
      '8787',
    ]);
    expect(buildHeadroomArgs({ port: 8787, codeAware: true, kompress: false })).toEqual([
      'proxy',
      '--port',
      '8787',
      '--code-aware',
      '--disable-kompress',
    ]);
  });

  it('allows lifecycle control only for loopback HTTP targets', () => {
    expect(isLoopbackHeadroomUrl('http://127.0.0.1:8787')).toBe(true);
    expect(isLoopbackHeadroomUrl('http://localhost:8787')).toBe(true);
    expect(isLoopbackHeadroomUrl('http://[::1]:8787')).toBe(true);
    expect(isLoopbackHeadroomUrl('https://headroom.example.test')).toBe(false);
    expect(isLoopbackHeadroomUrl('file:///tmp/headroom')).toBe(false);
  });

  it('extracts validated local port and rejects path-bearing managed URLs', () => {
    expect(getHeadroomEndpoint('http://127.0.0.1:8787')).toEqual({ port: 8787 });
    expect(() => getHeadroomEndpoint('http://127.0.0.1:8787/dashboard')).toThrow();
  });

  it('masks configured token values from public errors', () => {
    expect(maskHeadroomError('request failed with top-secret', 'top-secret')).toBe(
      'request failed with [REDACTED]'
    );
  });
});

describe('Headroom managed lifecycle', () => {
  function harness(overrides: Record<string, unknown> = {}) {
    let pid: number | undefined;
    const signals: Array<[number, NodeJS.Signals | 0]> = [];
    const spawned: Array<{ command: string; args: string[]; options?: Record<string, unknown> }> = [];
    let probes = [true];
    const service = createHeadroomService({
      readPid: () => pid,
      writePid: (value) => {
        pid = value;
      },
      clearPid: () => {
        pid = undefined;
      },
      installed: () => true,
      ownership: () => 'owned',
      probe: async () => probes.shift() ?? false,
      spawn: (command, args, options) => {
        spawned.push({ command, args, options });
        return { pid: 42, unref: () => undefined };
      },
      signal: (target, signal) => {
        signals.push([target, signal]);
        if (signal === 0 && signals.some((entry) => entry[1] === 'SIGTERM')) {
          const error = new Error('gone') as NodeJS.ErrnoException;
          error.code = 'ESRCH';
          throw error;
        }
      },
      sleep: async () => undefined,
      ...overrides,
    } as any);
    return {
      service,
      setPid: (value: number | undefined) => {
        pid = value;
      },
      setProbes: (value: boolean[]) => {
        probes = value;
      },
      pid: () => pid,
      signals,
      spawned,
    };
  }

  it('detects managed, stale, and unrelated PID states', async () => {
    const managed = harness();
    managed.setPid(11);
    expect((await managed.service.status('http://127.0.0.1:8787')).managed).toBe(true);

    const stale = harness({ ownership: () => 'not-running' });
    stale.setPid(12);
    expect((await stale.service.status('http://127.0.0.1:8787')).managed).toBe(false);
    expect(stale.pid()).toBeUndefined();

    const unrelated = harness({ ownership: () => 'not-owned' });
    unrelated.setPid(13);
    expect((await unrelated.service.status('http://127.0.0.1:8787')).managed).toBe(false);
    expect(unrelated.pid()).toBeUndefined();
  });

  it('validates local URL before reading token or probing network', async () => {
    let tokenReads = 0;
    let probes = 0;
    const app = harness({
      getEnv: () => {
        tokenReads++;
        return 'secret';
      },
      probe: async () => {
        probes++;
        return true;
      },
    });
    const result = await app.service.status('https://attacker.example.test/base');
    expect(result).toEqual({
      installed: true,
      running: false,
      healthy: false,
      managed: false,
      local: true,
      error: 'Invalid local Headroom URL.',
    });
    expect(tokenReads).toBe(0);
    expect(probes).toBe(0);
  });

  it('derives fixed loopback probe URL from validated port', async () => {
    const urls: string[] = [];
    const app = harness({
      probe: async (url: string) => {
        urls.push(url);
        return true;
      },
    });
    await app.service.status('http://localhost:8787');
    expect(urls).toEqual(['http://127.0.0.1:8787']);
  });

  it('starts fixed command and waits for readiness', async () => {
    const app = harness();
    app.setProbes([false, true]);
    const result = await app.service.start({
      port: 8787,
      codeAware: true,
      kompress: false,
    });
    expect(result).toEqual({ success: true, pid: 42 });
    expect(app.spawned).toEqual([
      {
        command: 'headroom',
        args: ['proxy', '--port', '8787', '--code-aware', '--disable-kompress'],
        options: expect.objectContaining({
          detached: true,
          windowsHide: true,
        }),
      },
    ]);
  });

  it('fails closed when existing PID ownership is unknown', async () => {
    const app = harness({ ownership: () => 'unknown' });
    app.setPid(41);
    const result = await app.service.start({ port: 8787, codeAware: false, kompress: true });
    expect(result.success).toBe(false);
    expect(app.spawned).toHaveLength(0);
    expect(app.pid()).toBe(41);
  });

  it('cleans PID and returns secret-free error when readiness expires', async () => {
    const app = harness();
    app.setProbes(Array(40).fill(false));
    process.env.HEADROOM_PROXY_TOKEN = 'top-secret';
    const result = await app.service.start({
      port: 8787,
      codeAware: false,
      kompress: true,
    });
    expect(result.success).toBe(false);
    expect(app.pid()).toBeUndefined();
    expect(app.signals).toContainEqual([42, 'SIGTERM']);
    expect(JSON.stringify(result)).not.toContain('top-secret');
    delete process.env.HEADROOM_PROXY_TOKEN;
  });

  it('converts spawn failures into secret-free service errors', async () => {
    process.env.HEADROOM_PROXY_TOKEN = 'top-secret';
    const app = harness({
      spawn: () => {
        throw new Error('spawn failed with top-secret');
      },
    });
    const result = await app.service.start({
      port: 8787,
      codeAware: false,
      kompress: true,
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain('top-secret');
    delete process.env.HEADROOM_PROXY_TOKEN;
  });

  it('refuses unknown ownership and never leaks token in error', async () => {
    const app = harness({ ownership: () => 'unknown' });
    app.setPid(14);
    process.env.HEADROOM_PROXY_TOKEN = 'top-secret';
    const result = await app.service.stop();
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain('top-secret');
    expect(app.signals).toEqual([]);
    delete process.env.HEADROOM_PROXY_TOKEN;
  });

  it('stops owned process and restart performs stop before start', async () => {
    const app = harness();
    app.setPid(15);
    expect(await app.service.stop()).toEqual({ success: true, stopped: true });
    expect(app.signals[0]).toEqual([15, 'SIGTERM']);

    app.setPid(16);
    const result = await app.service.restart({ port: 8787, codeAware: false, kompress: true });
    expect(result.success).toBe(true);
    expect(app.signals).toContainEqual([16, 'SIGTERM']);
    expect(app.spawned).toHaveLength(1);
  });

  it('refuses SIGKILL when PID ownership changes after SIGTERM', async () => {
    let checks = 0;
    const app = harness({
      ownership: () => (++checks === 1 ? 'owned' : 'not-owned'),
      signal: (target: number, signal: NodeJS.Signals | 0) => {
        app.signals.push([target, signal]);
      },
    });
    app.setPid(21);
    const result = await app.service.stop();
    expect(result.success).toBe(false);
    expect(app.signals).not.toContainEqual([21, 'SIGKILL']);
  });

  it('refuses startup cleanup signal when child PID ownership is not Headroom', async () => {
    const app = harness({ ownership: () => 'not-owned' });
    app.setProbes(Array(40).fill(false));
    const result = await app.service.start({ port: 8787, codeAware: false, kompress: true });
    expect(result.success).toBe(false);
    expect(app.signals).not.toContainEqual([42, 'SIGTERM']);
  });

  it('serializes concurrent starts into one spawn', async () => {
    let releaseProbe: (() => void) | undefined;
    const app = harness({
      probe: () =>
        new Promise<boolean>((resolve) => {
          releaseProbe = () => resolve(true);
        }),
    });
    const first = app.service.start({ port: 8787, codeAware: false, kompress: true });
    const second = app.service.start({ port: 8787, codeAware: false, kompress: true });
    await Promise.resolve();
    expect(app.spawned).toHaveLength(1);
    releaseProbe?.();
    expect((await first).success).toBe(true);
    expect((await second).success).toBe(true);
    expect(app.spawned).toHaveLength(1);
  });

  it('serializes lifecycle across two service instances with shared file lock', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-headroom-lock-'));
    const lockA = new ProfileContextSyncLock(dir);
    const lockB = new ProfileContextSyncLock(dir);
    const events: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = harness({
      lifecycleLock: lockA,
      probe: async () => {
        events.push('first:probe');
        await gate;
        return true;
      },
    });
    const second = harness({
      lifecycleLock: lockB,
      probe: async () => {
        events.push('second:probe');
        return true;
      },
    });
    try {
      const one = first.service.start({ port: 8787, codeAware: false, kompress: true });
      while (!events.includes('first:probe'))
        await new Promise((resolve) => setTimeout(resolve, 1));
      const two = second.service.start({ port: 8788, codeAware: false, kompress: true });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(events).toEqual(['first:probe']);
      release?.();
      await Promise.all([one, two]);
      expect(events).toEqual(['first:probe', 'second:probe']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
