export const LOCALE_STORAGE_KEY = 'ccs-ui-locale';

export const SUPPORTED_LOCALES = ['en'] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export function isSupportedLocale(locale: string): locale is AppLocale {
  return SUPPORTED_LOCALES.includes(locale as AppLocale);
}

export function normalizeLocale(_locale: string | null | undefined): AppLocale {
  return 'en';
}

export function getStoredLocale(): AppLocale | null {
  return 'en';
}

export function getInitialLocale(): AppLocale {
  return 'en';
}

export function getFormattingLocale(_locale?: string): string {
  return 'en';
}

export function persistLocale(_locale: string): AppLocale {
  return 'en';
}

