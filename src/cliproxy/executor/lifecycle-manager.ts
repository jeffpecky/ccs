/**
 * Lifecycle Manager - Spawn/Kill/Poll operations for CLIProxy
 *
 * Handles:
 * - Spawning CLIProxyAPI binary
 * - Waiting for proxy readiness via HTTP health check
 * - Killing proxy processes
 */

import { spawn, type ChildProcess } from 'child_process';
import * as net from 'net';
import { ProgressIndicator } from '../../utils/progress-indicator';
import { fail } from '../../utils/ui';
import { getCliproxyWritablePath } from '../config/config-generator';
import { getPortCheckCommand, getCatCommand } from '../../utils/platform-commands';
import { type CLIProxyBackend } from '../types';
import { isCliproxyRunning } from '../services/stats-fetcher';

/** Result of waiting for process exit during startup */
interface ProcessExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/**
 * HTTP readiness check — verifies the proxy is not just listening on the port
 * but actually ready to serve requests.
 */
async function waitForHttpReadiness(
  port: number,
  timeout: number = 30000,
  pollInterval: number = 200
): Promise<{ ready: boolean; exitInfo: ProcessExitInfo | null }> {
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

/**
 * Spawn CLIProxyAPI binary with given config.
 * Always captures stderr during startup for diagnostics.
 */
export interface SpawnProxyResult {
  process: ChildProcess;
  stderrChunks: Buffer[];
}

export function spawnProxy(
  binaryPath: string,
  configPath: string,
  verbose: boolean
): SpawnProxyResult {
  const log = (msg: string) => {
    if (verbose) {
      console.error(`[cliproxy] ${msg}`);
    }
  };

  const proxyArgs = ['--config', configPath];
  log(`Spawning: ${binaryPath} ${proxyArgs.join(' ')}`);

  const stderrChunks: Buffer[] = [];

  const proxy = spawn(binaryPath, proxyArgs, {
    stdio: ['ignore', verbose ? 'pipe' : 'ignore', 'pipe'],
    detached: true,
    env: {
      ...process.env,
      WRITABLE_PATH: getCliproxyWritablePath(),
    },
  });

  // Always capture stderr for error diagnostics
  if (proxy.stderr) {
    proxy.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      if (verbose) {
        process.stderr.write(`[cliproxy-err] ${chunk.toString()}`);
      }
    });
  }

  if (verbose) {
    proxy.stdout?.on('data', (data: Buffer) => {
      process.stderr.write(`[cliproxy] ${data.toString()}`);
    });
  }

  proxy.unref();

  proxy.on('error', (error) => {
    console.error(fail(`CLIProxy spawn error: ${error.message}`));
  });

  return { process: proxy, stderrChunks };
}

/**
 * Wait for proxy to be ready with progress indication.
 * Monitors for early process exit and reports diagnostics.
 */
export async function waitForProxyReadyWithSpinner(
  port: number,
  timeout: number,
  pollInterval: number,
  backend: CLIProxyBackend,
  configPath: string,
  proc?: ChildProcess,
  stderrChunks?: Buffer[]
): Promise<void> {
  const readySpinner = new ProgressIndicator(`Waiting for CLIProxy on port ${port}`);
  readySpinner.start();

  try {
    // If we have a process reference, race readiness against exit
    if (proc) {
      const { ready, exitInfo } = await waitForHttpReadiness(port, timeout, pollInterval);

      if (!ready && exitInfo) {
        // Process crashed during startup
        const exitDesc = exitInfo.signal
          ? `killed by signal ${exitInfo.signal}`
          : `exited with code ${exitInfo.code}`;
        const stderrExcerpt = stderrChunks
          ? Buffer.concat(stderrChunks).toString('utf-8').trim().split('\n')[0]?.slice(0, 200)
          : undefined;

        const backendLabel = backend === 'plus' ? 'CLIProxy Plus' : 'CLIProxy';
        readySpinner.fail(`${backendLabel} ${exitDesc}`);

        console.error('');
        console.error(fail(`${backendLabel} crashed during startup`));
        if (stderrExcerpt) {
          console.error(`  Output: ${stderrExcerpt}`);
        }
        console.error('');
        console.error('Possible causes:');
        console.error(`  1. Port ${port} already in use`);
        console.error('  2. Invalid configuration');
        console.error(`  3. Binary error (see output above)`);
        console.error('');
        console.error('Troubleshooting:');
        console.error(`  - Check port: ${getPortCheckCommand(port)}`);
        console.error(`  - View config: ${getCatCommand(configPath)}`);
        console.error('  - Try: Run diagnostics from the dashboard settings');
        console.error('');

        throw new Error(
          `CLIProxy startup failed: ${exitDesc}` + (stderrExcerpt ? `: ${stderrExcerpt}` : '')
        );
      }

      if (!ready) {
        throw new Error(`CLIProxy not ready after ${timeout}ms on port ${port}`);
      }
    } else {
      // No process reference — fall back to simple readiness check
      await waitForHttpReadiness(port, timeout, pollInterval);
    }

    readySpinner.succeed(`CLIProxy ready on port ${port}`);
  } catch (error) {
    const backendLabel = backend === 'plus' ? 'CLIProxy Plus' : 'CLIProxy';
    // If spinner already showed crash details, just re-throw
    if (error instanceof Error && error.message.startsWith('CLIProxy startup failed:')) {
      throw error;
    }
    readySpinner.fail(`${backendLabel} startup failed`);

    const err = error as Error;
    console.error('');
    console.error(fail(`${backendLabel} failed to start`));
    console.error('');
    console.error('Possible causes:');
    console.error(`  1. Port ${port} already in use`);
    console.error('  2. Binary crashed on startup');
    console.error('  3. Invalid configuration');
    console.error('');
    console.error('Troubleshooting:');
    console.error(`  - Check port: ${getPortCheckCommand(port)}`);
    console.error('  - Run with --verbose for detailed logs');
    console.error(`  - View config: ${getCatCommand(configPath)}`);
    console.error('  - Try: Run diagnostics from the dashboard settings');
    console.error('');

    throw new Error(`CLIProxy startup failed: ${err.message}`);
  }
}

/**
 * Check if a port is available
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port, '127.0.0.1');
  });
}

/**
 * Find an available port in range
 */
export async function findAvailablePort(startPort: number, range: number = 10): Promise<number> {
  for (let port = startPort; port < startPort + range; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found in range ${startPort}-${startPort + range - 1}`);
}
