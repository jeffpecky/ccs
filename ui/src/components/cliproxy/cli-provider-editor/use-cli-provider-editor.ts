/**
 * useCLIProviderEditor Hook
 * Manages query, mutation, and state logic for CLIProviderEditor
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '@/lib/i18n';
import type { SettingsResponse, UseCLIProviderEditorReturn } from './types';
import type { ProviderCatalog } from '../provider-model-selector';
import {
  applyExtendedContextPreferenceToAnthropicModels,
  hasAnthropicExtendedContextEnabled,
  isAnthropicModelEnvKey,
} from '@/lib/extended-context-utils';
import { supportsExtendedContext } from '@/lib/model-catalogs';
import { isValidProvider } from '@/lib/provider-config';

const REQUIRED_ENV_KEYS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY'] as const;

function checkMissingFields(settings: { env?: Record<string, string> }): string[] {
  const env = settings?.env || {};
  return REQUIRED_ENV_KEYS.filter((key) => !env[key]?.trim());
}

const NATIVE_CONFIG_TOOLS: Record<string, string> = {
  'claude-code': '/api/cli-tools/claude-settings',
  codex: '/api/cli-tools/codex-settings',
  opencode: '/api/cli-tools/opencode-settings',
};

export function useCLIProviderEditor(
  provider: string,
  catalog?: ProviderCatalog,
  toolId?: string
): UseCLIProviderEditorReturn {
  const [rawJsonEdits, setRawJsonEdits] = useState<string | null>(null);
  const [conflictDialog, setConflictDialog] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery<SettingsResponse>({
    queryKey: ['settings', provider],
    queryFn: async () => {
      const res = await fetch(`/api/settings/${provider}/raw`);
      if (!res.ok) {
        const fallbackPath =
          provider === 'cursor'
            ? `~/.ccs/cliproxy/providers/${provider}.settings.json`
            : isValidProvider(provider)
              ? `~/.ccs/${provider}.settings.json`
              : `~/.ccs/profiles/${provider}/settings.json`;
        return {
          profile: provider,
          settings: { env: {} },
          mtime: Date.now(),
          path: fallbackPath,
        };
      }
      return res.json();
    },
  });

  const settings = data?.settings;

  const rawJsonContent = useMemo(() => {
    if (rawJsonEdits !== null) return rawJsonEdits;
    if (settings) return JSON.stringify(settings, null, 2);
    return '{\n  "env": {}\n}';
  }, [rawJsonEdits, settings]);

  const handleRawJsonChange = useCallback((value: string) => {
    setRawJsonEdits(value);
  }, []);

  const currentSettings = useMemo(() => {
    try {
      return JSON.parse(rawJsonContent);
    } catch {
      return settings || { env: {} };
    }
  }, [rawJsonContent, settings]);

  const currentModel = currentSettings?.env?.ANTHROPIC_MODEL;
  const opusModel = currentSettings?.env?.ANTHROPIC_DEFAULT_OPUS_MODEL;
  const sonnetModel = currentSettings?.env?.ANTHROPIC_DEFAULT_SONNET_MODEL;
  const haikuModel = currentSettings?.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL;

  const extendedContextEnabled = useMemo(() => {
    return hasAnthropicExtendedContextEnabled(currentSettings?.env || {});
  }, [currentSettings]);

  const applySavedLongContextIntent = useCallback(
    (env: Record<string, string>, enabled: boolean) =>
      applyExtendedContextPreferenceToAnthropicModels(env, enabled, {
        supportsExtendedContext: (modelId) => supportsExtendedContext(provider, modelId, catalog),
      }),
    [catalog, provider]
  );

  const updateEnvValue = useCallback(
    (key: string, value: string) => {
      const newEnv = { ...(currentSettings?.env || {}), [key]: value };
      const envWithIntent = isAnthropicModelEnvKey(key)
        ? applySavedLongContextIntent(newEnv, extendedContextEnabled)
        : newEnv;
      delete envWithIntent['CCS_EXTENDED_CONTEXT'];

      const newSettings = { ...currentSettings, env: envWithIntent };
      setRawJsonEdits(JSON.stringify(newSettings, null, 2));
    },
    [applySavedLongContextIntent, currentSettings, extendedContextEnabled]
  );

  const toggleExtendedContext = useCallback(
    (enabled: boolean) => {
      const env = currentSettings?.env || {};
      const newEnv = applySavedLongContextIntent(env, enabled);
      delete newEnv['CCS_EXTENDED_CONTEXT'];

      const newSettings = { ...currentSettings, env: newEnv };
      setRawJsonEdits(JSON.stringify(newSettings, null, 2));
    },
    [applySavedLongContextIntent, currentSettings]
  );

  const updateEnvValues = useCallback(
    (updates: Record<string, string>) => {
      const newEnv = { ...(currentSettings?.env || {}), ...updates };
      const touchesAnthropicModel = Object.keys(updates).some(isAnthropicModelEnvKey);
      const envWithIntent = touchesAnthropicModel
        ? applySavedLongContextIntent(newEnv, extendedContextEnabled)
        : newEnv;
      delete envWithIntent['CCS_EXTENDED_CONTEXT'];

      const newSettings = { ...currentSettings, env: envWithIntent };
      setRawJsonEdits(JSON.stringify(newSettings, null, 2));
    },
    [applySavedLongContextIntent, currentSettings, extendedContextEnabled]
  );

  const isRawJsonValid = useMemo(() => {
    try {
      JSON.parse(rawJsonContent);
      return true;
    } catch {
      return false;
    }
  }, [rawJsonContent]);

  const hasChanges = useMemo(() => {
    if (rawJsonEdits === null) return false;
    return rawJsonEdits !== JSON.stringify(settings, null, 2);
  }, [rawJsonEdits, settings]);

  const missingFields = useMemo(() => checkMissingFields(currentSettings), [currentSettings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const settingsToSave = JSON.parse(rawJsonContent);

      const res = await fetch(`/api/settings/${provider}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: settingsToSave,
          expectedMtime: data?.mtime,
        }),
      });

      if (res.status === 409) throw new Error('CONFLICT');
      if (!res.ok) throw new Error('Failed to save');

      // Also write to CLI tool's native config file
      const nativeEndpoint = toolId ? NATIVE_CONFIG_TOOLS[toolId] : undefined;
      if (nativeEndpoint) {
        const env = settingsToSave.env || {};
        const nativeRes = await fetch(nativeEndpoint, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ env }),
        });
        if (!nativeRes.ok) {
          const err = await nativeRes.json().catch(() => ({}));
          console.error('Failed to write native config:', err);
        }
      }

      return res.json();
    },
    onSuccess: (responseData) => {
      queryClient.invalidateQueries({ queryKey: ['settings', provider] });
      setRawJsonEdits(null);
      const nativeEndpoint = toolId ? NATIVE_CONFIG_TOOLS[toolId] : undefined;
      if (nativeEndpoint) {
        toast.success(i18n.t('settings.saved'), {
          description: 'Also written to CLI tool config',
        });
      } else if (responseData?.warning) {
        toast.success(i18n.t('settings.saved'), {
          description: responseData.warning,
        });
      } else {
        toast.success(i18n.t('settings.saved'));
      }
    },
    onError: (error: Error) => {
      if (error.message === 'CONFLICT') {
        setConflictDialog(true);
      } else {
        toast.error(error.message);
      }
    },
  });

  const handleConflictResolve = async (overwrite: boolean) => {
    setConflictDialog(false);
    if (overwrite) {
      await refetch();
      saveMutation.mutate();
    } else {
      setRawJsonEdits(null);
    }
  };

  return {
    data,
    isLoading,
    refetch,
    rawJsonContent,
    rawJsonEdits,
    isRawJsonValid,
    hasChanges,
    currentSettings,
    currentModel,
    opusModel,
    sonnetModel,
    haikuModel,
    extendedContextEnabled,
    toggleExtendedContext,
    handleRawJsonChange,
    updateEnvValue,
    updateEnvValues,
    saveMutation: {
      mutate: () => saveMutation.mutate(),
      isPending: saveMutation.isPending,
    },
    conflictDialog,
    setConflictDialog,
    handleConflictResolve,
    missingRequiredFields: missingFields,
  };
}

