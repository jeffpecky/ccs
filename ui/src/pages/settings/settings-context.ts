/**
 * Settings Context Definition
 * Context and types for settings page state management
 */

import { createContext, type Dispatch } from 'react';
import type {
  GlobalEnvConfig,
  CliproxyServerConfig,
  RemoteProxyStatus,
} from './types';

// === State ===

export interface SettingsState {
  // GlobalEnv state
  globalEnvConfig: GlobalEnvConfig | null;
  globalEnvLoading: boolean;
  globalEnvSaving: boolean;
  globalEnvError: string | null;
  globalEnvSuccess: boolean;
  // Proxy state
  proxyConfig: CliproxyServerConfig | null;
  proxyLoading: boolean;
  proxySaving: boolean;
  proxyError: string | null;
  proxySuccess: boolean;
  proxyTestResult: RemoteProxyStatus | null;
  proxyTesting: boolean;
  // Raw config
  rawConfig: string | null;
  rawConfigLoading: boolean;
}

export const initialSettingsState: SettingsState = {
  globalEnvConfig: null,
  globalEnvLoading: true,
  globalEnvSaving: false,
  globalEnvError: null,
  globalEnvSuccess: false,
  proxyConfig: null,
  proxyLoading: true,
  proxySaving: false,
  proxyError: null,
  proxySuccess: false,
  proxyTestResult: null,
  proxyTesting: false,
  rawConfig: null,
  rawConfigLoading: false,
};

// === Actions ===

export type SettingsAction =
  | { type: 'SET_GLOBALENV_CONFIG'; payload: GlobalEnvConfig | null }
  | { type: 'SET_GLOBALENV_LOADING'; payload: boolean }
  | { type: 'SET_GLOBALENV_SAVING'; payload: boolean }
  | { type: 'SET_GLOBALENV_ERROR'; payload: string | null }
  | { type: 'SET_GLOBALENV_SUCCESS'; payload: boolean }
  | { type: 'SET_PROXY_CONFIG'; payload: CliproxyServerConfig | null }
  | { type: 'SET_PROXY_LOADING'; payload: boolean }
  | { type: 'SET_PROXY_SAVING'; payload: boolean }
  | { type: 'SET_PROXY_ERROR'; payload: string | null }
  | { type: 'SET_PROXY_SUCCESS'; payload: boolean }
  | { type: 'SET_PROXY_TEST_RESULT'; payload: RemoteProxyStatus | null }
  | { type: 'SET_PROXY_TESTING'; payload: boolean }
  | { type: 'SET_RAW_CONFIG'; payload: string | null }
  | { type: 'SET_RAW_CONFIG_LOADING'; payload: boolean };

export function settingsReducer(state: SettingsState, action: SettingsAction): SettingsState {
  switch (action.type) {
    case 'SET_GLOBALENV_CONFIG':
      return { ...state, globalEnvConfig: action.payload };
    case 'SET_GLOBALENV_LOADING':
      return { ...state, globalEnvLoading: action.payload };
    case 'SET_GLOBALENV_SAVING':
      return { ...state, globalEnvSaving: action.payload };
    case 'SET_GLOBALENV_ERROR':
      return { ...state, globalEnvError: action.payload };
    case 'SET_GLOBALENV_SUCCESS':
      return { ...state, globalEnvSuccess: action.payload };
    case 'SET_PROXY_CONFIG':
      return { ...state, proxyConfig: action.payload };
    case 'SET_PROXY_LOADING':
      return { ...state, proxyLoading: action.payload };
    case 'SET_PROXY_SAVING':
      return { ...state, proxySaving: action.payload };
    case 'SET_PROXY_ERROR':
      return { ...state, proxyError: action.payload };
    case 'SET_PROXY_SUCCESS':
      return { ...state, proxySuccess: action.payload };
    case 'SET_PROXY_TEST_RESULT':
      return { ...state, proxyTestResult: action.payload };
    case 'SET_PROXY_TESTING':
      return { ...state, proxyTesting: action.payload };
    case 'SET_RAW_CONFIG':
      return { ...state, rawConfig: action.payload };
    case 'SET_RAW_CONFIG_LOADING':
      return { ...state, rawConfigLoading: action.payload };
    default:
      return state;
  }
}

// === Context ===

export interface SettingsContextValue {
  state: SettingsState;
  dispatch: Dispatch<SettingsAction>;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);
