/**
 * Pure helpers shared between the provider entry dialog and its tests.
 *
 * Kept out of provider-entry-dialog.tsx so that file exports only its
 * component (react-refresh/only-export-components).
 */

export function getProviderTestApiKey(
  supportsOpenAiCompat: boolean,
  apiKey: string,
  apiKeys: string
): string {
  return supportsOpenAiCompat ? parseDelimitedLines(apiKeys)[0] || '' : apiKey.trim();
}

export function parseDelimitedLines(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
