/**
 * sensitive-label - Heuristic for detecting field labels that hold credentials
 * or other secret-like values (per design-system.md §5g).
 *
 * Goal: catch the names secret-rotation tooling, OAuth flows, and cloud SDKs
 * conventionally use. Anything matched here renders with the §5g treatment
 * (lock + sensitive pill + masked input + reveal toggle) without the caller
 * needing to set `sensitive` manually.
 *
 * The regex is intentionally permissive — false positives (e.g. a "PASSWORD
 * STRENGTH" UI label that's not actually a credential) are recoverable
 * (caller can pass `sensitive={false}` explicitly), whereas false negatives
 * (a real credential rendered in plaintext) are a real leakage risk.
 */

const SENSITIVE_LABEL_PATTERN =
  /(AUTH|ACCESS|BEARER|REFRESH|ID)[_-]?TOKEN|API[_-]?(KEY|TOKEN|SECRET)|CLIENT[_-]?(ID|SECRET)|(AWS|GCP|AZURE|GITHUB|GITLAB|OPENAI|ANTHROPIC|GEMINI)[_-]?(ACCESS[_-]?KEY|SECRET[_-]?(KEY|ACCESS[_-]?KEY)|TOKEN|PAT|API[_-]?KEY)|PRIVATE[_-]?KEY|SECRET[_-]?(KEY|ACCESS[_-]?KEY)?|PASSWORD|PASSPHRASE|SSH[_-]?KEY|JWT|OAUTH|CREDENTIAL|\bPAT\b|\bSECRET\b|\bSECRETS\b|SERVICE[_-]?ACCOUNT|WEBHOOK[_-]?SECRET|HMAC[_-]?KEY|SIGNING[_-]?(KEY|SECRET)/i;

/**
 * Returns true if a field label looks like it holds a credential or secret.
 * Match is case-insensitive and tolerates `_` / `-` separators.
 *
 * Matches include: AUTH_TOKEN, ACCESS_TOKEN, REFRESH_TOKEN, BEARER_TOKEN,
 * API_KEY, API_TOKEN, API_SECRET, CLIENT_ID, CLIENT_SECRET, AWS_ACCESS_KEY_ID,
 * AWS_SECRET_ACCESS_KEY, GCP_SERVICE_ACCOUNT_KEY, AZURE_CLIENT_SECRET,
 * GITHUB_TOKEN, GITLAB_TOKEN, OPENAI_API_KEY, ANTHROPIC_API_KEY,
 * PRIVATE_KEY, SSH_KEY, JWT, OAUTH, CREDENTIAL, PAT, PASSWORD, PASSPHRASE,
 * WEBHOOK_SECRET, HMAC_KEY, SIGNING_KEY.
 *
 * Does NOT match: USERNAME, EMAIL, USER_ID (identifier, not credential),
 * SESSION_ID (not a long-lived credential), or unrelated field names.
 */
export function isSensitiveLabel(label: string): boolean {
  return SENSITIVE_LABEL_PATTERN.test(label);
}

