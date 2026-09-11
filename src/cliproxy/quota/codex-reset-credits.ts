const CODEX_RESET_CREDITS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
const CODEX_RESET_CREDITS_CONSUME_URL = `${CODEX_RESET_CREDITS_URL}/consume`;

type FetchLike = typeof fetch;

export interface CodexResetCredit {
  id: string | null;
  expiresAt: string | null;
}

export interface CodexResetCreditsResult {
  availableCount: number;
  credits: CodexResetCredit[];
  raw: unknown;
}

export interface CodexResetConsumeResult {
  ok: boolean;
  noCredit: boolean;
  status: number;
  code: string | null;
  windowsReset: number;
  message: string | null;
  raw: unknown;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

export async function fetchCodexResetCredits(
  accessToken: string,
  fetcher: FetchLike = fetch
): Promise<CodexResetCreditsResult> {
  const response = await fetcher(CODEX_RESET_CREDITS_URL, { headers: authHeaders(accessToken) });
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(`Failed to fetch Codex reset credits: HTTP ${response.status}`);
  }

  const root = asObject(data);
  const creditsRaw = Array.isArray(root.credits) ? root.credits : [];
  const credits = creditsRaw.map((credit) => {
    const item = asObject(credit);
    return {
      id: typeof item.id === 'string' ? item.id : null,
      expiresAt: typeof item.expires_at === 'string' ? item.expires_at : null,
    };
  });
  const availableCount = Math.max(
    0,
    toFiniteNumber(root.available_count ?? root.availableCount, credits.length)
  );

  return { availableCount, credits, raw: data };
}

export async function consumeCodexResetCredit(
  accessToken: string,
  redeemRequestId: string,
  fetcher: FetchLike = fetch
): Promise<CodexResetConsumeResult> {
  const response = await fetcher(CODEX_RESET_CREDITS_CONSUME_URL, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify({ redeem_request_id: redeemRequestId }),
  });
  const data = await readJson(response);
  const root = asObject(data);
  const code = typeof root.code === 'string' ? root.code : null;
  const windowsReset = Math.max(0, toFiniteNumber(root.windows_reset ?? root.windowsReset));

  return {
    ok: response.ok && (code === 'reset' || windowsReset > 0),
    noCredit: response.ok && code === 'no_credit',
    status: response.status,
    code,
    windowsReset,
    message: typeof root.message === 'string' ? root.message : null,
    raw: data,
  };
}
