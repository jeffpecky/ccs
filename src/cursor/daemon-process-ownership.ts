import { spawnSync } from 'child_process';
import * as fs from 'fs';

export type DaemonOwnershipStatus = 'owned' | 'not-owned' | 'not-running' | 'unknown';

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function getProcessCommandLine(pid: number): string | null {
  if (process.platform === 'linux') {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // /proc cmdline uses null separators between arguments.
        const commandLine = fs
          .readFileSync(`/proc/${pid}/cmdline`, 'utf8')
          .replace(/\0/g, ' ')
          .trim();
        if (commandLine) {
          return commandLine;
        }
      } catch {
        return null;
      }

      sleepSync(25);
    }

    return null;
  }

  if (process.platform === 'darwin') {
    try {
      const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
        encoding: 'utf8',
      });
      if (result.error || result.status !== 0) {
        return null;
      }
      return result.stdout.trim();
    } catch {
      return null;
    }
  }

  if (process.platform === 'win32') {
    const command = `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object -ExpandProperty CommandLine)`;
    const shells = ['powershell.exe', 'powershell', 'pwsh.exe', 'pwsh'];
    for (const shell of shells) {
      try {
        const result = spawnSync(shell, ['-NoProfile', '-Command', command], {
          encoding: 'utf8',
          windowsHide: true,
        });
        if (result.error) {
          continue;
        }
        if (result.status !== 0) {
          return null;
        }
        return result.stdout.trim();
      } catch {
        // Try next shell candidate
      }
    }
    return null;
  }

  return null;
}

export function verifyProcessOwnership(
  pid: number,
  ownershipMatcher: (commandLine: string) => boolean
): DaemonOwnershipStatus {
  try {
    process.kill(pid, 0);
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ESRCH') {
      return 'not-running';
    }
    return 'unknown';
  }

  const commandLine = getProcessCommandLine(pid);
  if (!commandLine) {
    return 'unknown';
  }

  return ownershipMatcher(commandLine) ? 'owned' : 'not-owned';
}

export function verifyDaemonOwnership(pid: number): DaemonOwnershipStatus {
  return verifyProcessOwnership(
    pid,
    (commandLine) =>
      commandLine.includes('--ccs-daemon') && commandLine.includes('cursor-daemon-entry')
  );
}
