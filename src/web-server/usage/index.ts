/**
 * Usage Module Barrel Export
 *
 * Re-exports all usage analytics functionality for convenient imports.
 */

// Types
export type {
  ModelBreakdown,
  DailyUsage,
  HourlyUsage,
  MonthlyUsage,
  SessionUsage,
  TokenCategoryCost,
  TokenBreakdown,
  AnomalyType,
  Anomaly,
  AnomalySummary,
  UsageInsights,
  ExtendedModelUsage,
} from './types';

// Disk cache
export {
  readDiskCacheAsync,
  writeDiskCache,
  isDiskCacheFresh,
  isDiskCacheStale,
  clearDiskCache,
  getCacheAge,
  type UsageDiskCache,
} from './disk-cache';

// Data aggregator - aggregation functions
export {
  aggregateDailyUsage,
  aggregateHourlyUsage,
  aggregateMonthlyUsage,
  aggregateSessionUsage,
  loadDailyUsageData,
  loadHourlyUsageData,
  loadMonthlyUsageData,
  loadSessionData,
  loadAllUsageData,
} from './data-aggregator';

// Usage aggregator service - caching layer
export {
  getCachedDailyData,
  getCachedMonthlyData,
  getCachedSessionData,
  getCachedHourlyData,
  clearUsageCache,
  prewarmUsageCache,
  getLastFetchTimestamp,
  mergeDailyData,
  mergeMonthlyData,
  mergeHourlyData,
  mergeSessionData,
} from './aggregator';

// Routes
export { usageRoutes } from './routes';

// Handlers (for testing)
export {
  validateDate,
  validateLimit,
  validateOffset,
  filterByDateRange,
  calculateTokenBreakdownCosts,
  fillHourlyGaps,
  detectAnomalies,
  summarizeAnomalies,
  type UsageQuery,
} from './handlers';
