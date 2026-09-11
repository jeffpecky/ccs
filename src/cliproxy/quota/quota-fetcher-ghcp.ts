/**
 * Quota Fetcher for GitHub Copilot OAuth (ghcp) Accounts
 *
 * Fetches quota information from GitHub `/copilot_internal/user` endpoint
 * using the account token managed by CLIProxy auth flow.
 */

import { getProviderAccounts } from '../accounts/account-manager';
import type { GhcpQuotaResult, GhcpQuotaSnapshot } from './quota-types';
import { clampPercent } from '../../utils/percentage';
import {
  callProviderQuotaApi,
  CLIProxyManagementUnavailableError,
  resolveCLIProxyAuth,
} from './cli-proxy-auth-resolver';

const GHCP_USAGE_URL = 'https://api.github.com/copilot_internal/user';
/**
 * Mirrors headers currently accepted by GitHub Copilot internal usage endpoint.
 * Keep aligned with upstream Copilot client/API changes when quota calls break.
 */
const GHCP_USER_AGENT = 'GitHubCopilotChat/0.26.7';
const GHCP_API_VERSION = '2025-04-01';

interface RawGhcpQuotaSnapshot {
  entitlement?: number;
  overage_count?: number;
  overage_permitted?: boolean;
  percent_remaining?: number;
  quota_id?: string;
  quota_remaining?: number;
  remaining?: number;
  unlimited?: boolean;
}

interface RawGhcpUsageResponse {
  copilot_plan?: string;
  quota_reset_date?: string;
  quota_snapshots?: {
    premium_interactions?: RawGhcpQuotaSnapshot;
    chat?: RawGhcpQuotaSnapshot;
    completions?: RawGhcpQuotaSnapshot;
  };
}

function normalizeSnapshot(raw?: RawGhcpQuotaSnapshot): GhcpQuotaSnapshot {
  const unlimited = Boolean(raw?.unlimited);
  const hasPercentSignal =
    typeof raw?.percent_remaining === 'number' && Number.isFinite(raw.percent_remaining);
  const rawRemaining = typeof raw?.remaining === 'number' ? raw.remaining : raw?.quota_remaining;
  const hasEntitlementRemainingSignal =
    typeof raw?.entitlement === 'number' &&
    Number.isFinite(raw.entitlement) &&
    raw.entitlement > 0 &&
    typeof rawRemaining === 'number' &&
    Number.isFinite(rawRemaining);
  const reported =
    raw !== undefined && (unlimited || hasPercentSignal || hasEntitlementRemainingSignal);
  const entitlement = Number(raw?.entitlement ?? 0);
  const remainingRaw = rawRemaining ?? 0;
  const remaining = Number(remainingRaw);
  const safeEntitlement = Number.isFinite(entitlement) ? Math.max(0, entitlement) : 0;
  const safeRemaining = Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
  const used = Math.max(0, safeEntitlement - safeRemaining);

  const percentRemaining = unlimited
    ? 100
    : hasPercentSignal
      ? clampPercent(raw.percent_remaining as number)
      : reported && safeEntitlement > 0
        ? clampPercent((safeRemaining / safeEntitlement) * 100)
        : 0;

  return {
    reported,
    entitlement: safeEntitlement,
    remaining: safeRemaining,
    used,
    percentRemaining,
    percentUsed: clampPercent(100 - percentRemaining),
    unlimited,
    overageCount:
      typeof raw?.overage_count === 'number' && Number.isFinite(raw.overage_count)
        ? Math.max(0, raw.overage_count)
        : 0,
    overagePermitted: Boolean(raw?.overage_permitted),
    quotaId: raw?.quota_id || null,
  };
}

function buildEmptyQuotaResult(error: string, accountId?: string): GhcpQuotaResult {
  return {
    success: false,
    planType: null,
    quotaResetDate: null,
    snapshots: {
      premiumInteractions: normalizeSnapshot(),
      chat: normalizeSnapshot(),
      completions: normalizeSnapshot(),
    },
    lastUpdated: Date.now(),
    error,
    accountId,
  };
}

function normalizeUsageResponse(raw: RawGhcpUsageResponse): GhcpQuotaResult {
  const snapshots = raw.quota_snapshots || {};
  return {
    success: true,
    planType: raw.copilot_plan ?? null,
    quotaResetDate: raw.quota_reset_date ?? null,
    snapshots: {
      premiumInteractions: normalizeSnapshot(snapshots.premium_interactions),
      chat: normalizeSnapshot(snapshots.chat),
      completions: normalizeSnapshot(snapshots.completions),
    },
    lastUpdated: Date.now(),
  };
}

/**
 * Fetch quota for one ghcp account.
 */
export async function fetchGhcpQuota(accountId: string, verbose = false): Promise<GhcpQuotaResult> {
  if (verbose) console.error(`[i] Fetching ghcp quota for ${accountId}...`);

  let managedAuth: Awaited<ReturnType<typeof resolveCLIProxyAuth>>;
  try {
    managedAuth = await resolveCLIProxyAuth('github-copilot', accountId);
  } catch (error) {
    return {
      ...buildEmptyQuotaResult('CLIProxy is temporarily unavailable', accountId),
      errorCode: 'cliproxy_unavailable',
      errorDetail: error instanceof Error ? error.message : undefined,
      retryable: true,
    };
  }

  if (!managedAuth) {
    return {
      ...buildEmptyQuotaResult('GitHub Copilot account is not loaded by CLIProxy', accountId),
      errorCode: 'managed_auth_missing',
    };
  }

  try {
    const response = await callProviderQuotaApi(managedAuth, GHCP_USAGE_URL, {
      Accept: 'application/json',
      Authorization: 'token $TOKEN$',
      'User-Agent': GHCP_USER_AGENT,
      'x-github-api-version': GHCP_API_VERSION,
    });

    if (response.status === 401 || response.status === 403) {
      return {
        ...buildEmptyQuotaResult('Authentication expired or invalid', accountId),
        needsReauth: true,
      };
    }

    if (response.status === 429) {
      return buildEmptyQuotaResult('Rate limited - try again later', accountId);
    }

    if (!response.ok) {
      return buildEmptyQuotaResult(`GitHub API error: ${response.status}`, accountId);
    }

    const data = (await response.json()) as RawGhcpUsageResponse;
    return {
      ...normalizeUsageResponse(data),
      accountId,
    };
  } catch (error) {
    if (error instanceof CLIProxyManagementUnavailableError) {
      return {
        ...buildEmptyQuotaResult('CLIProxy is temporarily unavailable', accountId),
        errorCode: 'cliproxy_unavailable',
        errorDetail: error.message,
        retryable: true,
      };
    }
    return buildEmptyQuotaResult(
      error instanceof Error ? error.message : 'Unknown error',
      accountId
    );
  }
}

/**
 * Fetch quota for all ghcp accounts.
 */
export async function fetchAllGhcpQuotas(
  verbose = false
): Promise<{ account: string; quota: GhcpQuotaResult }[]> {
  const accounts = getProviderAccounts('ghcp');
  const results = await Promise.all(
    accounts.map(async (account) => ({
      account: account.id,
      quota: await fetchGhcpQuota(account.id, verbose),
    }))
  );
  return results;
}

// Export for testing
export { normalizeSnapshot as normalizeGhcpSnapshot };
