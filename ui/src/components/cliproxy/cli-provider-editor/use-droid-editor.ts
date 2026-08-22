/**
 * useDroidEditor Hook
 * Manages query, mutation, and state logic for DroidEditor
 * Factory Droid-specific version with correct required fields
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '@/lib/i18n';
import type { DroidSettingsResponse, DroidEditorReturn } from './types';
import type { ProviderCatalog } from '../provider-model-selector';
import { isValidProvider } from '@/lib/provider-config';
import { CLIPROXY_DEFAULT_PORT } from '@/lib/preset-utils';
import { useAuthApiKey, getEffectiveApiKey } from '@/hooks/use-auth-api-key';

// Factory Droid-specific required fields
function checkMissingFields(settings: { custom_models?: unknown[] }): string[] {
  const models = settings?.custom_models || [];
  if (models.length === 0) return ['custom_models'];
  return [];
}

const NATIVE_CONFIG_TOOLS: Record<string, string> = {
  'factory-droid': '/api/cli-tools/factory-droid-settings',
};

export function useDroidEditor(
  provider: string,
  _catalog?: ProviderCatalog,
  toolId?: string,
  port?: number
): DroidEditorReturn {
  const [rawJsonEdits, setRawJsonEdits] = useState<string | null>(null);
  const [conflictDialog, setConflictDialog] = useState(false);
  const queryClient = useQueryClient();

  // Fetch effective API key from Auth tab (shared hook)
  const { data: authTokens } = useAuthApiKey();
  const effectiveApiKey = getEffectiveApiKey(authTokens);
  const effectivePort = port ?? CLIPROXY_DEFAULT_PORT;

  const { data, isLoading, refetch } = useQuery<DroidSettingsResponse>({
    queryKey: ['settings', provider],
    queryFn: async () => {
      const res = await fetch(`/api/settings/${provider}/raw`);
      if (!res.ok) {
        const fallbackPath = isValidProvider(provider)
          ? `~/.ccs/${provider}.settings.json`
          : `~/.ccs/profiles/${provider}/settings.json`;
        return {
          profile: provider,
          settings: { custom_models: [] },
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
    return '{\n  "custom_models": []\n}';
  }, [rawJsonEdits, settings]);

  const handleRawJsonChange = useCallback((value: string) => {
    setRawJsonEdits(value);
  }, []);

  const currentSettings = useMemo(() => {
    try {
      return JSON.parse(rawJsonContent);
    } catch {
      return settings || { custom_models: [] };
    }
  }, [rawJsonContent, settings]);
  // Factory Droid model fields (extracted from custom_models array)
  const currentModel = currentSettings?.custom_models?.[0]?.model;
  const subagentModel = currentSettings?.custom_models?.[1]?.model;

  const updateEnvValue = useCallback(
    (key: string, value: string) => {
      const models = [...(currentSettings?.custom_models || [])];
      if (key === 'OPENAI_MODEL') {
        if (models[0]) {
          models[0] = { ...models[0], model: value };
        } else {
          models.push({
            model: value,
            base_url: `http://127.0.0.1:${effectivePort}/v1`,
            api_key: effectiveApiKey,
            provider: 'openai',
          });
        }
      } else if (key === 'OPENAI_SUB_AGENT_MODEL') {
        if (models[1]) {
          models[1] = { ...models[1], model: value };
        } else {
          models.push({
            model: value,
            base_url: `http://127.0.0.1:${effectivePort}/v1`,
            api_key: effectiveApiKey,
            provider: 'openai',
          });
        }
      }
      const newSettings = { ...currentSettings, custom_models: models };
      setRawJsonEdits(JSON.stringify(newSettings, null, 2));
    },
    [currentSettings, effectivePort, effectiveApiKey]
  );

  const updateEnvValues = useCallback(
    (updates: Record<string, string>) => {
      Object.entries(updates).forEach(([key, value]) => updateEnvValue(key, value));
    },
    [updateEnvValue]
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

      // Auto-fill base_url and api_key from Auth tab for all models if missing
      const models = settingsToSave.custom_models || [];
      for (const m of models) {
        if (!m.base_url?.trim()) {
          m.base_url = `http://127.0.0.1:${effectivePort}/v1`;
        }
        if (!m.api_key?.trim()) {
          m.api_key = effectiveApiKey;
        }
      }
      settingsToSave.custom_models = models;

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

      const nativeEndpoint = toolId ? NATIVE_CONFIG_TOOLS[toolId] : undefined;
      if (nativeEndpoint) {
        const nativeRes = await fetch(nativeEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ custom_models: models }),
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
          description: 'Also written to Factory Droid config',
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
    subagentModel,
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

