/**
 * CLIProxy Service Manager
 *
 * Manages CLIProxyAPI as a background service for the CCS dashboard.
 * Ensures the proxy is running when needed for:
 * - Control Panel integration (management.html)
 * - Stats fetching
 * - OAuth flows
 *
 * Unlike cliproxy-executor.ts which runs proxy per-session,
 * this module manages a persistent background instance.
 */

import { spawn, type ChildProcess } from 'child_process';
import { ensureCLIProxyBinary } from './binary-manager';
import {
  generateConfig,
  regenerateConfig,
  configNeedsRegeneration,
  CLIPROXY_DEFAULT_PORT,
  getCliproxyWritablePath,
} from './config/config-generator';
import { registerSession } from './session-tracker';
import { detectRunningProxy, waitForProxyHealthy } from './proxy/proxy-detector';
import { withStartupLock } from './services/startup-lock';
import { isCliproxyRunning } from './services/stats-fetcher';

/** Background proxy process reference */
let proxyProcess: ChildProcess | null = null;

/** Cleanup registered flag */
let cleanupRegistered = false;

/**
 * Wait for process to exit during startup.
 * Returns the exit code and signal if the process exited, null if still running.
 */
function waitForProcessExit(
  proc: ChildProcess,
  timeoutMs: number
): Promise<{ code: number | null; signal: NodeJS.Signals | null } | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      proc.removeListener('exit', onExit);
      resolve(null); // Still running
    }, timeoutMs);

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      resolve({ code, signal });
    };

    proc.once('exit', onExit);
  });
}

/**
 * HTTP readiness check — verifies the proxy is not just listening on the port
 * but actually ready to serve requests. Uses the existing health check function.
 */
async function waitForReadiness(
  port: number,
  timeout: number = 30000,
  pollInterval: number = 200
): Promise<{
  ready: boolean;
  exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null;
}> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const healthy = await isCliproxyRunning(port);
      if (healthy) {
        return { ready: true, exitInfo: null };
      }
    } catch {
      // Health check failed, continue polling
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }

  return { ready: false, exitInfo: null };
}

/** Maximum number of startup retry attempts for transient failures */
const MAX_STARTUP_RETRIES = 2;

/** Base delay for exponential backoff (ms) */
const RETRY_BASE_DELAY_MS = 1000;

/**
 * Exponential backoff with jitter for retry delays.
 */
function getRetryDelay(attempt: number): number {
  const base = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 500;
  return base + jitter;
}

/**
 * Register process-exit cleanup handlers for in-process workers.
 */
function registerCleanup(): void {
  if (cleanupRegistered) return;

  const cleanup = () => {
    // Do not stop detached CLIProxy on parent exit.
    // Persistence is expected across CCS command lifecycles.
  };

  process.once('exit', cleanup);
  process.once('SIGTERM', cleanup);
  process.once('SIGINT', cleanup);

  cleanupRegistered = true;
}

export interface ServiceStartResult {
  started: boolean;
  alreadyRunning: boolean;
  port: number;
  configRegenerated?: boolean;
  error?: string;
}

/**
 * Test-only seams for ensureCliproxyService. Production callers omit this and
 * get the real implementations. Tests inject stubs to avoid bun's
 * `mock.module()`, which is process-wide and leaks across test files.
 */
export interface EnsureCliproxyServiceDeps {
  ensureBinaryFn?: typeof ensureCLIProxyBinary;
  detectRunningProxyFn?: typeof detectRunningProxy;
  configNeedsRegenerationFn?: typeof configNeedsRegeneration;
  withStartupLockFn?: typeof withStartupLock;
}

/**
 * Ensure CLIProxy service is running
 *
 * If proxy is already running, returns immediately.
 * If not, spawns a new background instance.
 *
 * @param port CLIProxy port (default: 8317)
 * @param verbose Show debug output
 * @param deps Test-only dependency overrides (see EnsureCliproxyServiceDeps)
 * @returns Result indicating success and whether it was already running
 */
export async function ensureCliproxyService(
  port: number = CLIPROXY_DEFAULT_PORT,
  verbose: boolean = false,
  deps: EnsureCliproxyServiceDeps = {}
): Promise<ServiceStartResult> {
  const ensureBinaryFn = deps.ensureBinaryFn ?? ensureCLIProxyBinary;
  const detectRunningProxyFn = deps.detectRunningProxyFn ?? detectRunningProxy;
  const configNeedsRegenerationFn = deps.configNeedsRegenerationFn ?? configNeedsRegeneration;
  const withStartupLockFn = deps.withStartupLockFn ?? withStartupLock;
  const log = (msg: string) => {
    if (verbose) {
      console.error(`[cliproxy-service] ${msg}`);
    }
  };

  // Check if config needs update (even if running)
  let configRegenerated = false;
  if (configNeedsRegenerationFn(port)) {
    log('Config outdated, regenerating...');
    regenerateConfig(port);
    configRegenerated = true;
  }

  // Use startup lock to coordinate with other CCS processes (ccs agy, ccs config, etc.)
  return await withStartupLockFn(async () => {
    // Use unified detection (HTTP check + session-lock + port-process)
    log(`Checking if CLIProxy is running on port ${port}...`);
    const proxyStatus = await detectRunningProxyFn(port);
    log(`Proxy detection: ${JSON.stringify(proxyStatus)}`);

    if (proxyStatus.running && proxyStatus.verified) {
      // Already running and healthy
      log('CLIProxy already running');
      if (configRegenerated) {
        log('Config was updated - running instance will use new config on next restart');
      }
      return { started: true, alreadyRunning: true, port, configRegenerated };
    }

    if (proxyStatus.running && !proxyStatus.verified) {
      // Proxy detected but not ready yet (another process is starting it)
      log(`Proxy starting up (detected via ${proxyStatus.method}), waiting...`);
      const becameHealthy = await waitForProxyHealthy(port, 5000);
      if (becameHealthy) {
        log('Proxy became healthy');
        return { started: true, alreadyRunning: true, port, configRegenerated };
      }
      // Proxy didn't become healthy - will try to start fresh below
      log('Proxy detected but not responding, will start fresh');
    }

    if (proxyStatus.blocked) {
      // Port blocked by non-CLIProxy process - try HTTP as last resort
      const isActuallyOurs = await waitForProxyHealthy(port, 1000);
      if (isActuallyOurs) {
        log('Reclaimed CLIProxy with unrecognized process name');
        return { started: true, alreadyRunning: true, port, configRegenerated };
      }
      // Truly blocked
      return {
        started: false,
        alreadyRunning: false,
        port,
        error: `Port ${port} is blocked by ${proxyStatus.blocker?.processName}`,
      };
    }

    // Need to start new instance
    log('CLIProxy not running, starting background instance...');

    // 1. Ensure binary exists
    let binaryPath: string;
    try {
      binaryPath = await ensureBinaryFn(verbose, {
        allowInstall: false,
        skipAutoUpdate: true,
      });
      log(`Binary ready: ${binaryPath}`);
    } catch (error) {
      const err = error as Error;
      return {
        started: false,
        alreadyRunning: false,
        port,
        error: `Failed to prepare binary: ${err.message}`,
      };
    }

    // 2. Ensure/regenerate config if needed
    let configPath: string;
    if (configNeedsRegeneration(port)) {
      log('Config needs regeneration, updating...');
      configPath = regenerateConfig(port);
    } else {
      configPath = generateConfig('gemini', port);
    }
    log(`Config ready: ${configPath}`);

    // 3. Spawn background process with retry logic
    const proxyArgs = ['--config', configPath];
    let lastExitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    let lastStderr = '';

    for (let attempt = 0; attempt <= MAX_STARTUP_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = getRetryDelay(attempt - 1);
        log(
          `Retry attempt ${attempt}/${MAX_STARTUP_RETRIES} after ${Math.round(delay)}ms delay...`
        );
        await new Promise((r) => setTimeout(r, delay));

        // Re-check if proxy came up from another process during backoff
        const lateCheck = await detectRunningProxyFn(port);
        if (lateCheck.running && lateCheck.verified) {
          log('Proxy came up during retry backoff');
          return { started: true, alreadyRunning: true, port, configRegenerated };
        }
      }

      log(`Spawning: ${binaryPath} ${proxyArgs.join(' ')}`);

      // Always capture stderr during startup for diagnostics
      const stderrChunks: Buffer[] = [];
      let stderrListener: ((chunk: Buffer) => void) | null = null;

      proxyProcess = spawn(binaryPath, proxyArgs, {
        stdio: ['ignore', verbose ? 'pipe' : 'ignore', 'pipe'],
        detached: true,
        env: {
          ...process.env,
          WRITABLE_PATH: getCliproxyWritablePath(),
        },
      });

      // Capture stderr for error reporting (always, not just verbose)
      if (proxyProcess.stderr) {
        stderrListener = (chunk: Buffer) => {
          stderrChunks.push(chunk);
          if (verbose) {
            process.stderr.write(`[cliproxy-err] ${chunk.toString()}`);
          }
        };
        proxyProcess.stderr.on('data', stderrListener);
      }

      // Forward stdout in verbose mode
      if (verbose) {
        proxyProcess.stdout?.on('data', (data: Buffer) => {
          process.stderr.write(`[cliproxy] ${data.toString()}`);
        });
      }

      proxyProcess.unref();

      // Fail fast on spawn error (e.g., binary not found, permission denied)
      const spawnError = await new Promise<Error | null>((resolve) => {
        proxyProcess!.once('error', (error) => {
          resolve(error);
        });
        // If no error within 1s, assume spawn succeeded
        setTimeout(() => resolve(null), 1000);
      });

      if (spawnError) {
        log(`Spawn error: ${spawnError.message}`);
        if (stderrListener && proxyProcess.stderr) {
          proxyProcess.stderr.removeListener('data', stderrListener);
        }
        return {
          started: false,
          alreadyRunning: false,
          port,
          error: `Failed to start CLIProxy: ${spawnError.message}`,
        };
      }

      registerCleanup();

      // 4. Wait for proxy to be ready with HTTP health checks
      //    Also monitor for early process exit (crash during initialization)
      log(`Waiting for CLIProxy on port ${port}...`);

      const readinessResult = await waitForReadiness(port, 30000);
      if (readinessResult.ready) {
        // Success — detach stderr listener
        if (stderrListener && proxyProcess?.stderr) {
          proxyProcess.stderr.removeListener('data', stderrListener);
        }
        log(`CLIProxy service started on port ${port}`);
        break; // Exit retry loop on success
      }

      // Check if process exited during startup
      const exitInfo = await waitForProcessExit(proxyProcess!, 500);
      if (exitInfo) {
        // Process crashed — capture stderr for diagnostics
        lastExitInfo = exitInfo;
        lastStderr = Buffer.concat(stderrChunks).toString('utf-8').trim();
        log(
          `CLIProxy exited during startup: code=${exitInfo.code}, signal=${exitInfo.signal}` +
            (lastStderr ? `, stderr: ${lastStderr.slice(0, 200)}` : '')
        );

        // Clean up before retry
        if (stderrListener && proxyProcess?.stderr) {
          proxyProcess.stderr.removeListener('data', stderrListener);
        }
        proxyProcess = null;

        // Crash = don't retry (binary is broken, not a transient failure)
        break;
      }

      // Timeout but process still running — could be slow startup, try once more
      log('Readiness check timed out but process is still running');
      lastStderr = Buffer.concat(stderrChunks).toString('utf-8').trim();
      if (stderrListener && proxyProcess?.stderr) {
        proxyProcess.stderr.removeListener('data', stderrListener);
      }

      // If this was the last attempt, kill the process
      if (attempt === MAX_STARTUP_RETRIES && proxyProcess && !proxyProcess.killed) {
        proxyProcess.kill('SIGTERM');
        proxyProcess = null;
      }
    }

    // If we get here, startup failed
    if (!proxyProcess || proxyProcess.killed) {
      const { loadOrCreateUnifiedConfig } = await import('../config/unified-config-loader');
      const { DEFAULT_BACKEND } = await import('./binary/platform-detector');
      const config = loadOrCreateUnifiedConfig();
      const backendLabel =
        (config.cliproxy?.backend ?? DEFAULT_BACKEND) === 'plus' ? 'CLIProxy Plus' : 'CLIProxy';

      let errorDetail: string;
      if (lastExitInfo) {
        const exitDesc = lastExitInfo.signal
          ? `killed by signal ${lastExitInfo.signal}`
          : `exited with code ${lastExitInfo.code}`;
        errorDetail = `${backendLabel} ${exitDesc} on port ${port}`;
        if (lastStderr) {
          // Include first line of stderr for actionable diagnostics
          const firstLine = lastStderr.split('\n')[0]?.slice(0, 200);
          if (firstLine) {
            errorDetail += `: ${firstLine}`;
          }
        }
      } else {
        errorDetail = `${backendLabel} failed to start within 30s on port ${port}`;
        if (lastStderr) {
          const firstLine = lastStderr.split('\n')[0]?.slice(0, 200);
          if (firstLine) {
            errorDetail += ` (last output: ${firstLine})`;
          }
        }
      }

      return {
        started: false,
        alreadyRunning: false,
        port,
        error: errorDetail,
      };
    }

    // 5. Register session
    if (proxyProcess.pid) {
      registerSession(port, proxyProcess.pid);
      log(`Session registered for PID ${proxyProcess.pid}`);
    }

    return { started: true, alreadyRunning: false, port };
  });
}

/**
 * Stop the managed CLIProxy service
 */
export function stopCliproxyService(): boolean {
  // Stop proxy process
  if (proxyProcess && !proxyProcess.killed) {
    proxyProcess.kill('SIGTERM');
    proxyProcess = null;
    return true;
  }
  return false;
}

/**
 * Get service status
 */
export async function getServiceStatus(port: number = CLIPROXY_DEFAULT_PORT): Promise<{
  running: boolean;
  managedByUs: boolean;
  port: number;
}> {
  const running = await isCliproxyRunning(port);
  const managedByUs = proxyProcess !== null && !proxyProcess.killed;

  return { running, managedByUs, port };
}
