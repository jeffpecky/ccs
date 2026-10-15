export const AGY_GEMINI_PRO_HIGH_ID = 'gemini-3.1-pro-high';
export const AGY_GEMINI_PRO_LOW_ID = 'gemini-3.1-pro-low';

export const AGY_GEMINI_PRO_COMPATIBILITY_IDS = Object.freeze({
  'gemini-3-pro-high': AGY_GEMINI_PRO_HIGH_ID,
  'gemini-3.1-pro-high': AGY_GEMINI_PRO_HIGH_ID,
  'gemini-3-pro-low': AGY_GEMINI_PRO_LOW_ID,
  'gemini-3.1-pro-low': AGY_GEMINI_PRO_LOW_ID,
  'gemini-3-pro-preview': AGY_GEMINI_PRO_HIGH_ID,
  'gemini-3-pro-preview-customtools': AGY_GEMINI_PRO_HIGH_ID,
  'gemini-3.1-pro-preview': AGY_GEMINI_PRO_HIGH_ID,
  'gemini-3.1-pro-preview-customtools': AGY_GEMINI_PRO_HIGH_ID,
  'gemini-3-1-pro-preview': AGY_GEMINI_PRO_HIGH_ID,
  'gemini-3-1-pro-preview-customtools': AGY_GEMINI_PRO_HIGH_ID,
} satisfies Record<string, string>);
