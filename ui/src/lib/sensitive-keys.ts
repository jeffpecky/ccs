/**
 * Sensitive Key Detection Utilities (UI)
 *
 * Re-exports from main package for use in UI components.
 * Patterns detect API keys, tokens, passwords, etc.
 */

/**
 * Patterns that match sensitive keys (API keys, tokens, passwords).
 * More specific than substring matching to avoid false positives.
 */
export const SENSITIVE_KEY_PATTERNS = [
  /^ANTHROPIC_API_KEY$/, // Exact match for Anthropic auth token
  /_API_KEY$/, // Keys ending with _API_KEY
  /_AUTH_TOKEN$/, // Keys ending with _AUTH_TOKEN
  /_SECRET$/, // Keys ending with _SECRET
  /_SECRET_KEY$/, // Keys ending with _SECRET_KEY
  /^API_KEY$/, // Exact match for API_KEY
  /^AUTH_TOKEN$/, // Exact match for AUTH_TOKEN
  /^SECRET$/, // Exact match for SECRET
  /_PASSWORD$/, // Keys ending with _PASSWORD
  /^PASSWORD$/, // Exact match for PASSWORD
  /_CREDENTIAL$/, // Keys ending with _CREDENTIAL
  /_PRIVATE_KEY$/, // Keys ending with _PRIVATE_KEY
];

/**
 * Check if a key name contains a secret/sensitive value.
 *
 * @param key - Environment variable key name
 * @returns true if the key likely contains sensitive data
 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

