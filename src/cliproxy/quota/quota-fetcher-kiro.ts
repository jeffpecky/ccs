/**
 * Quota Fetcher for Kiro (AWS CodeWhisperer) Accounts
 *
 * Mirrors 9Router's kiro usage flow, all through the CLIProxy management API:
 * - GET https://codewhisperer.us-east-1.amazonaws.com/getUsageLimits
 * - POST x-amz-target GetUsageLimits fallback
 * - GET https://q.us-east-1.amazonaws.com/getUsageLimits fallback
 * - Shared default profileArn when the auth file has none
 */

import * as fs from 'fs';
import * as path from 'path';
import { getProviderAccounts } from '../accounts/account-manager';
import { getAuthDir } from '../config/config-generator';
import {
  callCLIProxyManagementApi,
  CLIProxyManagementUnavailableError,
  resolveCLIProxyAuth,
} from './cli-proxy-auth-resolver';

/** Kiro quota window */
export interface KiroQuotaWindow {
  /** Resource type, e.g., "AGENTIC_REQUEST" */
  resourceType: string;
  /** Total limit */
  total: number;
  /** Current usage */
  used: number;
  /** Remaining quota */
  remaining: number;
  /** Remaining percentage (0-100) */
  remainingPercent: number;
  /** Reset time ISO */
  resetAt: string | null;
  /** Whether quota is unlimited */
  unlimited: boolean;
  /** Free trial info if available */
  freeTrial?: {
    total: number;
    used: number;
    remaining: number;
    remainingPercent: number;
    resetAt: string | null;
  };
}

/** Kiro quota fetch result */
export interface KiroQuotaResult {
  /** Whether fetch succeeded */
  success: boolean;
  /** Plan type */
  planType: string | null;
  /** Quota windows */
  windows: KiroQuotaWindow[];
  /** Timestamp of fetch */
  lastUpdated: number;
  /** Error message if failed */
  error?: string;
  /** Account ID */
  accountId?: string;
  /** Error code for programmatic handling */
  errorCode?: string;
  /** Additional error context */
  errorDetail?: string;
  /** Whether the failure is retryable */
  retryable?: boolean;
  /** Whether CLIProxy's final provider response requires re-authentication */
  needsReauth?: boolean;
}

/** Upstream endpoints (mirrors 9Router kiro registry) */
const CW_HOSTS = [
  'https://codewhisperer.us-east-1.amazonaws.com',
  'https://codewhisperer.us-west-2.amazonaws.com',
] as const;
const Q_HOST = 'https://q.us-east-1.amazonaws.com';
const LIMITS_PATH = '/getUsageLimits';

// Shared default CodeWhisperer profile ARNs (us-east-1), keyed by auth method.
const KIRO_DEFAULT_PROFILE_ARNS = {
  'builder-id': 'arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX',
  social: 'arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK',
};

function resolveDefaultProfileArn(authMethod: string): string {
  const social = authMethod === 'google' || authMethod === 'github';
  return social ? KIRO_DEFAULT_PROFILE_ARNS.social : KIRO_DEFAULT_PROFILE_ARNS['builder-id'];
}

/** Parse reset time from various formats */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResetTime(resetValue: any): string | null {
  if (!resetValue) return null;

  try {
    if (typeof resetValue === 'number') {
      // Epoch milliseconds
      if (resetValue > 1e12) {
        return new Date(resetValue).toISOString();
      }
      // Epoch seconds
      return new Date(resetValue * 1000).toISOString();
    }
    // ISO string
    const date = new Date(resetValue);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  } catch {
    // Fall through
  }
  return null;
}

/**
 * Parse Kiro quota response into structured format
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseKiroQuotaResponse(data: any): KiroQuotaResult {
  const usageList = data.usageBreakdownList || [];
  const windows: KiroQuotaWindow[] = [];
  const resetAt = parseResetTime(data.nextDateReset || data.resetDate);

  for (const breakdown of usageList) {
    const resourceType = breakdown.resourceType || 'unknown';
    const used = breakdown.currentUsageWithPrecision || 0;
    const total = breakdown.usageLimitWithPrecision || 0;
    const remaining = total - used;
    const remainingPercent = total > 0 ? Math.round((remaining / total) * 100) : 0;

    const window: KiroQuotaWindow = {
      resourceType,
      total,
      used,
      remaining,
      remainingPercent,
      resetAt,
      unlimited: false,
    };

    // Add free trial if available
    if (breakdown.freeTrialInfo) {
      const freeUsed = breakdown.freeTrialInfo.currentUsageWithPrecision || 0;
      const freeTotal = breakdown.freeTrialInfo.usageLimitWithPrecision || 0;
      const freeRemaining = freeTotal - freeUsed;
      window.freeTrial = {
        total: freeTotal,
        used: freeUsed,
        remaining: freeRemaining,
        remainingPercent: freeTotal > 0 ? Math.round((freeRemaining / freeTotal) * 100) : 0,
        resetAt: parseResetTime(breakdown.freeTrialInfo.freeTrialExpiry || resetAt),
      };
    }

    windows.push(window);
  }

  return {
    success: true,
    planType: data.subscriptionInfo?.subscriptionTitle || 'Kiro',
    windows,
    lastUpdated: Date.now(),
  };
}

interface CodeWhispererResponse {
  usageBreakdownList?: Array<{
    resourceType: string;
    currentUsageWithPrecision: number;
    usageLimitWithPrecision: number;
    freeTrialInfo?: {
      currentUsageWithPrecision: number;
      usageLimitWithPrecision: number;
      freeTrialExpiry?: number | string;
    };
  }>;
  subscriptionInfo?: {
    subscriptionTitle?: string;
  };
  nextDateReset?: number;
  resetDate?: number;
}

interface UsageFetchResult {
  ok: boolean;
  status: number;
  data?: CodeWhispererResponse;
}

/** Auth-method-specific extra headers (API keys / external IdP tokens) */
function authMethodHeaders(authMethod: string): Record<string, string> {
  if (authMethod === 'api_key') return { tokentype: 'API_KEY' };
  if (authMethod === 'external_idp') return { TokenType: 'EXTERNAL_IDP' };
  return {};
}

/**
 * Read non-secret Kiro auth metadata for request shaping (profile ARN, auth method).
 */
interface KiroAuthMetadata {
  profileArn?: string;
  authMethod?: string;
}

function readKiroAuthMetadata(accountId: string): KiroAuthMetadata | null {
  try {
    const authDir = getAuthDir();
    const files = fs.readdirSync(authDir);

    const kiroFile = files.find(
      (f: string) => f.startsWith('kiro-aws-') && f.includes(accountId) && f.endsWith('.json')
    );
    if (!kiroFile) return null;

    const content = JSON.parse(fs.readFileSync(path.join(authDir, kiroFile), 'utf-8'));
    return {
      profileArn: content.profile_arn,
      authMethod: content.auth_method,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch Kiro quota for an account
 */
export async function fetchKiroQuota(accountId: string, verbose = false): Promise<KiroQuotaResult> {
  if (verbose) console.error(`[i] Fetching Kiro quota for ${accountId}...`);

  // Get account data
  const accounts = getProviderAccounts('kiro');
  const account = accounts.find((a) => a.id === accountId);

  if (!account) {
    return {
      success: false,
      planType: null,
      windows: [],
      lastUpdated: Date.now(),
      error: 'Account not found',
      errorCode: 'account_not_found',
      accountId,
    };
  }

  let managedAuth: Awaited<ReturnType<typeof resolveCLIProxyAuth>>;
  try {
    managedAuth = await resolveCLIProxyAuth('kiro', accountId);
  } catch (error) {
    return {
      success: false,
      planType: null,
      windows: [],
      lastUpdated: Date.now(),
      error: 'CLIProxy is temporarily unavailable',
      errorCode: 'cliproxy_unavailable',
      errorDetail: error instanceof Error ? error.message : undefined,
      retryable: true,
      accountId,
    };
  }

  if (!managedAuth) {
    return {
      success: false,
      planType: null,
      windows: [],
      lastUpdated: Date.now(),
      error: 'Kiro account is not loaded by CLIProxy',
      errorCode: 'managed_auth_missing',
      retryable: false,
      accountId,
    };
  }

  const authMetadata = readKiroAuthMetadata(accountId);
  const authMethod = authMetadata?.authMethod || 'builder-id';
  const profileArn = authMetadata?.profileArn || resolveDefaultProfileArn(authMethod);

  // Run the 9Router endpoint chain (CW GET → CW POST → Q GET) through CLIProxy
  // management API with $TOKEN$ substitution — CLIProxy checks refresh
  // eligibility and retries once on final 401/403.
  const runManagedChain = async (): Promise<UsageFetchResult> => {
    const extraHeaders = authMethodHeaders(authMethod);
    const getUsageParams = new URLSearchParams({
      isEmailRequired: 'true',
      origin: 'AI_EDITOR',
      resourceType: 'AGENTIC_REQUEST',
    });
    const qParams = new URLSearchParams({
      origin: 'AI_EDITOR',
      ...(profileArn ? { profileArn } : {}),
      resourceType: 'AGENTIC_REQUEST',
    });

    const baseHeaders: Record<string, string> = {
      Accept: 'application/json',
      'x-amz-user-agent': 'aws-sdk-js/1.0.0 KiroIDE',
      'user-agent': 'aws-sdk-js/1.0.0 KiroIDE',
      ...extraHeaders,
    };

    const attempts: Array<{ name: string; run: () => Promise<Response> }> = [
      ...CW_HOSTS.map((host) => ({
        name: `cw-get:${host}`,
        run: () =>
          callCLIProxyManagementApi(managedAuth.authIndex, {
            method: 'GET',
            url: `${host}${LIMITS_PATH}?${getUsageParams.toString()}`,
            header: { ...baseHeaders, Authorization: 'Bearer $TOKEN$' },
          }),
      })),
      ...CW_HOSTS.map((host) => ({
        name: `cw-post:${host}`,
        run: () =>
          callCLIProxyManagementApi(managedAuth.authIndex, {
            method: 'POST',
            url: host,
            header: {
              Authorization: 'Bearer $TOKEN$',
              'Content-Type': 'application/x-amz-json-1.0',
              'x-amz-target': 'AmazonCodeWhispererService.GetUsageLimits',
              Accept: 'application/json',
              ...extraHeaders,
            },
            data: JSON.stringify({
              origin: 'AI_EDITOR',
              ...(profileArn ? { profileArn } : {}),
              resourceType: 'AGENTIC_REQUEST',
            }),
          }),
      })),
      {
        name: 'q-get',
        run: () =>
          callCLIProxyManagementApi(managedAuth.authIndex, {
            method: 'GET',
            url: `${Q_HOST}${LIMITS_PATH}?${qParams.toString()}`,
            header: { ...baseHeaders, Authorization: 'Bearer $TOKEN$' },
          }),
      },
    ];

    let lastStatus = 0;
    for (const attempt of attempts) {
      // A management outage propagates immediately; only real provider
      // responses move the chain to the next endpoint.
      const response = await attempt.run();
      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          data: (await response.json()) as CodeWhispererResponse,
        };
      }
      lastStatus = response.status;
    }
    return { ok: false, status: lastStatus };
  };

  try {
    const result = await runManagedChain();

    if (!result.ok || !result.data) {
      const needsReauth = result.status === 401 || result.status === 403;
      return {
        success: false,
        planType: null,
        windows: [],
        lastUpdated: Date.now(),
        error: needsReauth
          ? 'Authentication expired or invalid'
          : `Kiro quota API rejected the request (status ${result.status || 'unknown'})`,
        errorCode: needsReauth ? 'reauth_required' : 'fetch_failed',
        retryable: false,
        needsReauth,
        accountId,
      };
    }

    const parsed = parseKiroQuotaResponse(result.data);
    parsed.accountId = accountId;

    if (verbose) console.error(`[i] Kiro quota fetched: ${parsed.windows.length} windows`);
    return parsed;
  } catch (error) {
    if (error instanceof CLIProxyManagementUnavailableError) {
      if (verbose) console.error('[!] CLIProxy management API unavailable during Kiro fetch');
      return {
        success: false,
        planType: null,
        windows: [],
        lastUpdated: Date.now(),
        error: 'CLIProxy is temporarily unavailable',
        errorCode: 'cliproxy_unavailable',
        errorDetail: error.message,
        retryable: true,
        accountId,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (verbose) console.error(`[!] Kiro quota fetch failed: ${message}`);
    return {
      success: false,
      planType: null,
      windows: [],
      lastUpdated: Date.now(),
      error: message,
      errorCode: 'fetch_failed',
      accountId,
    };
  }
}

/**
 * Calculate minimum remaining percentage across all kiro windows
 */
export function calculateKiroMinQuotaPercent(quota: KiroQuotaResult): number | null {
  if (!quota.success || quota.windows.length === 0) return null;

  const percentages = quota.windows
    .map((w) => w.remainingPercent)
    .filter((p) => Number.isFinite(p));

  return percentages.length > 0 ? Math.min(...percentages) : null;
}
