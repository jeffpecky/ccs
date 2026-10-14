/**
 * Droid CLI Detector
 *
 * Detects Factory Droid CLI binary in PATH.
 * Mirrors claude-detector.ts pattern.
 */

import * as fs from 'fs';
import { execSync, execFileSync } from 'child_process';
import { expandPath } from '../utils/helpers';
import { TargetBinaryInfo } from './target-adapter';

/**
 * Detect Droid CLI executable.
 *
 * Priority:
 * 1. CCS_DROID_PATH env var (user override)
 * 2. PATH lookup via which/where.exe
 */
export function detectDroidCli(): string | null {
  // Priority 1: CCS_DROID_PATH environment variable
  if (process.env.CCS_DROID_PATH) {
    const customPath = expandPath(process.env.CCS_DROID_PATH);
    try {
      if (fs.statSync(customPath).isFile()) {
        return customPath;
      }
      console.warn('[!] CCS_DROID_PATH points to a directory, not a file:', customPath);
      console.warn('    Refusing PATH fallback while CCS_DROID_PATH is explicitly set.');
      return null;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        console.warn('[!] Warning: CCS_DROID_PATH is set but file not found:', customPath);
      } else {
        console.warn(
          `[!] Warning: CCS_DROID_PATH is not accessible (${error.code || 'unknown error'}):`,
          customPath
        );
      }
      console.warn('    Refusing PATH fallback while CCS_DROID_PATH is explicitly set.');
      return null;
    }
  }

  // Priority 2: Resolve 'droid' from PATH
  const isWindows = process.platform === 'win32';

  try {
    const cmd = isWindows ? 'where.exe droid' : 'which droid';
    const result = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      windowsHide: true,
    }).trim();

    const matches = result
      .split('\n')
      .map((p) => p.trim())
      .filter((p) => p);

    const candidates = isWindows
      ? [
          ...matches.filter((p) => /\.(exe|cmd|bat|ps1)$/i.test(p)),
          ...matches.filter((p) => !/\.(exe|cmd|bat|ps1)$/i.test(p)),
        ]
      : matches;

    for (const candidate of candidates) {
      try {
        if (fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // Ignore unreadable or disappearing path candidates and try next one
      }
    }
  } catch {
    // droid not in PATH
  }

  return null;
}

/**
 * Get Droid CLI binary info for target adapter.
 */
export function getDroidBinaryInfo(): TargetBinaryInfo | null {
  const droidPath = detectDroidCli();
  if (!droidPath) return null;

  const isWindows = process.platform === 'win32';
  const needsShell = isWindows && /\.(cmd|bat|ps1)$/i.test(droidPath);

  return { path: droidPath, needsShell };
}

/**
 * Check Droid CLI version for compatibility warnings.
 * Non-blocking — logs warning and continues.
 */
export function checkDroidVersion(droidPath: string): void {
  try {
    const version = execFileSync(droidPath, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      windowsHide: true,
    }).trim();

    // Parse semver major version
    const match = version.match(/(\d+)\.\d+\.\d+/);
    if (match) {
      const major = parseInt(match[1]);
      if (major >= 2) {
        console.warn(
          `[!] Droid version ${version} not verified with CCS. Config format may differ.`
        );
      }
    }
  } catch {
    // Version check is best-effort — don't block execution
  }
}
