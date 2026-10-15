/**
 * Settings Provider Component
 * React component that provides settings context
 */

import { useReducer, type ReactNode } from 'react';
import { SettingsContext, settingsReducer, initialSettingsState } from './settings-context';

interface SettingsProviderProps {
  children: ReactNode;
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  const [state, dispatch] = useReducer(settingsReducer, initialSettingsState);

  return (
    <SettingsContext.Provider value={{ state, dispatch }}>{children}</SettingsContext.Provider>
  );
}
