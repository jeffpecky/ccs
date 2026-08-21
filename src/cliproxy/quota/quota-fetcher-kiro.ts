/**
 * Quota Fetcher for Kiro (AWS CodeWhisperer) Accounts
 *
 * Mirrors 9Router's kiro usage flow:
 * - GET https://codewhisperer.us-east-1.amazonaws.com/getUsageLimits
 * - POST x-amz-target GetUsageLimits fallback
 * - GET https://q.us-east-1.amazonaws.com/getUsageLimits fallback
 * - Shared default profileArn when the auth file has none
 * - Token refresh (AWS OIDC / kiro.dev) with persistence back to the auth file
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getProviderAccounts } from '../accounts/account-manager';

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
}

/** Upstream endpoints (mirrors 9Router kiro registry) */
const CW_HOSTS = [
  'https://codewhisperer.us-east-1.amazonaws.com',
  'https://codewhisperer.us-west-2.amazonaws.com',
] as const;
const Q_HOST = 'https://q.us-east-1.amazonaws.com';
const LIMITS_PATH = '/getUsageLimits';
const OIDC_TOKEN_URL = 'https://oidc.us-east-1.amazonaws.com/token';
const KIRO_SOCIAL_REFRESH_URL = 'https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken';

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
 * Fetch usage limits trying the same endpoint chain as 9Router:
 * CW GET → CW POST → Q GET. Returns the first successful JSON body.
 */
async function fetchFromCodeWhisperer(
  accessToken: string,
  profileArn: string,
  authMethod: string
): Promise<UsageFetchResult> {
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

  const attempts: Array<{ name: string; run: () => Promise<Response> }> = [
    ...CW_HOSTS.map((host) => ({
      name: `cw-get:${host}`,
      run: () =>
        fetch(`${host}${LIMITS_PATH}?${getUsageParams.toString()}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            'x-amz-user-agent': 'aws-sdk-js/1.0.0 KiroIDE',
            'user-agent': 'aws-sdk-js/1.0.0 KiroIDE',
            ...extraHeaders,
          },
        }),
    })),
    ...CW_HOSTS.map((host) => ({
      name: `cw-post:${host}`,
      run: () =>
        fetch(host, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/x-amz-json-1.0',
            'x-amz-target': 'AmazonCodeWhispererService.GetUsageLimits',
            Accept: 'application/json',
            ...extraHeaders,
          },
          body: JSON.stringify({
            origin: 'AI_EDITOR',
            ...(profileArn ? { profileArn } : {}),
            resourceType: 'AGENTIC_REQUEST',
          }),
        }),
    })),
    {
      name: 'q-get',
      run: () =>
        fetch(`${Q_HOST}${LIMITS_PATH}?${qParams.toString()}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            ...extraHeaders,
          },
        }),
    },
  ];

  let lastStatus = 0;
  for (const attempt of attempts) {
    try {
      const response = await attempt.run();
      if (response.ok) {
        return { ok: true, status: response.status, data: (await response.json()) as CodeWhispererResponse };
      }
      lastStatus = response.status;
    } catch {
      // Continue to next attempt
    }
  }

  return { ok: false, status: lastStatus };
}

/** Auth data read from a kiro token file */
interface KiroAuthData {
  accessToken: string;
  refreshToken?: string;
  profileArn?: string;
  authMethod?: string;
  expiresAt?: string;
  clientId?: string;
  clientSecret?: string;
  region?: string;
  filePath: string;
}

/** Refreshed token payload persisted back to the auth file */
interface RefreshedToken {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

/**
 * Refresh a Kiro access token.
 * - builder-id/idc (client_id + client_secret): AWS OIDC refresh_token grant
 * - social (google/github): kiro.dev refreshToken endpoint
 */
async function refreshKiroAccessToken(auth: KiroAuthData): Promise<RefreshedToken | null> {
  if (!auth.refreshToken) return null;

  try {
    let response: Response;
    if (auth.clientId && auth.clientSecret) {
      const endpoint =
        auth.authMethod === 'idc' && auth.region
          ? `https://oidc.${auth.region}.amazonaws.com/token`
          : OIDC_TOKEN_URL;
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          clientId: auth.clientId,
          clientSecret: auth.clientSecret,
          refreshToken: auth.refreshToken,
          grantType: 'refresh_token',
        }),
      });
    } else {
      response = await fetch(KIRO_SOCIAL_REFRESH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'kiro-cli/1.0.0' },
        body: JSON.stringify({ refreshToken: auth.refreshToken }),
      });
    }

    if (!response.ok) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tokens: any = await response.json();
    const accessToken = tokens.accessToken || tokens.access_token;
    if (!accessToken) return null;

    return {
      accessToken,
      refreshToken: tokens.refreshToken || tokens.refresh_token || auth.refreshToken,
      expiresIn: tokens.expiresIn || tokens.expires_in,
    };
  } catch {
    return null;
  }
}

/** Persist refreshed tokens back to the auth file so subsequent calls reuse them */
function persistRefreshedToken(filePath: string, refreshed: RefreshedToken): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    content.access_token = refreshed.accessToken;
    if (refreshed.refreshToken) content.refresh_token = refreshed.refreshToken;
    if (refreshed.expiresIn) {
      content.expires_at = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();
      content.last_refresh = new Date().toISOString();
    }
    content.expired = false;
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
  } catch {
    // Non-fatal: quota fetch can still proceed with the in-memory token
  }
}

/** Whether the stored access token is expired (or expiring within 60s) */
function isTokenExpired(auth: KiroAuthData): boolean {
  if (!auth.expiresAt) return false;
  const expiresAt = new Date(auth.expiresAt).getTime();
  if (isNaN(expiresAt)) return false;
  return Date.now() >= expiresAt - 60_000;
}

/**
 * Fetch Kiro quota for an account
 */
export async function fetchKiroQuota(
  accountId: string,
  verbose = false
): Promise<KiroQuotaResult> {
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

  // Read auth data from auth file
  const authData = readKiroAuthData(accountId);
  if (!authData) {
    return {
      success: false,
      planType: null,
      windows: [],
      lastUpdated: Date.now(),
      error: 'Auth file not found',
      errorCode: 'auth_file_missing',
      accountId,
    };
  }

  // Refresh proactively when the stored token is expired/near-expiry
  let accessToken = authData.accessToken;
  if (isTokenExpired(authData)) {
    const refreshed = await refreshKiroAccessToken(authData);
    if (refreshed) {
      accessToken = refreshed.accessToken;
      persistRefreshedToken(authData.filePath, refreshed);
      if (verbose) console.error('[i] Kiro token refreshed proactively');
    }
  }

  const authMethod = authData.authMethod || 'builder-id';
  const profileArn = authData.profileArn || resolveDefaultProfileArn(authMethod);

  try {
    let result = await fetchFromCodeWhisperer(accessToken, profileArn, authMethod);

    // On auth rejection refresh once and retry
    if (!result.ok && (result.status === 401 || result.status === 403)) {
      const refreshed = await refreshKiroAccessToken(authData);
      if (refreshed) {
        accessToken = refreshed.accessToken;
        persistRefreshedToken(authData.filePath, refreshed);
        if (verbose) console.error('[i] Kiro token refreshed after auth error');
        result = await fetchFromCodeWhisperer(accessToken, profileArn, authMethod);
      }
    }

    if (!result.ok || !result.data) {
      return {
        success: false,
        planType: null,
        windows: [],
        lastUpdated: Date.now(),
        error: `Kiro quota API rejected the request (status ${result.status || 'unknown'})`,
        errorCode: 'fetch_failed',
        accountId,
      };
    }

    const parsed = parseKiroQuotaResponse(result.data);
    parsed.accountId = accountId;

    if (verbose) console.error(`[i] Kiro quota fetched: ${parsed.windows.length} windows`);
    return parsed;
  } catch (error) {
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
 * Read Kiro auth data from auth file
 */
function readKiroAuthData(accountId: string): KiroAuthData | null {
  try {
    const authDir = path.join(os.homedir(), '.ccs', 'cliproxy', 'auth');
    const files = fs.readdirSync(authDir);

    // Find kiro auth file for this account
    const kiroFile = files.find(
      (f: string) => f.startsWith('kiro-aws-') && f.includes(accountId) && f.endsWith('.json')
    );

    if (!kiroFile) return null;

    const filePath = path.join(authDir, kiroFile);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    return {
      accessToken: content.access_token,
      refreshToken: content.refresh_token,
      profileArn: content.profile_arn,
      authMethod: content.auth_method,
      expiresAt: content.expires_at,
      clientId: content.client_id,
      clientSecret: content.client_secret,
      region: content.region,
      filePath,
    };
  } catch {
    return null;
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
