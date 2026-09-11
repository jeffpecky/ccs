import {
  getProxyTarget,
  buildProxyUrl,
  buildManagementHeaders,
} from '../proxy/proxy-target-resolver';

const MANAGEMENT_API_TIMEOUT_MS = 5000;

export class CLIProxyManagementUnavailableError extends Error {
  constructor(message = 'CLIProxy management API is temporarily unavailable') {
    super(message);
    this.name = 'CLIProxyManagementUnavailableError';
  }
}

interface CLIProxyAuthFile {
  id?: string;
  auth_index?: string | number;
  provider?: string;
  email?: string;
  account?: string;
}

export interface CLIProxyAuthReference {
  authIndex: string | number;
  id: string;
  provider: string;
  email?: string;
  account?: string;
}

export interface CLIProxyManagementApiCall {
  method: string;
  url: string;
  header?: Record<string, string>;
  data?: string;
}

interface CLIProxyManagementApiResponse {
  status_code?: number;
  header?: Record<string, string | string[]>;
  body?: string;
}

function normalizeProvider(provider: string): string {
  switch (provider.trim().toLowerCase()) {
    case 'anthropic':
      return 'claude';
    case 'openai':
      return 'codex';
    case 'ghcp':
    case 'github_copilot':
      return 'github-copilot';
    default:
      return provider.trim().toLowerCase();
  }
}

function matchesAccount(file: CLIProxyAuthFile, accountId: string): boolean {
  const expected = accountId.trim().toLowerCase();
  return [file.id, file.email, file.account].some(
    (value) => typeof value === 'string' && value.trim().toLowerCase() === expected
  );
}

export async function resolveCLIProxyAuth(
  provider: string,
  accountId: string
): Promise<CLIProxyAuthReference | null> {
  const target = getProxyTarget();

  try {
    const response = await fetch(buildProxyUrl(target, '/v0/management/auth-files'), {
      headers: buildManagementHeaders(target),
      signal: AbortSignal.timeout(MANAGEMENT_API_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new CLIProxyManagementUnavailableError(
        `CLIProxy auth lookup failed with status ${response.status}`
      );
    }

    const data = (await response.json()) as { files?: CLIProxyAuthFile[] };
    if (!Array.isArray(data.files)) {
      throw new CLIProxyManagementUnavailableError('CLIProxy auth lookup returned invalid data');
    }

    const normalizedProvider = normalizeProvider(provider);
    const match = data.files.find(
      (file) =>
        normalizeProvider(file.provider ?? '') === normalizedProvider &&
        matchesAccount(file, accountId)
    );
    if (!match || match.auth_index === undefined || match.auth_index === null) return null;

    return {
      authIndex: match.auth_index,
      id: match.id ?? accountId,
      provider: match.provider ?? provider,
      ...(match.email ? { email: match.email } : {}),
      ...(match.account ? { account: match.account } : {}),
    };
  } catch (error) {
    if (error instanceof CLIProxyManagementUnavailableError) throw error;
    throw new CLIProxyManagementUnavailableError();
  }
}

export async function callCLIProxyManagementApi(
  authIndex: string | number,
  call: CLIProxyManagementApiCall
): Promise<Response> {
  const target = getProxyTarget();

  try {
    const response = await fetch(buildProxyUrl(target, '/v0/management/api-call'), {
      method: 'POST',
      headers: buildManagementHeaders(target, { 'Content-Type': 'application/json' }),
      signal: AbortSignal.timeout(MANAGEMENT_API_TIMEOUT_MS),
      body: JSON.stringify({ auth_index: authIndex, ...call }),
    });
    if (!response.ok) {
      throw new CLIProxyManagementUnavailableError(
        `CLIProxy API call failed with status ${response.status}`
      );
    }

    const result = (await response.json()) as CLIProxyManagementApiResponse;
    const status = result.status_code;
    if (!Number.isInteger(status) || status === undefined || status < 200 || status > 599) {
      throw new CLIProxyManagementUnavailableError('CLIProxy API call returned invalid data');
    }

    const headers = new Headers();
    for (const [name, value] of Object.entries(result.header ?? {})) {
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }

    const body = status === 204 || status === 205 || status === 304 ? null : (result.body ?? '');
    return new Response(body, { status, headers });
  } catch (error) {
    if (error instanceof CLIProxyManagementUnavailableError) throw error;
    throw new CLIProxyManagementUnavailableError();
  }
}

/**
 * Helper to call a provider quota API through CLIProxy management API with $TOKEN$ substitution.
 * The caller provides the auth reference and the quota endpoint URL.
 * Returns the Response from the upstream provider (not the management API wrapper).
 */
export async function callProviderQuotaApi(
  authRef: CLIProxyAuthReference,
  url: string,
  extraHeaders?: Record<string, string>
): Promise<Response> {
  const headers: Record<string, string> = {
    'User-Agent': extraHeaders?.['User-Agent'] ?? 'CLIProxyAPIPlus',
    Accept: 'application/json',
    ...extraHeaders,
  };

  // CLIProxy replaces caller-provided $TOKEN$ placeholders before sending upstream.
  if (extraHeaders?.Authorization && extraHeaders.Authorization.includes('$TOKEN$')) {
    headers.Authorization = extraHeaders.Authorization;
  }

  return callCLIProxyManagementApi(authRef.authIndex, {
    method: 'GET',
    url,
    header: headers,
  });
}
