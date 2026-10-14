/**
 * Account query and search operations
 * Finding, filtering, and retrieving account information
 */

import { CLIProxyProvider } from '../types';
import { CLIPROXY_PROFILES } from '../../auth/profile-detector';
import { AccountInfo } from './types';
import { hydrateRegistryFromTokenFiles, loadAccountsRegistry } from './registry';

/**
 * Get all accounts for a provider
 */
export function getProviderAccounts(provider: CLIProxyProvider): AccountInfo[] {
  const registry = loadAccountsRegistry();

  // Hydrate the in-memory view from token files without mutating disk on read.
  hydrateRegistryFromTokenFiles(registry);

  const providerAccounts = registry.providers[provider];

  if (!providerAccounts) {
    return [];
  }

  return Object.entries(providerAccounts.accounts).map(([id, meta]) => ({
    id,
    provider,
    isDefault: id === providerAccounts.default,
    ...meta,
  }));
}

/**
 * Get default account for a provider
 */
export function getDefaultAccount(provider: CLIProxyProvider): AccountInfo | null {
  const accounts = getProviderAccounts(provider);
  return accounts.find((a) => a.isDefault) || accounts[0] || null;
}

/**
 * Get specific account by ID
 */
export function getAccount(provider: CLIProxyProvider, accountId: string): AccountInfo | null {
  const accounts = getProviderAccounts(provider);
  return accounts.find((a) => a.id === accountId) || null;
}

/**
 * Find account by query (nickname, email, or id)
 * Supports partial matching for convenience
 */
export function findAccountByQuery(provider: CLIProxyProvider, query: string): AccountInfo | null {
  const accounts = getProviderAccounts(provider);
  const lowerQuery = query.toLowerCase();

  const exactIdMatch = accounts.find((a) => a.id === query);
  if (exactIdMatch) return exactIdMatch;

  const emailMatches = accounts.filter((a) => a.email?.toLowerCase() === lowerQuery);
  if (emailMatches.length === 1) return emailMatches[0];
  if (emailMatches.length > 1) return null;

  const nicknameMatches = accounts.filter((a) => a.nickname?.toLowerCase() === lowerQuery);
  if (nicknameMatches.length === 1) return nicknameMatches[0];
  if (nicknameMatches.length > 1) return null;

  // Partial match on nickname or email prefix
  const partialMatches = accounts.filter(
    (a) =>
      a.nickname?.toLowerCase().startsWith(lowerQuery) ||
      a.email?.toLowerCase().startsWith(lowerQuery)
  );
  return partialMatches.length === 1 ? partialMatches[0] : null;
}

/**
 * Get non-paused accounts for a provider
 */
export function getActiveAccounts(provider: CLIProxyProvider): AccountInfo[] {
  return getProviderAccounts(provider).filter((a) => !a.paused);
}

/**
 * Check if an account is paused
 */
export function isAccountPaused(provider: CLIProxyProvider, accountId: string): boolean {
  const accounts = getProviderAccounts(provider);
  const account = accounts.find((a) => a.id === accountId);
  return account?.paused ?? false;
}

/**
 * Get summary of all accounts across providers
 *
 * Aggregation cache: every /api/bar/summary request re-read accounts.json and
 * hydrates every token file synchronously; on AV-scanned Windows machines each
 * such read is variably expensive (60ms to seconds) and blocks the event loop,
 * which inflated glance responses past their deadline. Both call sites (bar
 * glance, auth account listing) are display paths tolerant of bounded
 * staleness; mutating routes go through the uncached getProviderAccounts and
 * stay exact-fresh. Cached at build completion so a slow build never returns
 * an already-expired entry.
 */
const SUMMARY_CACHE_TTL_MS = 2500;
let summaryCache: { at: number; value: Record<CLIProxyProvider, AccountInfo[]> } | null = null;

export function getAllAccountsSummary(): Record<CLIProxyProvider, AccountInfo[]> {
  const now = Date.now();
  if (summaryCache && now - summaryCache.at < SUMMARY_CACHE_TTL_MS) {
    return summaryCache.value;
  }
  const providers: CLIProxyProvider[] = [...CLIPROXY_PROFILES];
  const summary: Record<CLIProxyProvider, AccountInfo[]> = {} as Record<
    CLIProxyProvider,
    AccountInfo[]
  >;

  for (const provider of providers) {
    summary[provider] = getProviderAccounts(provider);
  }

  summaryCache = { at: Date.now(), value: summary };
  return summary;
}
