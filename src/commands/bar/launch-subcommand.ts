/**
 * `ccs bar launch` — start the CCS Bar server detached, write bar.json, open the app.
 *
 * bar.json shape (v1):
 *   { baseUrl: string, port: number, authMode: "loopback", launchId?: string }
 *
 * Detached model (replaces the old in-process model):
 *   1. Probe candidate ports (bar.json port first, then 3000/3001/3002/8000/8080).
 *   2. If a live server is found → reuse it, write bar.json, open app, return.
 *      With an explicit --port that differs from the running server's port,
 *      stop that server first and fall through to a fresh start instead.
 *   3. Else → run a transactional fresh start:
 *        a. Mint a launchId owning every artefact of this attempt.
 *        b. Point latest-launch.json at this attempt (replace-on-write, never
 *           append) with status `starting`, giving the attempt its own log
 *           under ~/.ccs/bar/launches.
 *        c. Pick a port (--port exactly when given; otherwise bar.json's
 *           recorded port first, then the default candidates).
 *        d. Spawn `ccs bar serve --port N --launch-id <id>` detached with
 *           stdio → the per-launch serve.log.
 *        e. Poll /api/bar/health with nonce-bound token proofs until
 *           authenticated 200 (~10 s timeout).
 *        f. ONLY after health succeeds: refresh launch.json, then publish
 *           bar.json carrying the same launchId, then advance latest-launch.json
 *           to `ready`. Any earlier failure kills the child, awaits its confirmed
 *           exit, restores any displaced server from its own per-attempt log,
 *           and marks latest-launch.json `failed` — leaving prior discovery/
 *           recovery state byte-for-byte intact.
 *      The CLI process exits; the server continues as a detached child.
 *
 * All side-effectful deps are injectable so tests can run without real
 * servers, ports, or file-system writes.
 */

import * as fs from 'fs';
import { randomUUID } from 'crypto';
import * as os from 'os';
import * as path from 'path';
import type { ChildProcess } from 'child_process';
import { getCcsDir } from '../../config/config-loader-facade';
import {
  BAR_AUTH_NONCE_HEADER,
  BAR_AUTH_TOKEN_HEADER,
  createBarAuthNonce,
  createBarAuthProof,
  isMatchingBarAuthProof,
  getOrCreateBarAuthToken,
} from '../../utils/bar-auth-token';
import {
  getBarDir,
  getBarJsonPath,
  getLaunchDir,
  getLaunchJsonPath,
  getLaunchServeLogPath,
  getLatestLaunchPointerPath,
} from './bar-paths';
import type { LaunchJson, LatestLaunchPointer, LatestLaunchStatus } from './bar-paths';
import { LATEST_LAUNCH_SCHEMA } from './bar-paths';
import { createBarLaunchDescriptor } from './launch-descriptor';
import { parsePortFlag, validatePortArgs } from './port-arg';
import { getProcessBirthIdentity, writeFileAtomic } from './bar-process-control';
import {
  BAR_PORT_CANDIDATES,
  defaultFindRunningServer as _defaultFindRunningServer,
  resolveBarPort as _resolveBarPort,
} from './bar-server-probe';
import type { DashboardInfo as _DashboardInfo } from './bar-server-probe';
import { stopDetachedBarServer } from './bar-process-control';

const BAR_PROBE_TIMEOUT_MS = 1500;
const MAX_BAR_PROBE_RESPONSE_BYTES = 8192;

// ---------------------------------------------------------------------------
// Re-exports — backward compat for tests that import from this module.
// resolveBarPort + defaultFindRunningServer are canonical in bar-server-probe.ts;
// we re-export them so existing imports from launch-subcommand continue to work.
// ---------------------------------------------------------------------------

export { _defaultFindRunningServer as defaultFindRunningServer };
export { _resolveBarPort as resolveBarPort };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BarDiscoveryJson {
  baseUrl: string;
  port: number;
  authMode: 'loopback';
  /** Set when this discovery was published by a transactional detached launch. */
  launchId?: string;
}

export type DashboardInfo = _DashboardInfo;

export interface LaunchDeps {
  /**
   * Probe candidate ports for a running CCS server.
   * Returns { port, baseUrl } of the first live server found, or null if none.
   * Never throws — any error is treated as "not found".
   */
  findRunningServer: () => Promise<DashboardInfo | null>;
  /**
   * Find a free port from the candidate list.
   * Used to pre-select a port before spawning the detached server.
   */
  getPort: (opts: { port: number[]; host: string }) => Promise<number>;
  /**
   * Spawn the `ccs bar serve --port N` process detached and return immediately.
   * The spawned process must be unref()ed so the launcher can exit.
   */
  spawnDetachedServer: (port: number, logPath: string, launchId?: string) => ChildProcess | void;
  /**
   * Poll GET {baseUrl}/api/bar/health until an authenticated HTTP 200 or
   * timeout. Returns the live baseUrl on success, throws on timeout.
   */
  waitForServerLive: (baseUrl: string) => Promise<void>;
  /** Mint the identity that owns this launch attempt's artefacts. */
  createLaunchId?: () => string;
  /**
   * Replace the latest-launch.json pointer for this attempt. Implementations
   * must replace, never append, so readers always see exactly one attempt.
   */
  writeLatestLaunchPointer?: (pointerPath: string, pointer: LatestLaunchPointer) => boolean | void;
  /**
   * Wait until a killed detached child has confirmed its exit (bounded).
   * Resolves true when the exit was observed, false on timeout.
   */
  waitForDetachedChildExit?: (child: ChildProcess) => Promise<boolean>;
  /**
   * Build the launch.json descriptor (includes the chosen --port so the Swift
   * app self-starts the server on the same port).
   */
  createLaunchDescriptor: (opts?: { port?: number }) => LaunchJson;
  /**
   * Write launch.json so the Swift app can spawn the server independently.
   */
  writeLaunchDescriptor: (jsonPath: string, descriptor: LaunchJson) => void;
  /**
   * Stop the detached CCS Bar server recorded in server.pid and wait briefly
   * for the port to free. Used when an explicit --port differs from the port
   * the running server occupies.
   */
  stopDetachedServer: (ccsDir: string) => Promise<void>;
  /** Open the installed .app bundle. Throws if the app is not found. */
  openApp: (appPath: string) => Promise<void>;
  /** Returns path to ~/.ccs (respects CCS_HOME for test isolation). */
  getCcsDir: () => string;
  /** Full path where the .app should be installed, e.g. ~/Applications/CCS Bar.app */
  appInstallPath: string;
}

// ---------------------------------------------------------------------------
// Default production dependencies
// ---------------------------------------------------------------------------

async function defaultGetPort(opts: { port: number[]; host: string }): Promise<number> {
  const getPort = (await import('get-port')).default;
  return getPort(opts);
}

/**
 * Spawn `ccs bar serve --port N` detached so it outlives this CLI process.
 *
 * stdio is redirected to the per-launch serve.log so server output is
 * preserved for debugging without a terminal.  unref() lets the launcher exit
 * immediately. The child receives --launch-id so its self-published process
 * record and shutdown cleanup are bound to this launch's identity.
 */
function defaultSpawnDetachedServer(
  port: number,
  logPath: string,
  launchId?: string
): ChildProcess {
  const { spawn } = require('child_process') as typeof import('child_process');

  const args = [process.argv[1], 'bar', 'serve', '--port', String(port)];
  if (launchId !== undefined) args.push('--launch-id', launchId);

  // Open (or create) the log file for appending.
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd: os.homedir(),
    env: process.env,
  });
  child.unref();
  // Close our copy of the fd — the child has its own reference.
  fs.closeSync(logFd);
  return child;
}

/**
 * Poll GET {baseUrl}/api/bar/health every 250 ms until HTTP 200 or ~10 s.
 * Resolves when the server is live. Rejects on timeout.
 */
export class BarServerAuthRequiredError extends Error {
  constructor(baseUrl: string, statusCode: number) {
    super(`CCS Bar server at ${baseUrl} requires dashboard authentication (HTTP ${statusCode})`);
    this.name = 'BarServerAuthRequiredError';
  }
}

export class BarServerTimeoutError extends Error {
  constructor(baseUrl: string, timeoutSeconds: number) {
    super(`CCS Bar server did not become live at ${baseUrl} within ${timeoutSeconds}s`);
    this.name = 'BarServerTimeoutError';
  }
}

function isAuthRequiredStatus(statusCode: number): boolean {
  return statusCode === 401 || statusCode === 403;
}

export async function defaultWaitForServerLive(baseUrl: string): Promise<void> {
  const net = await import('net');
  const token = getOrCreateBarAuthToken();
  const INTERVAL_MS = 250;
  const TIMEOUT_MS = 10_000;
  const deadline = Date.now() + TIMEOUT_MS;

  async function probe(): Promise<{ statusCode: number | null; tokenMatched: boolean }> {
    const url = new URL(`${baseUrl}/api/bar/health`);
    const nonce = createBarAuthNonce();
    const requestProof = createBarAuthProof(
      token,
      'request',
      'GET',
      url.pathname + url.search,
      nonce
    );
    return new Promise((resolve) => {
      let rawResponse = '';
      let settled = false;
      const absoluteDeadline = setTimeout(() => finish(), BAR_PROBE_TIMEOUT_MS);
      absoluteDeadline.unref?.();
      const finish = (statusCode: number | null = null, headerSection = '') => {
        if (settled) return;
        settled = true;
        clearTimeout(absoluteDeadline);
        socket.destroy();
        const echoMatch = headerSection.match(
          new RegExp(`${BAR_AUTH_TOKEN_HEADER}:\\s*([^\\r\\n]+)`, 'i')
        );
        const proof = echoMatch ? echoMatch[1].trim() : '';
        resolve({
          statusCode,
          tokenMatched: isMatchingBarAuthProof(
            token,
            'response',
            'GET',
            url.pathname + url.search,
            nonce,
            proof
          ),
        });
      };
      const socket = net.connect(
        { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port) },
        () => {
          // Do NOT include the token in the request; only send a fresh nonce so
          // the server can prove it knows the token without disclosing it.
          socket.write(
            `GET ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.host}\r\n${BAR_AUTH_NONCE_HEADER}: ${nonce}\r\n${BAR_AUTH_TOKEN_HEADER}: ${requestProof}\r\nConnection: close\r\n\r\n`
          );
        }
      );
      socket.setTimeout(BAR_PROBE_TIMEOUT_MS, () => finish());
      socket.on('data', (chunk) => {
        rawResponse += chunk.toString('utf8');
        if (rawResponse.length > MAX_BAR_PROBE_RESPONSE_BYTES) {
          finish();
          return;
        }
        const statusMatch = rawResponse.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/);
        if (statusMatch) {
          const code = Number(statusMatch[1]);
          if (code !== 200 && code !== 401 && code !== 403) {
            finish(code, rawResponse);
            return;
          }
          if (rawResponse.includes('\r\n\r\n')) {
            finish(code, rawResponse.split('\r\n\r\n')[0]);
          }
        }
      });
      socket.on('error', () => finish());
      socket.on('end', () => {
        const statusMatch = rawResponse.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/);
        if (statusMatch) finish(Number(statusMatch[1]), rawResponse);
        else finish();
      });
    });
  }

  while (Date.now() < deadline) {
    const { statusCode, tokenMatched } = await probe();

    if (statusCode === 200 && tokenMatched) return;
    if (statusCode !== null && isAuthRequiredStatus(statusCode) && tokenMatched) {
      throw new BarServerAuthRequiredError(baseUrl, statusCode);
    }

    await new Promise<void>((resolve) => setTimeout(resolve, INTERVAL_MS));
  }

  throw new BarServerTimeoutError(baseUrl, TIMEOUT_MS / 1000);
}

function defaultWriteLaunchDescriptor(jsonPath: string, descriptor: LaunchJson): void {
  writeFileAtomic(jsonPath, JSON.stringify(descriptor, null, 2));
}

const DETACHED_CHILD_EXIT_CONFIRM_MS = 5_000;

/**
 * Await confirmed exit of a killed detached child so a rollback restore can
 * never race the dying process — its lingering port binding or half-dead
 * probe responses would otherwise misdirect the restored server.
 */
function defaultWaitForDetachedChildExit(child: ChildProcess): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  if (typeof child.once !== 'function') return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const onExit = (): void => finish(true);
    const finish = (exited: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      resolve(exited);
    };
    const timer = setTimeout(() => finish(false), DETACHED_CHILD_EXIT_CONFIRM_MS);
    timer.unref?.();
    child.once('exit', onExit);
  });
}

function defaultCreateLaunchId(): string {
  return randomUUID();
}

interface LatestLaunchLock {
  pid: number;
  birthIdentity: string | null;
  createdAt: string;
  launchId: string;
}

const LATEST_LAUNCH_LOCK_STALE_MS = 30_000;
const SELF_BIRTH_IDENTITY = getProcessBirthIdentity(process.pid);

function processIsLive(pid: number, birthIdentity: string | null): boolean {
  const current = pid === process.pid ? SELF_BIRTH_IDENTITY : getProcessBirthIdentity(pid);
  if (current !== null) return birthIdentity === null || current === birthIdentity;
  try {
    process.kill(pid, 0);
    return birthIdentity === null;
  } catch {
    return false;
  }
}

function withLatestLaunchLock<T>(pointerPath: string, launchId: string, action: () => T): T {
  fs.mkdirSync(path.dirname(pointerPath), { recursive: true });
  const lockPath = `${pointerPath}.lock`;
  let lockFd: number | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      lockFd = fs.openSync(lockPath, 'wx');
      const lock: LatestLaunchLock = {
        pid: process.pid,
        birthIdentity: SELF_BIRTH_IDENTITY,
        createdAt: new Date().toISOString(),
        launchId,
      };
      fs.writeFileSync(lockFd, JSON.stringify(lock));
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      try {
        const raw = fs.readFileSync(lockPath, 'utf8');
        const lock = JSON.parse(raw) as Partial<LatestLaunchLock>;
        const age = Date.now() - Date.parse(String(lock.createdAt));
        const validPid = Number.isSafeInteger(lock.pid) && (lock.pid ?? 0) > 0;
        if (
          validPid &&
          processIsLive(
            lock.pid!,
            typeof lock.birthIdentity === 'string' ? lock.birthIdentity : null
          )
        ) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
          continue;
        }
        if (!validPid && !(age > LATEST_LAUNCH_LOCK_STALE_MS)) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
          continue;
        }
        const claimPath = `${lockPath}.reclaim-${process.pid}-${Date.now()}`;
        fs.renameSync(lockPath, claimPath);
        fs.rmSync(claimPath, { force: true });
        continue;
      } catch (reclaimErr) {
        if ((reclaimErr as NodeJS.ErrnoException).code !== 'ENOENT') {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
        continue;
      }
    }
  }
  if (lockFd === undefined) throw new Error(`Timed out acquiring ${lockPath}`);
  try {
    return action();
  } finally {
    fs.closeSync(lockFd);
    fs.rmSync(lockPath, { force: true });
  }
}

function readCurrentPointer(pointerPath: string): LatestLaunchPointer | null {
  try {
    return JSON.parse(fs.readFileSync(pointerPath, 'utf8')) as LatestLaunchPointer;
  } catch {
    return null;
  }
}

/** Replace pointer only when this launch still owns it or is newer. */
export function defaultWriteLatestLaunchPointer(
  pointerPath: string,
  pointer: LatestLaunchPointer
): boolean {
  return withLatestLaunchLock(pointerPath, pointer.launchId, () => {
    let current: LatestLaunchPointer | null = null;
    current = readCurrentPointer(pointerPath);
    if (
      current?.launchId !== pointer.launchId &&
      current?.startedAt &&
      (current.startedAt > pointer.startedAt ||
        (current.startedAt === pointer.startedAt && current.launchId > pointer.launchId))
    )
      return false;
    if (current?.launchId !== pointer.launchId && pointer.status !== 'starting') return false;
    const tmpPath = `${pointerPath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(pointer, null, 2));
    fs.renameSync(tmpPath, pointerPath);
    return true;
  });
}

async function defaultOpenApp(appPath: string): Promise<void> {
  if (process.platform === 'win32') {
    const { openWindowsBar } = await import('./platform-adapter');
    await openWindowsBar(appPath);
    return;
  }
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);
  await execFileAsync('open', ['-a', appPath]);
}

function defaultGetCcsDir(): string {
  return getCcsDir();
}

// Fix #5: use os.homedir() to match install-subcommand.ts and uninstall-subcommand.ts.
const DEFAULT_APP_INSTALL_PATH = path.join(os.homedir(), 'Applications', 'CCS Bar.app');

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export async function handleBarLaunch(
  _args: string[],
  deps: Partial<LaunchDeps> = {}
): Promise<void> {
  if (
    process.platform !== 'darwin' &&
    process.platform !== 'win32' &&
    Object.keys(deps).length === 0
  )
    throw new Error('CCS Bar supports macOS or Windows only.');
  // --launch-id binds a serve process to its launcher-owned attempt; it must
  // never come from user-facing launch args.
  if (_args.includes('--launch-id')) {
    console.error('[X] --launch-id is reserved for internal launcher use.');
    process.exitCode = 1;
    return;
  }
  const argError = validatePortArgs(_args);
  if (argError !== null) {
    console.error(`[X] ${argError}`);
    process.exitCode = 1;
    return;
  }
  const ccsDir = (deps.getCcsDir ?? defaultGetCcsDir)();
  const openApp = deps.openApp ?? defaultOpenApp;
  const appInstallPath =
    deps.appInstallPath ??
    (process.platform === 'win32'
      ? (await import('./platform-adapter')).getWindowsBarPaths().exe
      : DEFAULT_APP_INSTALL_PATH);
  const getPortFn = deps.getPort ?? defaultGetPort;
  const spawnDetachedServer = deps.spawnDetachedServer ?? defaultSpawnDetachedServer;
  const waitForServerLive = deps.waitForServerLive ?? defaultWaitForServerLive;
  const createLaunchDescriptor = deps.createLaunchDescriptor ?? createBarLaunchDescriptor;
  const createLaunchId = deps.createLaunchId ?? defaultCreateLaunchId;
  const writeLatestLaunchPointer = deps.writeLatestLaunchPointer ?? defaultWriteLatestLaunchPointer;
  const waitForDetachedChildExit = deps.waitForDetachedChildExit ?? defaultWaitForDetachedChildExit;
  const writeLaunchDescriptor = deps.writeLaunchDescriptor ?? defaultWriteLaunchDescriptor;
  const stopDetachedServer = deps.stopDetachedServer ?? stopDetachedBarServer;

  // Wire findRunningServer after ccsDir is resolved.
  const findRunningServer = deps.findRunningServer ?? (() => _defaultFindRunningServer(ccsDir));

  const barJsonPath = getBarJsonPath(ccsDir);
  const launchJsonPath = getLaunchJsonPath(ccsDir);

  // 0. Parse --port. A present-but-invalid value is a hard error (silently
  //    launching on a different port than the user asked for is worse).
  const portFlag = parsePortFlag(_args);
  if (portFlag.present && portFlag.port === null) {
    console.error('[X] Invalid --port value. Use a number between 1 and 65535.');
    process.exitCode = 1;
    return;
  }
  const requestedPort = portFlag.port;

  // 1. Probe for an already-running server.
  let running: DashboardInfo | null = null;
  try {
    running = await findRunningServer();
  } catch {
    /* any probe error counts as null */
  }

  let movingFrom: DashboardInfo | null = null;
  let port: number | null = null;

  if (running !== null) {
    if (running.authRequired) {
      console.error(
        `[X] CCS Bar cannot launch while dashboard authentication protects ${running.baseUrl}.`
      );
      console.error(
        '[i] Disable dashboard authentication for CCS Bar or start the dashboard manually.'
      );
      return;
    }

    if (requestedPort === null || running.port === requestedPort) {
      // Reuse the live server — write bar.json and open the app.
      const barJson: BarDiscoveryJson = {
        baseUrl: running.baseUrl,
        port: running.port,
        authMode: 'loopback',
      };
      try {
        fs.mkdirSync(ccsDir, { recursive: true });
        fs.writeFileSync(barJsonPath, JSON.stringify(barJson, null, 2));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[X] Failed to write bar.json: ${msg}`);
        return;
      }
      console.log(`[OK] Reusing running CCS web-server at ${running.baseUrl}`);
      console.log(`[i]  Discovery file written: ${barJsonPath}`);
      await _openAppWithFallback(appInstallPath, openApp);
      return;
    }

    // Explicit --port that differs from the running server: preflight the
    // destination before disrupting the healthy current service.
    console.log(
      `[i] CCS Bar server is running on port ${running.port}; moving to port ${requestedPort}...`
    );
    if (requestedPort === null) return;
    try {
      const availablePort = await getPortFn({ port: [requestedPort], host: '127.0.0.1' });
      if (availablePort !== requestedPort) {
        console.error(`[X] Port ${requestedPort} is already in use by another process.`);
        console.error('[i] The existing CCS Bar server was left running.');
        process.exitCode = 1;
        return;
      }
      port = requestedPort;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[X] Could not preflight port ${requestedPort}: ${msg}`);
      console.error('[i] The existing CCS Bar server was left running.');
      process.exitCode = 1;
      return;
    }
    try {
      await stopDetachedServer(ccsDir);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[X] Could not safely stop the running server: ${msg}`);
      console.error('[i] Recovery state was preserved; resolve the stop error, then retry.');
      process.exitCode = 1;
      return;
    }
    movingFrom = running;
    // Fall through to the fresh-start path below.
  }

  // 2. No live server (or moving ports) — pick a port, write/refresh
  //    launch.json, spawn detached.

  // 2a. Pick a free port. An explicit --port must be honored exactly; without
  //     it, the port recorded in bar.json is preferred so the server keeps
  //     coming back on the port the user last chose (sticky port).
  try {
    if (port !== null) {
      // Destination was already preflighted before stopping the prior server.
    } else if (requestedPort !== null) {
      const got = await getPortFn({ port: [requestedPort], host: '127.0.0.1' });
      if (got !== requestedPort) {
        console.error(`[X] Port ${requestedPort} is already in use by another process.`);
        console.error('[i] Choose a different port or free it, then retry.');
        process.exitCode = 1;
        return;
      }
      port = requestedPort;
    } else {
      const stickyPort = _resolveBarPort(ccsDir);
      const base = BAR_PORT_CANDIDATES;
      const candidates =
        stickyPort !== null ? [stickyPort, ...base.filter((p) => p !== stickyPort)] : base;
      port = await getPortFn({ port: candidates, host: '127.0.0.1' });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[X] Could not find a free port: ${msg}`);
    return;
  }

  if (port === null) {
    console.error('[X] Could not resolve a valid CCS Bar port.');
    process.exitCode = 1;
    return;
  }
  const selectedPort = port;

  // 2b. Transactional fresh start. Every artefact of this attempt is owned by
  //     a freshly minted launchId. Prior discovery/recovery state is never
  //     modified before the new server proves healthy, so any failure below
  //     preserves the previous valid state byte-for-byte.
  const launchId = createLaunchId();
  const serveLogPath = getLaunchServeLogPath(ccsDir, launchId);
  const latestPointerPath = getLatestLaunchPointerPath(ccsDir);
  const attemptStartedAt = new Date().toISOString();

  const publishPointer = (status: LatestLaunchStatus): boolean => {
    try {
      return (
        writeLatestLaunchPointer(latestPointerPath, {
          schema: LATEST_LAUNCH_SCHEMA,
          launchId,
          port: selectedPort,
          startedAt: attemptStartedAt,
          logPath: serveLogPath,
          status,
        }) !== false
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[!] Could not update latest-launch pointer: ${msg}`);
      return false;
    }
  };

  // The pointer starts as `starting` and is only advanced to `ready` after
  // authenticated health succeeds; every failure path marks it `failed`, so
  // readers can treat a failed attempt distinctly from a healthy one.
  if (!publishPointer('starting')) return;

  const withOwnership = (action: () => void): boolean =>
    withLatestLaunchLock(latestPointerPath, launchId, () =>
      readCurrentPointer(latestPointerPath)?.launchId === launchId ? (action(), true) : false
    );

  const rollbackAttemptDir = getLaunchDir(ccsDir, `rollback-${launchId}`);
  const rollbackLogPath = getLaunchServeLogPath(ccsDir, `rollback-${launchId}`);

  const rollbackPriorServer = async (): Promise<void> => {
    if (movingFrom === null) return;
    try {
      if (
        !withOwnership(() => {
          fs.mkdirSync(rollbackAttemptDir, { recursive: true });
          spawnDetachedServer(movingFrom!.port, rollbackLogPath);
        })
      )
        return;
      await waitForServerLive(movingFrom.baseUrl);
      console.log(`[OK] Restored CCS Bar server at ${movingFrom.baseUrl}.`);
    } catch (rollbackErr) {
      const message = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
      console.error(`[X] Failed to restore CCS Bar at ${movingFrom.baseUrl}: ${message}`);
      console.error('[i] Existing discovery and launch state was preserved for manual recovery.');
    }
  };

  const priorLaunchJson = (() => {
    try {
      if (fs.existsSync(launchJsonPath) && fs.statSync(launchJsonPath).isFile()) {
        return fs.readFileSync(launchJsonPath, 'utf8');
      }
    } catch {
      // ignore
    }
    return null;
  })();
  const priorBarJson = (() => {
    try {
      if (fs.existsSync(barJsonPath) && fs.statSync(barJsonPath).isFile()) {
        return fs.readFileSync(barJsonPath, 'utf8');
      }
    } catch {
      // ignore
    }
    return null;
  })();
  const restoreLaunchJson = (): void => {
    withOwnership(() => {
      if (priorLaunchJson === null) {
        try {
          fs.rmSync(launchJsonPath, { force: true });
        } catch {
          /* already gone or directory */
        }
      } else {
        writeFileAtomic(launchJsonPath, priorLaunchJson);
      }
    });
  };
  const restoreBarJson = (): void => {
    withOwnership(() => {
      if (priorBarJson === null) {
        try {
          fs.rmSync(barJsonPath, { force: true });
        } catch {
          /* already gone or directory */
        }
      } else {
        writeFileAtomic(barJsonPath, priorBarJson);
      }
    });
  };

  const baseUrl = `http://127.0.0.1:${selectedPort}`;
  let spawnedChild: ChildProcess | void;

  // Single kill point for every failure path. The child's confirmed exit is
  // awaited so the dying process cannot misdirect the rollback restore.
  const killSpawnedChildAndAwaitExit = async (): Promise<void> => {
    const child = typeof spawnedChild === 'object' ? spawnedChild : null;
    if (child === null || typeof child.kill !== 'function') return;
    try {
      child.kill();
    } catch {
      /* already gone */
    }
    const confirmed = typeof child.pid !== 'number' || (await waitForDetachedChildExit(child));
    if (!confirmed) {
      console.error('[!] Could not confirm the detached child exited before rollback.');
    }
  };

  try {
    fs.mkdirSync(getBarDir(ccsDir), { recursive: true });
    fs.mkdirSync(getLaunchDir(ccsDir, launchId), { recursive: true });
    spawnedChild = spawnDetachedServer(selectedPort, serveLogPath, launchId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[X] Could not start CCS web-server: ${msg}`);
    publishPointer('failed');
    await rollbackPriorServer();
    if (movingFrom === null) console.error('[i] Run `ccs config` to start the dashboard manually.');
    process.exitCode = 1;
    return;
  }

  console.log('[i] Starting CCS Bar server...');

  // 2c. Poll until authenticated health succeeds or times out. Nothing is
  //     published while the child is merely bound — an unresponsive child is
  //     killed and its attempt rolled back below.
  try {
    await waitForServerLive(baseUrl);
  } catch (err) {
    publishPointer('failed');
    if (err instanceof BarServerAuthRequiredError) {
      console.error(
        `[X] CCS Bar cannot launch while dashboard authentication protects ${baseUrl}.`
      );
      console.error(
        '[i] Disable dashboard authentication for CCS Bar or start the dashboard manually.'
      );
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[X] Could not connect to CCS web-server: ${msg}`);
      console.error(`[i] Check the launch log at ${serveLogPath}`);
    }
    await killSpawnedChildAndAwaitExit();
    await rollbackPriorServer();
    process.exitCode = 1;
    return;
  }

  // 2d. Health proven — publish. Recovery descriptor first, discovery last:
  //     bar.json appearing means every other piece of this launch is in place.
  try {
    if (readCurrentPointer(latestPointerPath)?.launchId !== launchId) {
      await killSpawnedChildAndAwaitExit();
      return;
    }
    const launchDescriptor = createLaunchDescriptor({ port: selectedPort });
    if (!withOwnership(() => writeLaunchDescriptor(launchJsonPath, launchDescriptor))) {
      await killSpawnedChildAndAwaitExit();
      return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[X] Could not write launch.json: ${msg}`);
    restoreLaunchJson();
    try {
      publishPointer('failed');
    } catch {
      /* ignore */
    }
    await killSpawnedChildAndAwaitExit();
    await rollbackPriorServer();
    process.exitCode = 1;
    return;
  }

  // 2e. Write bar.json.
  const barJson: BarDiscoveryJson = {
    baseUrl,
    port: selectedPort,
    authMode: 'loopback',
    launchId,
  };
  try {
    fs.mkdirSync(ccsDir, { recursive: true });
    if (!withOwnership(() => writeFileAtomic(barJsonPath, JSON.stringify(barJson, null, 2)))) {
      await killSpawnedChildAndAwaitExit();
      return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[X] Failed to write bar.json: ${msg}`);
    restoreLaunchJson();
    restoreBarJson();
    publishPointer('failed');
    await killSpawnedChildAndAwaitExit();
    await rollbackPriorServer();
    process.exitCode = 1;
    return;
  }

  if (!publishPointer('ready')) {
    await killSpawnedChildAndAwaitExit();
    return;
  }

  console.log(`[OK] CCS web-server running at ${baseUrl}`);
  console.log(`[i]  Discovery file written: ${barJsonPath}`);

  // 3. Open the app — then return (process exits; server continues detached).
  await _openAppWithFallback(appInstallPath, openApp);
}

// ---------------------------------------------------------------------------
// Internal helper — open app with graceful degraded path
// ---------------------------------------------------------------------------

async function _openAppWithFallback(
  appInstallPath: string,
  openApp: (p: string) => Promise<void>
): Promise<void> {
  try {
    await openApp(appInstallPath);
    console.log('[OK] CCS Bar launched.');
  } catch {
    if (!fs.existsSync(appInstallPath)) {
      console.log('[!] CCS Bar app is not installed.');
      console.log('[i] Run `ccs bar install` to install it.');
    } else if (process.platform === 'win32') {
      console.log('[!] Could not open CCS Bar.exe. Reinstall with `ccs bar install`.');
    } else {
      console.log('[!] Could not open CCS Bar. Try right-clicking and selecting Open.');
      console.log('[i] If Gatekeeper blocks the app, run:');
      console.log(`      xattr -dr com.apple.quarantine "${appInstallPath}"`);
    }
  }
}
