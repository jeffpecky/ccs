/**
 * Cursor API Hook
 *
 * React hook for managing Cursor integration state.
 */

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiConflictError, withApiBase } from '@/lib/api-client';

export interface CursorStatus {
  enabled: boolean;
  authenticated: boolean;
  auth_method: 'auto-detect' | 'manual' | null;
  token_age: number | null;
  token_expired: boolean;
  daemon_running: boolean;
  port: number;
  auto_start: boolean;
  ghost_mode: boolean;
}

export interface CursorConfig {
  enabled: boolean;
  port: number;
  auto_start: boolean;
  ghost_mode: boolean;
  model: string;
  opus_model?: string;
  sonnet_model?: string;
  haiku_model?: string;
}

export interface CursorModel {
  id: string;
  name: string;
  provider: string;
  isDefault?: boolean;
}

export interface CursorRawSettings {
  settings: {
    env?: Record<string, string>;
  };
  mtime: number;
  path: string;
  exists: boolean;
}

interface CursorModelsResponse {
  models: CursorModel[];
  current: string;
}

interface CursorAuthResult {
  success: boolean;
  message: string;
}

const LEGACY_CURSOR_API_BASE = '/legacy/cursor';

export interface CursorProbeResult {
  ok: boolean;
  stage: 'config' | 'auth' | 'daemon' | 'runtime';
  status: number;
  duration_ms: number;
  model?: string;
  error_type?: string | null;
  message: string;
}

function isCursorProbeResult(value: unknown): value is CursorProbeResult {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<CursorProbeResult>;
  return (
    typeof candidate.message === 'string' &&
    typeof candidate.stage === 'string' &&
    typeof candidate.status === 'number' &&
    typeof candidate.duration_ms === 'number' &&
    typeof candidate.ok === 'boolean'
  );
}

function getProbeErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('error' in value)) return null;
  const candidate = value as { error?: unknown };
  return typeof candidate.error === 'string' ? candidate.error : null;
}

async function fetchCursorStatus(): Promise<CursorStatus> {
  const res = await fetch(withApiBase(`${LEGACY_CURSOR_API_BASE}/status`));
  if (!res.ok) throw new Error('Failed to fetch cursor status');
  return res.json();
}

async function fetchCursorConfig(): Promise<CursorConfig> {
  const res = await fetch(withApiBase(`${LEGACY_CURSOR_API_BASE}/settings`));
  if (!res.ok) throw new Error('Failed to fetch cursor config');
  return res.json();
}

async function fetchCursorModels(): Promise<CursorModelsResponse> {
  const res = await fetch(withApiBase(`${LEGACY_CURSOR_API_BASE}/models`));
  if (!res.ok) throw new Error('Failed to fetch cursor models');
  return res.json();
}

async function fetchCursorRawSettings(): Promise<CursorRawSettings> {
  const res = await fetch(withApiBase(`${LEGACY_CURSOR_API_BASE}/settings/raw`));
  if (!res.ok) throw new Error('Failed to fetch cursor raw settings');
  return res.json();
}

async function updateCursorConfig(
  updates: Partial<CursorConfig>
): Promise<{ success: boolean; cursor: CursorConfig }> {
  const res = await fetch(withApiBase(`${LEGACY_CURSOR_API_BASE}/settings`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to update cursor config');
  return res.json();
}

async function saveCursorRawSettings(data: {
  settings: CursorRawSettings['settings'];
  expectedMtime?: number;
}): Promise<{ success: boolean; mtime: number }> {
  const res = await fetch(withApiBase(`${LEGACY_CURSOR_API_BASE}/settings/raw`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (res.status === 409) throw new ApiConflictError('Cursor raw settings changed externally');
  if (!res.ok) throw new Error('Failed to save cursor raw settings');
  return res.json();
}

async function autoDetectCursorAuth(): Promise<CursorAuthResult> {
  const res = await fetch(withApiBase(`${LEGACY_CURSOR_API_BASE}/auth/auto-detect`), {
    method: 'POST',
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Auto-detect failed' }));
    throw new Error(error.error || 'Auto-detect failed');
  }
  return res.json();
}

async function importCursorAuthManual(data: {
  accessToken: string;
  machineId: string;
}): Promise<CursorAuthResult> {
  const res = await fetch(withApiBase(`${LEGACY_CURSOR_API_BASE}/auth/import`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Manual import failed' }));
    throw new Error(error.error || 'Manual import failed');
  }
  return res.json();
}

async function startCursorDaemon(): Promise<{ success: boolean; pid?: number; error?: string }> {
  const res = await fetch(withApiBase(`${LEGACY_CURSOR_API_BASE}/daemon/start`), {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to start cursor daemon');
  return res.json();
}

async function stopCursorDaemon(): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(withApiBase(`${LEGACY_CURSOR_API_BASE}/daemon/stop`), {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to stop cursor daemon');
  return res.json();
}

async function probeCursorRuntime(): Promise<CursorProbeResult> {
  const res = await fetch(withApiBase(`${LEGACY_CURSOR_API_BASE}/probe`), { method: 'POST' });
  const payload = await res.json().catch(() => null);

  if (isCursorProbeResult(payload)) {
    return payload;
  }

  return {
    ok: false,
    stage: 'runtime',
    status: res.status,
    duration_ms: 0,
    error_type: 'runtime_error',
    message: getProbeErrorMessage(payload) ?? 'Failed to run live probe',
  };
}

export function useCursor() {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ['cursor-status'],
    queryFn: fetchCursorStatus,
    refetchInterval: 5000,
  });

  const configQuery = useQuery({
    queryKey: ['cursor-config'],
    queryFn: fetchCursorConfig,
  });

  const modelsQuery = useQuery({
    queryKey: ['cursor-models'],
    queryFn: fetchCursorModels,
  });

  const rawSettingsQuery = useQuery({
    queryKey: ['cursor-raw-settings'],
    queryFn: fetchCursorRawSettings,
  });

  const invalidateCursorQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['cursor-status'] });
    queryClient.invalidateQueries({ queryKey: ['cursor-config'] });
    queryClient.invalidateQueries({ queryKey: ['cursor-models'] });
    queryClient.invalidateQueries({ queryKey: ['cursor-raw-settings'] });
  };

  const updateConfigMutation = useMutation({
    mutationFn: updateCursorConfig,
    onSuccess: invalidateCursorQueries,
  });

  const saveRawSettingsMutation = useMutation({
    mutationFn: saveCursorRawSettings,
    onSuccess: invalidateCursorQueries,
  });

  const autoDetectAuthMutation = useMutation({
    mutationFn: autoDetectCursorAuth,
    onSuccess: invalidateCursorQueries,
  });

  const manualAuthMutation = useMutation({
    mutationFn: importCursorAuthManual,
    onSuccess: invalidateCursorQueries,
  });

  const startDaemonMutation = useMutation({
    mutationFn: startCursorDaemon,
    onSuccess: invalidateCursorQueries,
  });

  const stopDaemonMutation = useMutation({
    mutationFn: stopCursorDaemon,
    onSuccess: invalidateCursorQueries,
  });

  const probeMutation = useMutation({
    mutationFn: probeCursorRuntime,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['cursor-status'] });
      queryClient.invalidateQueries({ queryKey: ['cursor-models'] });
    },
  });

  return useMemo(
    () => ({
      status: statusQuery.data,
      statusLoading: statusQuery.isLoading,
      statusError: statusQuery.error,
      refetchStatus: statusQuery.refetch,

      config: configQuery.data,
      configLoading: configQuery.isLoading,
      refetchConfig: configQuery.refetch,

      models: modelsQuery.data?.models ?? [],
      currentModel: modelsQuery.data?.current ?? null,
      modelsLoading: modelsQuery.isLoading,

      rawSettings: rawSettingsQuery.data,
      rawSettingsLoading: rawSettingsQuery.isLoading,
      refetchRawSettings: rawSettingsQuery.refetch,

      updateConfig: updateConfigMutation.mutate,
      updateConfigAsync: updateConfigMutation.mutateAsync,
      isUpdatingConfig: updateConfigMutation.isPending,

      saveRawSettings: saveRawSettingsMutation.mutate,
      saveRawSettingsAsync: saveRawSettingsMutation.mutateAsync,
      isSavingRawSettings: saveRawSettingsMutation.isPending,

      autoDetectAuth: autoDetectAuthMutation.mutate,
      autoDetectAuthAsync: autoDetectAuthMutation.mutateAsync,
      isAutoDetectingAuth: autoDetectAuthMutation.isPending,
      autoDetectAuthResult: autoDetectAuthMutation.data,

      importManualAuth: manualAuthMutation.mutate,
      importManualAuthAsync: manualAuthMutation.mutateAsync,
      isImportingManualAuth: manualAuthMutation.isPending,
      manualAuthResult: manualAuthMutation.data,

      startDaemon: startDaemonMutation.mutate,
      startDaemonAsync: startDaemonMutation.mutateAsync,
      isStartingDaemon: startDaemonMutation.isPending,

      stopDaemon: stopDaemonMutation.mutate,
      stopDaemonAsync: stopDaemonMutation.mutateAsync,
      isStoppingDaemon: stopDaemonMutation.isPending,

      runProbe: probeMutation.mutate,
      runProbeAsync: probeMutation.mutateAsync,
      isRunningProbe: probeMutation.isPending,
      probeResult: probeMutation.data,
      resetProbe: probeMutation.reset,
    }),
    [
      statusQuery.data,
      statusQuery.isLoading,
      statusQuery.error,
      statusQuery.refetch,
      configQuery.data,
      configQuery.isLoading,
      configQuery.refetch,
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
      autoDetectAuthMutation.mutate,
      autoDetectAuthMutation.mutateAsync,
      autoDetectAuthMutation.isPending,
      autoDetectAuthMutation.data,
      manualAuthMutation.mutate,
      manualAuthMutation.mutateAsync,
      manualAuthMutation.isPending,
      manualAuthMutation.data,
      startDaemonMutation.mutate,
      startDaemonMutation.mutateAsync,
      startDaemonMutation.isPending,
      stopDaemonMutation.mutate,
      stopDaemonMutation.mutateAsync,
      stopDaemonMutation.isPending,
      probeMutation.mutate,
      probeMutation.mutateAsync,
      probeMutation.isPending,
      probeMutation.data,
      probeMutation.reset,
    ]
  );
}
