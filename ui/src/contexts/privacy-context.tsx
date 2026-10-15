/**
 * Privacy Context - Global demo mode for censoring personal information
 * Provides blur effect on emails, account IDs, and other PII
 * Persists state to localStorage
 */

/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  type ReactNode,
} from 'react';

interface PrivacyContextValue {
  /** Whether privacy/demo mode is enabled */
  privacyMode: boolean;
  /** Toggle privacy mode on/off */
  togglePrivacyMode: () => void;
}

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

const STORAGE_KEY = 'ccs-privacy-mode';

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const [privacyMode, setPrivacyMode] = useState(() => {
    // Initialize from localStorage
    if (typeof window !== 'undefined') {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    }
    return false;
  });

  // Persist to localStorage when changed
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(privacyMode));
  }, [privacyMode]);

  const togglePrivacyMode = useCallback(() => setPrivacyMode((prev) => !prev), []);

  const value = useMemo(
    () => ({ privacyMode, togglePrivacyMode }),
    [privacyMode, togglePrivacyMode]
  );

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy() {
  const context = useContext(PrivacyContext);
  if (!context) {
    throw new Error('usePrivacy must be used within a PrivacyProvider');
  }
  return context;
}

/** CSS class for blurring sensitive content */
export const PRIVACY_BLUR_CLASS =
  'blur-[4px] select-none hover:blur-none transition-all duration-200';
