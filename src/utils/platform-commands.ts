/**
 * Platform-aware command suggestions and utilities
 *
 * Provides OS-specific commands for troubleshooting messages
 * to help non-technical users on Windows, macOS, and Linux.
 */

import { execSync } from 'child_process';

const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

/**
 * Get platform-specific command to check what's using a port
 */
export function getPortCheckCommand(port: number): string {
  if (isWindows) {
    return `netstat -ano | findstr :${port}`;
  }
  return `lsof -i :${port}`;
}

/**
 * Get platform-specific command to view file contents
 */
export function getCatCommand(filePath: string): string {
  if (isWindows) {
    // Use type for CMD, Get-Content for PowerShell
    return `type "${filePath}"`;
  }
  return `cat "${filePath}"`;
}

/**
 * Get platform-specific command to kill CLIProxy Plus processes
 */
export function getKillCLIProxyCommand(): string {
  if (isWindows) {
    return 'taskkill /F /IM cli-proxy-api-plus.exe';
  }
  return 'pkill -f cli-proxy-api-plus';
}

/**
 * Get platform-specific command to kill a process by PID
 */
export function getKillPidCommand(pid: number): string {
  if (isWindows) {
    return `taskkill /F /PID ${pid}`;
  }
  return `kill -9 ${pid}`;
}

/**
 * Get human-friendly platform name
 */
export function getPlatformName(): string {
  if (isWindows) return 'Windows';
  if (isMac) return 'macOS';
  return 'Linux';
}

/**
 * Kill process by PID (cross-platform)
 * @returns true if killed successfully, false otherwise
 */
export function killProcessByPid(pid: number, verbose = false): boolean {
  try {
    if (isWindows) {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe', windowsHide: true });
    } else {
      execSync(`kill -9 ${pid}`, { stdio: 'pipe', windowsHide: true });
    }
    if (verbose) {
      console.error(`[cleanup] Killed process ${pid}`);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill all CLIProxy Plus processes (cross-platform)
 * @returns number of processes killed
 */
export function killAllCLIProxyProcesses(verbose = false): number {
  let killed = 0;

  try {
    if (isWindows) {
      // Windows: taskkill by image name
      // Use /T to kill child processes too
      execSync('taskkill /F /IM cli-proxy-api-plus.exe /T 2>nul', {
        stdio: 'pipe',
        windowsHide: true,
      });
      killed++;
    } else {
      // Unix: pkill with pattern matching
      try {
        execSync('pkill -9 -f cli-proxy-api-plus', { stdio: 'pipe', windowsHide: true });
        killed++;
      } catch {
        // pkill returns non-zero if no processes matched - that's OK
      }
    }
  } catch {
    // No processes to kill or command failed
  }

  if (verbose && killed > 0) {
    console.error(`[cleanup] Killed ${killed} CLIProxy Plus process(es)`);
  }

  return killed;
}

/**
 * Kill process on specific port (cross-platform)
 * @returns true if a process was killed, false otherwise
 */
export function killProcessOnPort(port: number, verbose = false): boolean {
  try {
    if (isWindows) {
      // Windows: netstat + taskkill
      const result = execSync(`netstat -ano | findstr :${port}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        windowsHide: true,
      });
      const lines = result.trim().split('\n');
      let killed = false;
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && /^\d+$/.test(pid)) {
          try {
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe', windowsHide: true });
            if (verbose) {
              console.error(`[cleanup] Killed process ${pid} on port ${port}`);
            }
            killed = true;
          } catch {
            // Process may have already exited
          }
        }
      }
      return killed;
    } else {
      // Unix: lsof + kill
      const result = execSync(`lsof -ti:${port}`, {
        encoding: 'utf-8',
        stdio: 'pipe',
        windowsHide: true,
      });
      const pids = result
        .trim()
        .split('\n')
        .filter((p) => p);
      for (const pid of pids) {
        try {
          execSync(`kill -9 ${pid}`, { stdio: 'pipe', windowsHide: true });
          if (verbose) {
            console.error(`[cleanup] Killed process ${pid} on port ${port}`);
          }
        } catch {
          // Process may have already exited
        }
      }
      return pids.length > 0;
    }
  } catch {
    // No process on port or command failed
    return false;
  }
}

export default {
  getPortCheckCommand,
  getCatCommand,
  getKillCLIProxyCommand,
  getKillPidCommand,
  getPlatformName,
  killProcessByPid,
  killAllCLIProxyProcesses,
  killProcessOnPort,
};
