/**
 * Lifecycle Manager - Spawn/Kill/Poll operations for CLIProxy
 *
 * Handles:
 * - Spawning CLIProxyAPI binary
 * - Waiting for proxy readiness via TCP polling
 * - Killing proxy processes
 */

import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';
import { ProgressIndicator } from '../../utils/progress-indicator';
import { fail } from '../../utils/ui';
import { getCliproxyWritablePath } from '../config/config-generator';
import { getPortCheckCommand, getCatCommand } from '../../utils/platform-commands';
import { CLIProxyBackend } from '../types';

/**
 * Wait for TCP port to become available
 * Uses polling since CLIProxyAPI doesn't emit PROXY_READY signal
 */
export async function waitForProxyReady(
  port: number,
  timeout: number = 5000,
  pollInterval: number = 100
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ port, host: '127.0.0.1' }, () => {
          socket.destroy();
          resolve();
        });

        socket.on('error', (err) => {
          socket.destroy();
          reject(err);
        });

        // Individual connection timeout
        socket.setTimeout(1000, () => {
          socket.destroy();
          reject(new Error('Connection timeout'));
        });
      });

      return; // Connection successful - proxy is ready
    } catch {
      // Connection failed, wait and retry
      await new Promise((r) => setTimeout(r, pollInterval));
    }
  }

  throw new Error(`CLIProxy not ready after ${timeout}ms on port ${port}`);
}

/**
 * Spawn CLIProxyAPI binary with given config
 */
export function spawnProxy(binaryPath: string, configPath: string, verbose: boolean): ChildProcess {
  const log = (msg: string) => {
    if (verbose) {
      console.error(`[cliproxy] ${msg}`);
    }
  };

  const proxyArgs = ['--config', configPath];
  log(`Spawning: ${binaryPath} ${proxyArgs.join(' ')}`);

  const proxy = spawn(binaryPath, proxyArgs, {
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: true,
    env: {
      ...process.env,
      WRITABLE_PATH: getCliproxyWritablePath(),
    },
  });

  proxy.unref();

  proxy.on('error', (error) => {
    console.error(fail(`CLIProxy spawn error: ${error.message}`));
  });

  return proxy;
}

/**
 * Wait for proxy to be ready with progress indication
 */
export async function waitForProxyReadyWithSpinner(
  port: number,
  timeout: number,
  pollInterval: number,
  backend: CLIProxyBackend,
  configPath: string
): Promise<void> {
  const readySpinner = new ProgressIndicator(`Waiting for CLIProxy on port ${port}`);
  readySpinner.start();

  try {
    await waitForProxyReady(port, timeout, pollInterval);
    readySpinner.succeed(`CLIProxy ready on port ${port}`);
  } catch (error) {
    const backendLabel = backend === 'plus' ? 'CLIProxy Plus' : 'CLIProxy';
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
