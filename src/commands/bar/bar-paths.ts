/**
 * Shared path helpers for the `ccs bar` command family.
 *
 * Centralises the paths under ~/.ccs/bar/ so every subcommand stays DRY.
 * All paths derive from ccsDir (i.e. getCcsDir()) so CCS_HOME isolation
 * works correctly in tests.
 */

import * as fs from 'fs';
import * as path from 'path';

/** launch.json — consumed by the Swift app to spawn the server without a shell PATH. */
export function getLaunchJsonPath(ccsDir: string): string {
  return path.join(ccsDir, 'bar', 'launch.json');
}

/** server.pid — PID of the live detached server process. */
export function getServerPidPath(ccsDir: string): string {
  return path.join(ccsDir, 'bar', 'server.pid');
}

/** bar.json — live discovery file consumed by the Swift app. */
export function getBarJsonPath(ccsDir: string): string {
  return path.join(ccsDir, 'bar.json');
}

/** bar/ subdirectory (parent of all bar artefacts). */
export function getBarDir(ccsDir: string): string {
  return path.join(ccsDir, 'bar');
}

/** bar/launches/ — parent of per-launch diagnostics directories. */
export function getLaunchesDir(ccsDir: string): string {
  return path.join(getBarDir(ccsDir), 'launches');
}

/** bar/launches/<launchId>/ — diagnostics for one detached launch attempt. */
export function getLaunchDir(ccsDir: string, launchId: string): string {
  return path.join(getLaunchesDir(ccsDir), launchId);
}

/** bar/launches/<launchId>/serve.log — stdout/stderr of one detached server child. */
export function getLaunchServeLogPath(ccsDir: string, launchId: string): string {
  return path.join(getLaunchDir(ccsDir, launchId), 'serve.log');
}

/** bar/latest-launch.json — replace-on-launch pointer to the newest attempt. */
export function getLatestLaunchPointerPath(ccsDir: string): string {
  return path.join(getBarDir(ccsDir), 'latest-launch.json');
}

/** Schema version constant for latest-launch.json. */
export const LATEST_LAUNCH_SCHEMA = 1;

/**
 * Shape of latest-launch.json. This is a single-slot pointer that is fully
 * replaced on every detached launch attempt — never appended to — so readers
 * can never mistake an older entry for the current launch. The explicit status
 * field lets readers treat failed and not-yet-ready attempts distinctly from a
 * healthy launch.
 */
export type LatestLaunchStatus = 'starting' | 'ready' | 'failed';

export const LATEST_LAUNCH_STATUSES: readonly LatestLaunchStatus[] = [
  'starting',
  'ready',
  'failed',
];

export interface LatestLaunchPointer {
  schema: typeof LATEST_LAUNCH_SCHEMA;
  /** Identity minted by the launcher that owns this attempt. */
  launchId: string;
  /** Port the detached server child was asked to bind. */
  port: number;
  /** ISO timestamp of when the attempt started. */
  startedAt: string;
  /** Absolute path of this attempt's serve.log. */
  logPath: string;
  /**
   * Lifecycle of the attempt: `starting` until authenticated health succeeds,
   * then `ready`; any failure path marks the attempt `failed`.
   */
  status: LatestLaunchStatus;
}

/** Read and fully validate latest-launch.json; null when absent or malformed. */
export function readLatestLaunchPointer(pointerPath: string): LatestLaunchPointer | null {
  let parsed: Partial<LatestLaunchPointer>;
  try {
    parsed = JSON.parse(fs.readFileSync(pointerPath, 'utf8')) as Partial<LatestLaunchPointer>;
  } catch {
    return null;
  }
  if (parsed.schema !== LATEST_LAUNCH_SCHEMA) return null;
  if (!isValidLaunchId(parsed.launchId)) return null;
  if (!Number.isSafeInteger(parsed.port) || (parsed.port ?? 0) <= 0 || (parsed.port ?? 0) > 65535) {
    return null;
  }
  if (typeof parsed.startedAt !== 'string' || parsed.startedAt === '') return null;
  if (typeof parsed.logPath !== 'string' || parsed.logPath === '') return null;
  if (!LATEST_LAUNCH_STATUSES.includes(parsed.status as LatestLaunchStatus)) return null;
  return parsed as LatestLaunchPointer;
}

/** Accepted launchId shape: URL/path safe, non-empty, bounded length. */
export const LAUNCH_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isValidLaunchId(value: unknown): value is string {
  return typeof value === 'string' && LAUNCH_ID_PATTERN.test(value);
}

/** Schema version constant for launch.json. */
export const LAUNCH_JSON_SCHEMA = 1;

/** Shape of launch.json written by install and refreshed by launch. */
export interface LaunchJson {
  schema: typeof LAUNCH_JSON_SCHEMA;
  /** Absolute path to the node/bun binary (process.execPath). */
  runtime: string;
  /** Absolute private CCS launcher shim + subcommand args: [ccs.js, 'bar', 'serve']. */
  args: string[];
  /** os.homedir() — cwd for the spawned server. */
  home: string;
  /** CCS_HOME env value when set; omitted otherwise. */
  ccsHome?: string;
}
