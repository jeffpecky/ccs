import { spawn, spawnSync, execFile } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';

import { getCcsDir } from '../utils/config-manager';
import ProfileContextSyncLock from '../management/profile-context-sync-lock';
import {
  verifyProcessOwnership,
  type DaemonOwnershipStatus,
} from '../cursor/daemon-process-ownership';

export interface HeadroomStartOptions {
  port: number;
  codeAware: boolean;
  kompress: boolean;
}

interface SpawnedHeadroom {
  pid?: number;
  unref(): void;
}

export interface HeadroomServiceDeps {
  readPid(): number | undefined;
  writePid(pid: number): void;
  clearPid(): void;
  installed(): boolean;
  ownership(pid: number): DaemonOwnershipStatus;
  probe(url: string, token?: string, timeoutMs?: number): Promise<boolean>;
  spawn(command: string, args: string[]): SpawnedHeadroom;
  signal(pid: number, signal: NodeJS.Signals | 0): void;
  sleep(milliseconds: number): Promise<void>;
  getEnv(name: string): string | undefined;
  lifecycleLock: Pick<ProfileContextSyncLock, 'withNamedLock'>;
  execFile(command: string, args: string[]): Promise<{ stdout: string; stderr: string }>;
}

const STARTUP_ATTEMPTS = 40;

function getPaths() {
  const dir = path.join(getCcsDir(), 'headroom');
  return { dir, pid: path.join(dir, 'proxy.pid'), log: path.join(dir, 'proxy.log') };
}

function defaultReadPid(): number | undefined {
  try {
    const pid = Number.parseInt(fs.readFileSync(getPaths().pid, 'utf8').trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function defaultClearPid(): void {
  try {
    fs.unlinkSync(getPaths().pid);
  } catch {
    // Missing or already removed.
  }
}

export function buildHeadroomArgs(options: HeadroomStartOptions): string[] {
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error('Headroom port must be an integer from 1 to 65535.');
  }
  return [
    'proxy',
    '--port',
    String(options.port),
    ...(options.codeAware ? ['--code-aware'] : []),
    ...(options.kompress ? [] : ['--disable-kompress']),
  ];
}

export function isLoopbackHeadroomUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export function getHeadroomEndpoint(value: string): { port: number } {
  const url = new URL(value);
  if (
    !isLoopbackHeadroomUrl(value) ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search ||
    url.hash
  ) {
    throw new Error('Managed Headroom URL must be a loopback HTTP origin without a path.');
  }
  const port = Number(url.port || 80);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid Headroom port.');
  }
  return { port };
}

export function maskHeadroomError(message: string, token?: string): string {
  return token ? message.split(token).join('[REDACTED]') : message;
}

export function isHeadroomInstalled(): boolean {
  const result = spawnSync('headroom', ['--version'], { stdio: 'ignore', windowsHide: true });
  return !result.error && result.status === 0;
}

export async function probeHeadroom(
  url: string,
  token?: string,
  timeoutMs = 3_000
): Promise<boolean> {
  let target: URL;
  try {
    target = new URL('health', url.endsWith('/') ? url : `${url}/`);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
  } catch {
    return false;
  }

  return new Promise((resolve) => {
    const request = (target.protocol === 'https:' ? https : http).request(
      target,
      {
        method: 'GET',
        timeout: timeoutMs,
        headers: token ? { 'X-Headroom-Proxy-Token': token } : undefined,
      },
      (response) => {
        response.resume();
        resolve(
          Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 300)
        );
      }
    );
    request.on('error', () => resolve(false));
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.end();
  });
}

const defaultDeps: HeadroomServiceDeps = {
  readPid: defaultReadPid,
  writePid: (pid) => {
    const paths = getPaths();
    fs.mkdirSync(paths.dir, { recursive: true });
    fs.writeFileSync(paths.pid, String(pid), { mode: 0o600 });
  },
  clearPid: defaultClearPid,
  installed: isHeadroomInstalled,
  ownership: (pid) =>
    verifyProcessOwnership(pid, (commandLine) =>
      /(?:^|\s|[\\/])headroom(?:\.exe)?\s+proxy(?:\s|$)/i.test(commandLine)
    ),
  probe: probeHeadroom,
  spawn: (command, args) => {
    const paths = getPaths();
    fs.mkdirSync(paths.dir, { recursive: true });
    const log = fs.openSync(paths.log, 'a');
    const child = spawn(command, args, {
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log, log],
      env: { ...process.env },
    });
    fs.closeSync(log);
    return child;
  },
  signal: (pid, signal) => process.kill(pid, signal),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  getEnv: (name) => process.env[name],
  lifecycleLock: new ProfileContextSyncLock(path.join(getCcsDir(), 'headroom')),
  execFile: (command, args) =>
    new Promise((resolve, reject) => {
      execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve({ stdout, stderr });
      });
    }),
};

export function createHeadroomService(overrides: Partial<HeadroomServiceDeps> = {}) {
  const deps: HeadroomServiceDeps = { ...defaultDeps, ...overrides };
  let lifecycleQueue: Promise<void> = Promise.resolve();
  const locked = <T>(operation: () => Promise<T>): Promise<T> => {
    const withFileLock = () => deps.lifecycleLock.withNamedLock('lifecycle', operation);
    const result = lifecycleQueue.then(withFileLock, withFileLock);
    lifecycleQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  const stopUnlocked = async () => {
    const pid = deps.readPid();
    if (!pid) return { success: true, stopped: false };
    const status = deps.ownership(pid);
    if (status === 'not-running' || status === 'not-owned') {
      deps.clearPid();
      return { success: true, stopped: false };
    }
    if (status !== 'owned') {
      return {
        success: false,
        error: maskHeadroomError(
          `Refusing to stop PID ${pid}: unable to verify Headroom ownership.`,
          deps.getEnv('HEADROOM_PROXY_TOKEN')
        ),
      };
    }
    try {
      deps.signal(pid, 'SIGTERM');
      for (let attempt = 0; attempt < 30; attempt++) {
        await deps.sleep(100);
        try {
          deps.signal(pid, 0);
        } catch {
          deps.clearPid();
          return { success: true, stopped: true };
        }
      }
      if (deps.ownership(pid) !== 'owned') {
        return {
          success: false,
          error: `Refusing to force-stop PID ${pid}: Headroom ownership changed.`,
        };
      }
      try {
        deps.signal(pid, 'SIGKILL');
      } catch {
        // Already exited.
      }
      deps.clearPid();
      return { success: true, stopped: true };
    } catch (error) {
      return {
        success: false,
        error: maskHeadroomError(
          `Failed to stop Headroom: ${(error as Error).message}`,
          deps.getEnv('HEADROOM_PROXY_TOKEN')
        ),
      };
    }
  };

  const startUnlocked = async (options: HeadroomStartOptions) => {
    const existing = deps.readPid();
    if (existing) {
      const status = deps.ownership(existing);
      if (status === 'owned') return { success: true, pid: existing };
      if (status === 'unknown') {
        return {
          success: false,
          error: `Refusing to start Headroom: unable to verify existing PID ${existing} ownership.`,
        };
      }
      deps.clearPid();
    }
    if (!deps.installed()) return { success: false, error: 'Headroom CLI not installed.' };

    let child: SpawnedHeadroom;
    try {
      child = deps.spawn('headroom', buildHeadroomArgs(options));
    } catch (error) {
      return {
        success: false,
        error: maskHeadroomError(
          `Failed to start Headroom: ${(error as Error).message}`,
          deps.getEnv('HEADROOM_PROXY_TOKEN')
        ),
      };
    }
    child.unref();
    if (!child.pid) return { success: false, error: 'Failed to spawn Headroom proxy.' };
    deps.writePid(child.pid);

    const token = deps.getEnv('HEADROOM_PROXY_TOKEN');
    const url = `http://127.0.0.1:${options.port}`;
    for (let attempt = 0; attempt < STARTUP_ATTEMPTS; attempt++) {
      if (await deps.probe(url, token, 500)) return { success: true, pid: child.pid };
      await deps.sleep(200);
    }
    if (deps.ownership(child.pid) === 'owned') {
      try {
        deps.signal(child.pid, 'SIGTERM');
      } catch {
        // Already exited.
      }
    }
    deps.clearPid();
    return {
      success: false,
      error: 'Headroom proxy did not become healthy. See headroom/proxy.log.',
    };
  };

  return {
    async status(url: string) {
      let port: number;
      try {
        port = getHeadroomEndpoint(url).port;
      } catch {
        return {
          installed: deps.installed(),
          running: false,
          healthy: false,
          managed: false,
          local: true,
          error: 'Invalid local Headroom URL.',
        };
      }
      const probeUrl = `http://127.0.0.1:${port}`;
      const healthy = await deps.probe(probeUrl, deps.getEnv('HEADROOM_PROXY_TOKEN'));
      const pid = deps.readPid();
      const pidOwnership = pid ? deps.ownership(pid) : 'not-running';
      if (pid && (pidOwnership === 'not-running' || pidOwnership === 'not-owned')) deps.clearPid();
      return {
        installed: deps.installed(),
        running: healthy,
        healthy,
        managed: Boolean(pid && pidOwnership === 'owned'),
        managedPid: pid && pidOwnership === 'owned' ? pid : undefined,
        local: true,
        port,
      };
    },
    start: (options: HeadroomStartOptions) => locked(() => startUnlocked(options)),
    stop: () => locked(stopUnlocked),
    restart: (options: HeadroomStartOptions) =>
      locked(async () => {
        const stopped = await stopUnlocked();
        if (!stopped.success) return stopped;
        return startUnlocked(options);
      }),
    async install(extras?: string[]) {
      const spec = extras && extras.length > 0
        ? `headroom-ai[proxy,${extras.join(',')}]`
        : 'headroom-ai[proxy]';
      try {
        await deps.execFile('pip', ['install', '--upgrade', spec]);
        return { success: true, installed: deps.installed() };
      } catch (error) {
        return {
          success: false,
          error: `pip install failed: ${(error as Error).message}`,
        };
      }
    },
  };
}

const service = createHeadroomService();
export const getHeadroomStatus = service.status;
export const startHeadroom = service.start;
export const stopHeadroom = service.stop;
export const restartHeadroom = service.restart;
export const installHeadroom = service.install;
