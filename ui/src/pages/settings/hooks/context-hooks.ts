/**
 * Context Hooks
 * Hooks for accessing and updating settings context state
 */

import { useCallback, useContext, useMemo } from 'react';
import { SettingsContext } from '../settings-context';
import type {
  GlobalEnvConfig,
  CliproxyServerConfig,
  RemoteProxyStatus,
} from '../types';

export function useSettingsContext() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettingsContext must be used within a SettingsProvider');
  }
  return context;
}

export function useSettingsActions() {
  const { dispatch } = useSettingsContext();

  const setGlobalEnvConfig = useCallback(
    (config: GlobalEnvConfig | null) => dispatch({ type: 'SET_GLOBALENV_CONFIG', payload: config }),
    [dispatch]
  );

  const setGlobalEnvLoading = useCallback(
    (loading: boolean) => dispatch({ type: 'SET_GLOBALENV_LOADING', payload: loading }),
    [dispatch]
  );

  const setGlobalEnvSaving = useCallback(
    (saving: boolean) => dispatch({ type: 'SET_GLOBALENV_SAVING', payload: saving }),
    [dispatch]
  );

  const setGlobalEnvError = useCallback(
    (error: string | null) => dispatch({ type: 'SET_GLOBALENV_ERROR', payload: error }),
    [dispatch]
  );

  const setGlobalEnvSuccess = useCallback(
    (success: boolean) => dispatch({ type: 'SET_GLOBALENV_SUCCESS', payload: success }),
    [dispatch]
  );

  const setProxyConfig = useCallback(
    (config: CliproxyServerConfig | null) =>
      dispatch({ type: 'SET_PROXY_CONFIG', payload: config }),
    [dispatch]
  );

  const setProxyLoading = useCallback(
    (loading: boolean) => dispatch({ type: 'SET_PROXY_LOADING', payload: loading }),
    [dispatch]
  );

  const setProxySaving = useCallback(
    (saving: boolean) => dispatch({ type: 'SET_PROXY_SAVING', payload: saving }),
    [dispatch]
  );

  const setProxyError = useCallback(
    (error: string | null) => dispatch({ type: 'SET_PROXY_ERROR', payload: error }),
    [dispatch]
  );

  const setProxySuccess = useCallback(
    (success: boolean) => dispatch({ type: 'SET_PROXY_SUCCESS', payload: success }),
    [dispatch]
  );

  const setProxyTestResult = useCallback(
    (result: RemoteProxyStatus | null) =>
      dispatch({ type: 'SET_PROXY_TEST_RESULT', payload: result }),
    [dispatch]
  );

  const setProxyTesting = useCallback(
    (testing: boolean) => dispatch({ type: 'SET_PROXY_TESTING', payload: testing }),
    [dispatch]
  );

  const setRawConfig = useCallback(
    (config: string | null) => dispatch({ type: 'SET_RAW_CONFIG', payload: config }),
    [dispatch]
  );

  const setRawConfigLoading = useCallback(
    (loading: boolean) => dispatch({ type: 'SET_RAW_CONFIG_LOADING', payload: loading }),
    [dispatch]
  );

  return useMemo(
    () => ({
      setGlobalEnvConfig,
      setGlobalEnvLoading,
      setGlobalEnvSaving,
      setGlobalEnvError,
      setGlobalEnvSuccess,
      setProxyConfig,
      setProxyLoading,
      setProxySaving,
      setProxyError,
      setProxySuccess,
      setProxyTestResult,
      setProxyTesting,
      setRawConfig,
      setRawConfigLoading,
    }),
    [
      setGlobalEnvConfig,
      setGlobalEnvLoading,
      setGlobalEnvSaving,
      setGlobalEnvError,
      setGlobalEnvSuccess,
      setProxyConfig,
      setProxyLoading,
      setProxySaving,
      setProxyError,
      setProxySuccess,
      setProxyTestResult,
      setProxyTesting,
      setRawConfig,
      setRawConfigLoading,
    ]
  );
}
