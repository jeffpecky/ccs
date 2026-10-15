/**
 * Copilot API Hook
 *
 * React hook for managing GitHub Copilot integration state.
 */

import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiConflictError, withApiBase } from '@/lib/api-client';

// Types
export interface CopilotNormalizationWarning {
  source: 'config' | 'settings';
  tier: 'default' | 'opus' | 'sonnet' | 'haiku';
  original: string;
  replacement: string;
  message: string;
}

export interface CopilotStatus {
  enabled: boolean;
  installed: boolean;
  version: string | null;
  authenticated: boolean;
  daemon_running: boolean;
  port: number;
  model: string;
  account_type: 'individual' | 'business' | 'enterprise';
  auto_start: boolean;
  rate_limit: number | null;
  wait_on_limit: boolean;
}

export interface CopilotStatusResponse extends CopilotStatus {
  warnings?: CopilotNormalizationWarning[];
}

export interface CopilotInfo {
  installed: boolean;
  version: string | null;
  path: string;
  pinnedVersion: string | null;
}

export interface CopilotInstallResult {
  success: boolean;
  installed: boolean;
  version: string | null;
  path: string;
}

export interface CopilotConfig {
  enabled: boolean;
  auto_start: boolean;
  port: number;
  account_type: 'individual' | 'business' | 'enterprise';
  rate_limit: number | null;
  wait_on_limit: boolean;
  model: string;
  // Model mapping for Claude tiers
  opus_model?: string;
  sonnet_model?: string;
  haiku_model?: string;
}

export interface CopilotConfigResponse extends CopilotConfig {
  warnings?: CopilotNormalizationWarning[];
}

/** GitHub Copilot plan tiers */
export type CopilotPlanTier = 'free' | 'pro' | 'pro+' | 'business' | 'enterprise';

export interface CopilotModelLimits {
  maxContextWindowTokens?: number;
  maxOutputTokens?: number;
  maxPromptTokens?: number;
}

export interface CopilotModel {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic';
  isDefault?: boolean;
  isCurrent?: boolean;
  /** Minimum plan tier required (free = available to all) */
  minPlan?: CopilotPlanTier;
  /** Premium request multiplier (0 = free, higher = more expensive) */
  multiplier?: number;
  /** Whether this model is in preview */
  preview?: boolean;
  /** Live model limits returned by GitHub Copilot metadata, when available */
  limits?: CopilotModelLimits;
}

export interface CopilotRawSettings {
  settings: {
    env?: Record<string, string>;
  };
  effectiveSettings?: {
    env?: Record<string, string>;
  };
  mtime: number;
  path: string;
  exists: boolean;
  warnings?: CopilotNormalizationWarning[];
}

// API functions
async function fetchCopilotStatus(): Promise<CopilotStatusResponse> {
  const res = await fetch(withApiBase('/copilot/status'));
  if (!res.ok) throw new Error('Failed to fetch copilot status');
  return res.json();
}

async function fetchCopilotConfig(): Promise<CopilotConfigResponse> {
  const res = await fetch(withApiBase('/copilot/config'));
  if (!res.ok) throw new Error('Failed to fetch copilot config');
  return res.json();
}

async function fetchCopilotModels(): Promise<{
  models: CopilotModel[];
  current: string;
  warnings?: CopilotNormalizationWarning[];
}> {
  const res = await fetch(withApiBase('/copilot/models'));
  if (!res.ok) throw new Error('Failed to fetch copilot models');
  return res.json();
}

async function fetchCopilotRawSettings(): Promise<CopilotRawSettings> {
  const res = await fetch(withApiBase('/copilot/settings/raw'));
  if (!res.ok) throw new Error('Failed to fetch copilot raw settings');
  return res.json();
}

async function updateCopilotConfig(config: Partial<CopilotConfig>): Promise<{
  success: boolean;
  copilot: CopilotConfig;
  warnings?: CopilotNormalizationWarning[];
}> {
  const res = await fetch(withApiBase('/copilot/config'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error('Failed to update copilot config');
  return res.json();
}

async function saveCopilotRawSettings(data: {
  settings: CopilotRawSettings['settings'];
  expectedMtime?: number;
}): Promise<{
  success: boolean;
  mtime: number;
  settings?: CopilotRawSettings['settings'];
  warnings?: CopilotNormalizationWarning[];
}> {
  const res = await fetch(withApiBase('/copilot/settings/raw'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (res.status === 409) throw new ApiConflictError('Copilot raw settings changed externally');
  if (!res.ok) throw new Error('Failed to save copilot raw settings');
  return res.json();
}

export interface CopilotAuthResult {
  success: boolean;
  error?: string;
  deviceCode?: string;
  verificationUrl?: string;
}

async function startCopilotAuth(): Promise<CopilotAuthResult> {
  const res = await fetch(withApiBase('/copilot/auth/start'), { method: 'POST' });
  if (!res.ok) throw new Error('Failed to start auth');
  return res.json();
}

async function startCopilotDaemon(): Promise<{ success: boolean; pid?: number; error?: string }> {
  const res = await fetch(withApiBase('/copilot/daemon/start'), { method: 'POST' });
  if (!res.ok) throw new Error('Failed to start daemon');
  return res.json();
}

async function stopCopilotDaemon(): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(withApiBase('/copilot/daemon/stop'), { method: 'POST' });
  if (!res.ok) throw new Error('Failed to stop daemon');
  return res.json();
}

async function fetchCopilotInfo(): Promise<CopilotInfo> {
  const res = await fetch(withApiBase('/copilot/info'));
  if (!res.ok) throw new Error('Failed to fetch copilot info');
  return res.json();
}

async function installCopilotApi(version?: string): Promise<CopilotInstallResult> {
  const res = await fetch(withApiBase('/copilot/install'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(version ? { version } : {}),
  });
  if (!res.ok) throw new Error('Failed to install copilot-api');
  return res.json();
}

// Hook
export function useCopilot() {
  const queryClient = useQueryClient();

  // Queries
  const statusQuery = useQuery({
    queryKey: ['copilot-status'],
    queryFn: fetchCopilotStatus,
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  const configQuery = useQuery({
    queryKey: ['copilot-config'],
    queryFn: fetchCopilotConfig,
  });

  const modelsQuery = useQuery({
    queryKey: ['copilot-models'],
    queryFn: fetchCopilotModels,
  });

  const rawSettingsQuery = useQuery({
    queryKey: ['copilot-raw-settings'],
    queryFn: fetchCopilotRawSettings,
  });

  const infoQuery = useQuery({
    queryKey: ['copilot-info'],
    queryFn: fetchCopilotInfo,
  });

  // Mutations
  const updateConfigMutation = useMutation({
    mutationFn: updateCopilotConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['copilot-status'] });
      queryClient.invalidateQueries({ queryKey: ['copilot-config'] });
      queryClient.invalidateQueries({ queryKey: ['copilot-raw-settings'] });
    },
  });

  const saveRawSettingsMutation = useMutation({
    mutationFn: saveCopilotRawSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['copilot-status'] });
      queryClient.invalidateQueries({ queryKey: ['copilot-config'] });
      queryClient.invalidateQueries({ queryKey: ['copilot-raw-settings'] });
    },
  });

  const startAuthMutation = useMutation({
    mutationFn: startCopilotAuth,
    onSuccess: () => {
      // Auth completed - immediately refetch status
      queryClient.invalidateQueries({ queryKey: ['copilot-status'] });
    },
  });

  const startDaemonMutation = useMutation({
    mutationFn: startCopilotDaemon,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['copilot-status'] });
    },
  });

  const stopDaemonMutation = useMutation({
    mutationFn: stopCopilotDaemon,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['copilot-status'] });
    },
  });

  const installMutation = useMutation({
    mutationFn: installCopilotApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['copilot-status'] });
      queryClient.invalidateQueries({ queryKey: ['copilot-info'] });
    },
  });

  return useMemo(
    () => ({
      // Status
      status: statusQuery.data,
      statusLoading: statusQuery.isLoading,
      statusError: statusQuery.error,
      refetchStatus: statusQuery.refetch,

      // Config
      config: configQuery.data,
      configLoading: configQuery.isLoading,

      // Models
      models: modelsQuery.data?.models ?? [],
      currentModel: modelsQuery.data?.current,
      modelsLoading: modelsQuery.isLoading,

      // Raw Settings
      rawSettings: rawSettingsQuery.data,
      rawSettingsLoading: rawSettingsQuery.isLoading,
      refetchRawSettings: rawSettingsQuery.refetch,

      // Mutations
      updateConfig: updateConfigMutation.mutate,
      updateConfigAsync: updateConfigMutation.mutateAsync,
      isUpdating: updateConfigMutation.isPending,

      saveRawSettings: saveRawSettingsMutation.mutate,
      saveRawSettingsAsync: saveRawSettingsMutation.mutateAsync,
      isSavingRawSettings: saveRawSettingsMutation.isPending,

      startAuth: startAuthMutation.mutate,
      startAuthAsync: startAuthMutation.mutateAsync,
      isAuthenticating: startAuthMutation.isPending,
      authResult: startAuthMutation.data,

      startDaemon: startDaemonMutation.mutate,
      isStartingDaemon: startDaemonMutation.isPending,

      stopDaemon: stopDaemonMutation.mutate,
      isStoppingDaemon: stopDaemonMutation.isPending,

      // Install
      info: infoQuery.data,
      infoLoading: infoQuery.isLoading,
      refetchInfo: infoQuery.refetch,

      install: installMutation.mutate,
      installAsync: installMutation.mutateAsync,
      isInstalling: installMutation.isPending,
    }),
    [
      statusQuery.data,
      statusQuery.isLoading,
      statusQuery.error,
      statusQuery.refetch,
      configQuery.data,
      configQuery.isLoading,
      modelsQuery.data,
      modelsQuery.isLoading,
      rawSettingsQuery.data,
      rawSettingsQuery.isLoading,
      rawSettingsQuery.refetch,
      updateConfigMutation.mutate,
      updateConfigMutation.mutateAsync,
      updateConfigMutation.isPending,
      saveRawSettingsMutation.mutate,
      saveRawSettingsMutation.mutateAsync,
      saveRawSettingsMutation.isPending,
      startAuthMutation.mutate,
      startAuthMutation.mutateAsync,
      startAuthMutation.isPending,
      startAuthMutation.data,
      startDaemonMutation.mutate,
      startDaemonMutation.isPending,
      stopDaemonMutation.mutate,
      stopDaemonMutation.isPending,
      infoQuery.data,
      infoQuery.isLoading,
      infoQuery.refetch,
      installMutation.mutate,
      installMutation.mutateAsync,
      installMutation.isPending,
    ]
  );
}
