/**
 * CLIProxy Snapshot Reader
 *
 * Lightweight reader that extracts the flat CliproxyUsageHistoryDetail array
 * from the persisted snapshot at ~/.ccs/cache/cliproxy-usage/latest.json.
 *
 * This is a read-only helper — it never writes or syncs. The syncer owns
 * the write path; this module owns the "give me the raw details" path
 * needed by the bar-routes aggregator for per-account cost mapping.
 */

import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { getCcsDir } from '../../config/config-loader-facade';
import {
  normalizeCliproxyUsageHistoryDetail,
  type CliproxyUsageHistoryDetail,
} from './cliproxy-usage-transformer';

const SUPPORTED_SNAPSHOT_VERSION = 3;

/**
 * Hard cap on snapshot bytes parsed per read. The bar glance degrades to no
 * cliproxy rows beyond this instead of blocking the event loop behind a
 * pathologically large JSON.parse.
 */
const SNAPSHOT_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Parsed-snapshot cache. latest.json reaches many megabytes (47k+ detail
 * records ≈ 250ms of synchronous JSON.parse plus the normalize pass), and the
 * file lands on the /api/bar/summary request path — parsing it per request
 * blocked the event loop and pushed summary responses to multi-second
 * durations. Keyed by (mtimeMs, size) from an async stat, so a steady-state
 * read costs one stat call; the syncer's atomic temp+rename write always
 * bumps both fields. Concurrent misses share a single in-flight parse.
 * The returned array is shared and MUST be treated as read-only.
 */
let cachedSnapshot: { mtimeMs: number; size: number; details: CliproxyUsageHistoryDetail[] } | null = null;
let inFlightParse: Promise<CliproxyUsageHistoryDetail[]> | null = null;

function getLatestSnapshotPath(): string {
  return path.join(getCcsDir(), 'cache', 'cliproxy-usage', 'latest.json');
}

/**
 * Read the persisted CLIProxy usage snapshot and return its raw detail records.
 *
 * Returns an empty array when:
 * - The snapshot file does not exist
 * - The file cannot be parsed as JSON
 * - The snapshot version is unrecognised
 * - The details array is absent or malformed
 *
 * Individual malformed detail records are silently dropped (normalizer returns null).
 */
export async function loadCliproxySnapshotDetails(): Promise<CliproxyUsageHistoryDetail[]> {
  const snapshotPath = getLatestSnapshotPath();

  try {
    // Async stat/read keep this helper off the event loop even when the
    // snapshot is large (it sits on the /api/bar/summary request path).
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(snapshotPath);
    } catch {
      return [];
    }
    if (!stat.isFile() || stat.size > SNAPSHOT_MAX_BYTES) {
      return [];
    }
    if (cachedSnapshot && cachedSnapshot.mtimeMs === stat.mtimeMs && cachedSnapshot.size === stat.size) {
      return cachedSnapshot.details;
    }
    if (inFlightParse) {
      return inFlightParse;
    }
    inFlightParse = parseSnapshotDetails(snapshotPath, stat.mtimeMs, stat.size)
      .catch(() => [] as CliproxyUsageHistoryDetail[])
      .finally(() => {
        inFlightParse = null;
      });
    return inFlightParse;
  } catch {
    // IO / parse errors are non-fatal — bar glance degrades gracefully
    return [];
  }
}

async function parseSnapshotDetails(
  snapshotPath: string,
  mtimeMs: number,
  size: number
): Promise<CliproxyUsageHistoryDetail[]> {
  const raw = await fsp.readFile(snapshotPath, 'utf-8');
  const snapshot = JSON.parse(raw) as Record<string, unknown>;

  if (snapshot.version !== SUPPORTED_SNAPSHOT_VERSION) {
    // Legacy / future snapshot — skip rather than mis-interpret. Not cached:
    // the syncer's next atomic rewrite produces a new (mtime, size) anyway.
    return [];
  }

  const details = snapshot.details;
  if (!Array.isArray(details)) {
    return [];
  }

  const normalized = details
    .map((item) => normalizeCliproxyUsageHistoryDetail(item))
    .filter((item): item is CliproxyUsageHistoryDetail => item !== null);
  cachedSnapshot = { mtimeMs, size, details: normalized };
  return normalized;
}
