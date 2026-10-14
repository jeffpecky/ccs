/**
 * Unified Proxy Detector
 *
 * Single source of truth for CLIProxy detection.
 * Uses multiple detection methods with fallbacks:
 * 1. HTTP health check (most reliable, ~1s timeout)
 * 2. Session lock file (sessions.json)
 * 3. Port process detection (fallback for orphaned proxies)
 *
 * Detection Order Rationale:
 * - HTTP first: Fastest verification that proxy is responsive
 * - Session lock second: Catches proxies that are starting up
 * - Port process third: Handles orphaned proxies and Windows PID-XXXXX case
 *
 * Solves race conditions between cliproxy-executor.ts and service-manager.ts
 */

import { getExistingProxy, registerSession, getRunningProxyVersion } from '../session-tracker';
import { isCliproxyRunning } from '../services/stats-fetcher';
import {
  getPortProcess,
  isCLIProxyProcess,
  testLocalhostBinding,
  PortProcess,
} from '../../utils/port-utils';
import { CLIPROXY_DEFAULT_PORT } from '../config/port-manager';
import { createLogger } from '../../services/logging';

/** Detection method used to find the proxy */
export type DetectionMethod = 'http' | 'session-lock' | 'port-process' | 'http-retry';

/** Proxy detection status */
export interface ProxyStatus {
  /** Whether a proxy is running on the port */
  running: boolean;
  /** Whether the proxy was verified healthy via HTTP */
  verified: boolean;
  /** How the proxy was detected */
  method?: DetectionMethod;
  /** PID of the running proxy (if known) */
  pid?: number;
  /** Whether port is blocked by non-CLIProxy process */
  blocked?: boolean;
  /** Process blocking the port (if blocked) */
  blocker?: PortProcess;
  /** Number of active sessions (if session-lock found) */
  sessionCount?: number;
  /** Version of the running proxy (from session lock) */
  version?: string;
}

/** Optional logger function for verbose output */
type LogFn = (msg: string) => void;

/** No-op logger for when verbose is disabled */
const noopLog: LogFn = () => {};
const logger = createLogger('cliproxy:proxy-detector');

/**
 * Detect running CLIProxy using multiple methods with fallbacks.
 *
 * Detection order (most reliable first):
 * 1. HTTP health check - fastest, verifies proxy is responsive
 * 2. Session lock - checks sessions.json for tracked proxy
 * 3. Port process - checks OS-level port ownership
 *
 * @param port Port to check (default: 8317)
 * @param verbose Enable verbose logging (default: false)
 * @returns ProxyStatus with detection details
 */
export async function detectRunningProxy(
  port: number = CLIPROXY_DEFAULT_PORT,
  verbose: boolean = false
): Promise<ProxyStatus> {
  const log: LogFn = verbose ? (msg) => logger.debug('detect.verbose', msg, { port }) : noopLog;

  // Validate port - fallback to default if invalid
  const validPort =
    port && Number.isFinite(port) && port >= 1 && port <= 65535 ? port : CLIPROXY_DEFAULT_PORT;

  log(`Detecting proxy on port ${validPort}...`);

  // 1. First: HTTP health check (fastest, most reliable)
  log('Trying HTTP health check...');
  const healthy = await isCliproxyRunning(validPort);
  if (healthy) {
    // Proxy is running and responsive
    // Try to get PID from session lock if available
    const lock = getExistingProxy(validPort);
    let pid = lock?.pid;

    // If no PID from session lock, try port-process detection
    // This handles orphaned proxies (running but no sessions.json)
    if (!pid) {
      log('No PID from session lock, checking port process...');
      const portProcess = await getPortProcess(validPort);
      if (portProcess) {
        pid = portProcess.pid;
        log(`Got PID from port process: ${pid}`);
      }
    }

    // Get version from session lock
    const runningVersion = getRunningProxyVersion(validPort);

    log(
      `HTTP check passed, proxy healthy (PID: ${pid ?? 'unknown'}, version: ${runningVersion ?? 'unknown'})`
    );
    return {
      running: true,
      verified: true,
      method: 'http',
      pid,
      sessionCount: lock?.sessions?.length,
      version: runningVersion ?? undefined,
    };
  }
  log('HTTP check failed, proxy not responding');

  // 2. Second: Check session lock file
  log('Checking session lock file...');
  const lock = getExistingProxy(validPort);
  if (lock) {
    // Session lock exists - proxy might be starting up
    // The lock validates PID is running, so proxy exists but not ready
    const lockVersion = getRunningProxyVersion(validPort);
    log(
      `Session lock found: PID ${lock.pid}, ${lock.sessions.length} sessions, version: ${lockVersion ?? 'unknown'}`
    );
    return {
      running: true,
      verified: false,
      method: 'session-lock',
      pid: lock.pid,
      sessionCount: lock.sessions.length,
      version: lockVersion ?? undefined,
    };
  }
  log('No session lock found');

  // 3. Third: Check port process (fallback for orphaned/untracked proxy)
  // Bind-test first (pure Node): if we can bind to loopback, nothing is
  // listening there — no proxy and no blocker — so skip the netstat shell-out.
  const binding = await testLocalhostBinding(validPort);
  if (binding.success) {
    log('Port is free (bind test), no proxy detected');
    return {
      running: false,
      verified: false,
    };
  }
  log('Checking port process...');
  const portProcess = await getPortProcess(validPort);
  if (portProcess) {
    log(`Port occupied by: ${portProcess.processName} (PID ${portProcess.pid})`);

    // Check by process name first (works on Linux/macOS, may fail on Windows)
    if (isCLIProxyProcess(portProcess)) {
      log('Process name matches CLIProxy, retrying HTTP...');
      // Looks like CLIProxy by name - verify with HTTP
      const retryHealth = await isCliproxyRunning(validPort);
      if (retryHealth) {
        log('HTTP retry passed, proxy is healthy');
        return {
          running: true,
          verified: true,
          method: 'http-retry',
          pid: portProcess.pid,
        };
      }
      // CLIProxy by name but not responding - might be starting up
      log('HTTP retry failed, proxy starting up or unresponsive');
      return {
        running: true,
        verified: false,
        method: 'port-process',
        pid: portProcess.pid,
      };
    }

    // Process name doesn't match (or Windows returned PID-XXXXX)
    // Do one more HTTP check to be sure it's not ours
    log('Process name unrecognized, final HTTP check (Windows PID-XXXXX case)...');
    const finalHealthCheck = await isCliproxyRunning(validPort);
    if (finalHealthCheck) {
      // It IS our proxy, just with unrecognized name (Windows case)
      log('Final HTTP check passed, reclaiming proxy with unrecognized name');
      return {
        running: true,
        verified: true,
        method: 'http-retry',
        pid: portProcess.pid,
      };
    }

    // Definitely not our proxy - port is blocked
    log(`Port blocked by non-CLIProxy process: ${portProcess.processName}`);
    return {
      running: false,
      verified: false,
      blocked: true,
      blocker: portProcess,
    };
  }

  // Port is free
  log('Port is free, no proxy detected');
  return {
    running: false,
    verified: false,
  };
}

/**
 * Wait for proxy to become ready (healthy via HTTP).
 * Useful after detecting proxy via session-lock or port-process.
 *
 * @param port Port to check
 * @param timeout Max wait time in ms (default: 5000)
 * @param pollInterval Time between checks in ms (default: 100)
 * @returns true if proxy became ready, false if timeout
 */
export async function waitForProxyHealthy(
  port: number,
  timeout: number = 5000,
  pollInterval: number = 100
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const healthy = await isCliproxyRunning(port);
    if (healthy) {
      return true;
    }
    await new Promise((r) => setTimeout(r, pollInterval));
  }

  return false;
}

/**
 * Attempt to reclaim an orphaned CLIProxy (running but not in session tracker).
 * Registers a new session with the detected proxy.
 *
 * @param port Port where proxy is running
 * @param pid PID of the proxy process
 * @param verbose Enable verbose logging (default: false)
 * @returns Session ID if reclaimed, null if failed
 */
export function reclaimOrphanedProxy(
  port: number,
  pid: number,
  verbose: boolean = false
): string | null {
  const log: LogFn = verbose
    ? (msg) => logger.debug('reclaim.verbose', msg, { port, pid })
    : noopLog;

  try {
    log(`Reclaiming orphaned proxy: port=${port}, pid=${pid}`);
    const sessionId = registerSession(port, pid);
    log(`Successfully reclaimed proxy, session ID: ${sessionId}`);
    return sessionId;
  } catch (err) {
    const error = err as Error;
    log(`Failed to reclaim proxy: ${error.message}`);
    return null;
  }
}
