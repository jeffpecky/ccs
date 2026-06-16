/**
 * Shared Gemini preview aliases for minor-version rollouts.
 * Keep CLIProxy backend and dashboard model resolution on the same compatibility pairs.
 */
export const GEMINI_MINOR_VERSION_COMPATIBILITY_IDS = Object.freeze({
  'gemini-3-pro-preview': 'gemini-3.1-pro-preview',
  'gemini-3.1-pro-preview': 'gemini-3-pro-preview',
  'gemini-3-flash-preview': 'gemini-3.1-flash-preview',
  'gemini-3.1-flash-preview': 'gemini-3-flash-preview',
});
