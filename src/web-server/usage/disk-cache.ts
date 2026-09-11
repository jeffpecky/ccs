/**
 * Persistent Disk Cache for Usage Data
 *
 * Caches aggregated usage data to disk to avoid re-parsing 6000+ JSONL files
 * on every dashboard startup. Uses TTL-based invalidation with stale-while-revalidate.
 *
 * Cache location: ~/.ccs/cache/usage.json
 * Default TTL: 5 minutes (configurable)
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import type { DailyUsage, HourlyUsage, MonthlyUsage, SessionUsage } from './types';
import { ok, info, warn } from '../../utils/ui';
import { getCcsDir } from '../../config/config-loader-facade';

// Cache configuration
function getCacheDir() {
  return path.join(getCcsDir(), 'cache');
}
function getCacheFile() {
  return path.join(getCacheDir(), 'usage.json');
}
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const STALE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (max age for stale data)

/** Structure of the disk cache file */
export interface UsageDiskCache {
  version: number;
  timestamp: number;
  daily: DailyUsage[];
  hourly: HourlyUsage[];
  monthly: MonthlyUsage[];
  session: SessionUsage[];
}

// Current cache version - increment to invalidate old caches
// v1: Initial cache format (daily, monthly, session)
// v2: Added multi-instance aggregation
// v3: Added hourly data to cache
// v4: Pricing fix for Claude 4.6 models (invalidate stale costs)
const CACHE_VERSION = 4;

/**
 * Ensure ~/.ccs/cache directory exists
 */
async function ensureCacheDirAsync(): Promise<void> {
  const dir = getCacheDir();
  try {
    await fsp.access(dir);
  } catch {
    await fsp.mkdir(dir, { recursive: true });
  }
}

/**
 * Async read usage data from disk cache.
 *
 * The usage cache can grow to many megabytes; reading it through the thread
 * pool keeps the event loop free to answer health/summary requests while the
 * cache loads. Returns null on missing/corrupt/incompatible caches.
 */
export async function readDiskCacheAsync(): Promise<UsageDiskCache | null> {
  try {
    const cacheFile = getCacheFile();
    let stat: fs.Stats;
    try {
      stat = await fsp.stat(cacheFile);
    } catch {
      return null;
    }
    if (!stat.isFile()) {
      return null;
    }

    const data = await fsp.readFile(cacheFile, 'utf-8');
    // Yield once so responses queued behind this load are not stuck behind
    // the JSON parse of a large cache file.
    await new Promise<void>((resolve) => setImmediate(resolve));
    const cache: UsageDiskCache = JSON.parse(data);

    if (cache.version !== CACHE_VERSION) {
      console.log(info('Cache version mismatch, will refresh'));
      return null;
    }

    return cache;
  } catch (err) {
    console.log(info('Cache read failed, will refresh:') + ` ${(err as Error).message}`);
    return null;
  }
}

/**
 * Check if disk cache is fresh (within TTL)
 */
export function isDiskCacheFresh(cache: UsageDiskCache | null): boolean {
  if (!cache) return false;
  const age = Date.now() - cache.timestamp;
  return age < CACHE_TTL_MS;
}

/**
 * Check if disk cache is stale but usable (between TTL and STALE_TTL)
 */
export function isDiskCacheStale(cache: UsageDiskCache | null): boolean {
  if (!cache) return false;
  const age = Date.now() - cache.timestamp;
  return age >= CACHE_TTL_MS && age < STALE_TTL_MS;
}

/**
 * Write usage data to disk cache
 */
export async function writeDiskCache(
  daily: DailyUsage[],
  hourly: HourlyUsage[],
  monthly: MonthlyUsage[],
  session: SessionUsage[]
): Promise<void> {
  try {
    await ensureCacheDirAsync();

    const cache: UsageDiskCache = {
      version: CACHE_VERSION,
      timestamp: Date.now(),
      daily,
      hourly,
      monthly,
      session,
    };

    // Write atomically using temp file + rename
    const cacheFile = getCacheFile();
    const tempFile = cacheFile + '.tmp';
    await fsp.writeFile(tempFile, JSON.stringify(cache), 'utf-8');
    await fsp.rename(tempFile, cacheFile);

    console.log(ok('Disk cache updated'));
  } catch (err) {
    // Non-fatal - we can still serve from memory
    console.log(warn('Failed to write disk cache:') + ` ${(err as Error).message}`);
  }
}

/**
 * Get cache age in human-readable format
 */
export function getCacheAge(cache: UsageDiskCache | null): string {
  if (!cache) return 'never';

  const age = Date.now() - cache.timestamp;
  const seconds = Math.floor(age / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s ago`;
  return `${seconds}s ago`;
}

/**
 * Delete disk cache (for manual refresh)
 */
export function clearDiskCache(): void {
  try {
    const cacheFile = getCacheFile();
    if (fs.existsSync(cacheFile)) {
      fs.unlinkSync(cacheFile);
      console.log(ok('Disk cache cleared'));
    }
  } catch (err) {
    console.log(warn('Failed to clear disk cache:') + ` ${(err as Error).message}`);
  }
}
