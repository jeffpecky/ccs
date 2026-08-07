/**
 * In-Memory Quota Cache
 *
 * Reduces external API calls by caching quota results with TTL.
 * Uses a simple Map-based cache with automatic expiration.
 */

/** Default TTL for quota cache entries (0 = disabled, quota is real-time) */
const DEFAULT_CACHE_TTL_MS = 0;

/** Cache entry with timestamp */
interface CacheEntry<T> {
  data: T;
  cachedAt: number;
}

/** In-memory cache store */
const quotaCache = new Map<string, CacheEntry<unknown>>();

/**
 * Generate cache key for provider/account combination
 */
function getCacheKey(provider: string, accountId: string): string {
  return `${provider}:${accountId}`;
}

/**
 * Get cached quota result if still valid
 * @param provider - Provider name (codex, gemini, agy)
 * @param accountId - Account identifier
 * @param ttlMs - Time-to-live in milliseconds (default: 2 minutes)
 * @returns Cached result or null if expired/missing
 */
export function getCachedQuota<T>(
  provider: string,
  accountId: string,
  ttlMs: number = DEFAULT_CACHE_TTL_MS
): T | null {
  const key = getCacheKey(provider, accountId);
  const entry = quotaCache.get(key) as CacheEntry<T> | undefined;

  if (!entry) {
    return null;
  }

  // Check if cache is still valid
  if (Date.now() - entry.cachedAt < ttlMs) {
    return entry.data;
  }

  // Cache expired - remove entry
  quotaCache.delete(key);
  return null;
}

/**
 * Store quota result in cache
 * @param provider - Provider name (codex, gemini, agy)
 * @param accountId - Account identifier
 * @param data - Quota result to cache
 */
export function setCachedQuota<T>(provider: string, accountId: string, data: T): void {
  const key = getCacheKey(provider, accountId);
  quotaCache.set(key, {
    data,
    cachedAt: Date.now(),
  });
}

/**
 * Invalidate cache for a specific account
 * @param provider - Provider name
 * @param accountId - Account identifier
 */
export function invalidateQuotaCache(provider: string, accountId: string): void {
  const key = getCacheKey(provider, accountId);
  quotaCache.delete(key);
}

/**
 * Invalidate all cache entries for a provider
 * @param provider - Provider name to clear
 */
export function invalidateProviderCache(provider: string): void {
  const prefix = `${provider}:`;
  for (const key of quotaCache.keys()) {
    if (key.startsWith(prefix)) {
      quotaCache.delete(key);
    }
  }
}

/**
 * Clear entire quota cache
 */
export function clearQuotaCache(): void {
  quotaCache.clear();
}

/**
 * Get cache statistics for debugging
 */
export function getQuotaCacheStats(): { size: number; entries: string[] } {
  return {
    size: quotaCache.size,
    entries: Array.from(quotaCache.keys()),
  };
}

/** Export cache TTL for consumers */
export const QUOTA_CACHE_TTL_MS = DEFAULT_CACHE_TTL_MS;
