/**
 * useOpenCodeEditor Hook
 * Manages query, mutation, and state logic for OpenCodeEditor
 * OpenCode-specific version with correct required fields
 */

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import i18n from '@/lib/i18n';
import type { OpenCodeSettingsResponse, OpenCodeEditorReturn } from './types';
import type { ProviderCatalog } from '../provider-model-selector';
import { isValidProvider } from '@/lib/provider-config';
import { CLIPROXY_DEFAULT_PORT } from '@/lib/preset-utils';
import { useAuthApiKey, getEffectiveApiKey } from '@/hooks/use-auth-api-key';

// OpenCode-specific required fields
const REQUIRED_ENV_KEYS = ['OPENCODE_BASE_URL', 'OPENCODE_API_KEY'] as const;

function checkMissingFields(settings: { model?: Record<string, string> }): string[] {
  const model = settings?.model || {};
  return REQUIRED_ENV_KEYS.filter((key) => !model[key]?.trim());
}

const NATIVE_CONFIG_TOOLS: Record<string, string> = {
  opencode: '/api/cli-tools/opencode-settings',
};

export function normalizeSelectedOpenCodeModels(values: unknown, legacyModel?: string): string[] {
  const source = Array.isArray(values) ? values : legacyModel ? [legacyModel] : [];
  return [
    ...new Set(
      source
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)
    ),
  ];
}

export function removeSelectedOpenCodeModel(
  models: string[],
  activeModel: string,
  subagentModel: string,
  removedModel = activeModel
): { models: string[]; activeModel: string; subagentModel: string } {
  const remaining = models.filter((model) => model !== removedModel);
  const nextActive = activeModel === removedModel ? remaining[0] || '' : activeModel;
  return {
    models: remaining,
    activeModel: nextActive,
    subagentModel: subagentModel === removedModel ? nextActive : subagentModel,
  };
}

export function useOpenCodeEditor(
  provider: string,
  _catalog?: ProviderCatalog,
  toolId?: string,
  port?: number
): OpenCodeEditorReturn {
  const [rawJsonEdits, setRawJsonEdits] = useState<string | null>(null);
  const [conflictDialog, setConflictDialog] = useState(false);
  const queryClient = useQueryClient();

  // Fetch effective API key from Auth tab (shared hook)
  const { data: authTokens } = useAuthApiKey();
  const effectiveApiKey = getEffectiveApiKey(authTokens);
  const effectivePort = port ?? CLIPROXY_DEFAULT_PORT;

  const { data, isLoading, refetch } = useQuery<OpenCodeSettingsResponse>({
    queryKey: ['settings', provider],
    queryFn: async () => {
      const res = await fetch(`/api/settings/${provider}/raw`);
      if (!res.ok) {
        const fallbackPath = isValidProvider(provider)
          ? `~/.ccs/${provider}.settings.json`
          : `~/.ccs/profiles/${provider}/settings.json`;
        return {
          profile: provider,
          settings: { model: {} },
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
    return '{\n  "model": {}\n}';
  }, [rawJsonEdits, settings]);

  const handleRawJsonChange = useCallback((value: string) => {
    setRawJsonEdits(value);
  }, []);

  const currentSettings = useMemo(() => {
    try {
      return JSON.parse(rawJsonContent);
    } catch {
      return settings || { model: {} };
    }
  }, [rawJsonContent, settings]);

  // OpenCode model fields
  const currentModel = currentSettings?.model?.OPENCODE_MODEL;
  const subagentModel = currentSettings?.model?.OPENCODE_SUB_AGENT_MODEL;
  const selectedModels = normalizeSelectedOpenCodeModels(currentSettings?.models, currentModel);

  const updateEnvValue = useCallback(
    (key: string, value: string) => {
      const newModel = { ...(currentSettings?.model || {}), [key]: value };
      const newSettings = { ...currentSettings, model: newModel };
      setRawJsonEdits(JSON.stringify(newSettings, null, 2));
    },
    [currentSettings]
  );

  const updateEnvValues = useCallback(
    (updates: Record<string, string>) => {
      const newModel = { ...(currentSettings?.model || {}), ...updates };
      const newSettings = { ...currentSettings, model: newModel };
      setRawJsonEdits(JSON.stringify(newSettings, null, 2));
    },
    [currentSettings]
  );

  const updateModels = useCallback(
    (models: string[], activeModel: string, nextSubagentModel = subagentModel || activeModel) => {
      const newModel = {
        ...(currentSettings?.model || {}),
        OPENCODE_MODEL: activeModel,
        OPENCODE_SUB_AGENT_MODEL: nextSubagentModel,
      };
      setRawJsonEdits(JSON.stringify({ ...currentSettings, models, model: newModel }, null, 2));
    },
    [currentSettings, subagentModel]
  );

  const addModel = useCallback(
    (model: string) => {
      const value = model.trim();
      if (!value || selectedModels.includes(value)) return;
      updateModels([...selectedModels, value], currentModel || value);
    },
    [currentModel, selectedModels, updateModels]
  );

  const removeModel = useCallback(
    (model: string) => {
      const next = removeSelectedOpenCodeModel(
        selectedModels,
        currentModel || selectedModels[0] || '',
        subagentModel || currentModel || selectedModels[0] || '',
        model
      );
      updateModels(next.models, next.activeModel, next.subagentModel);
    },
    [currentModel, selectedModels, subagentModel, updateModels]
  );

  const setActiveModel = useCallback(
    (model: string) => {
      if (selectedModels.includes(model)) updateModels(selectedModels, model);
    },
    [selectedModels, updateModels]
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

      // Auto-fill OPENCODE_BASE_URL and OPENCODE_API_KEY from Auth tab if missing
      const model = settingsToSave.model || {};
      if (!model.OPENCODE_BASE_URL?.trim()) {
        model.OPENCODE_BASE_URL = `http://127.0.0.1:${effectivePort}/v1`;
      }
      if (!model.OPENCODE_API_KEY?.trim()) {
        model.OPENCODE_API_KEY = effectiveApiKey;
      }
      settingsToSave.model = model;

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
          body: JSON.stringify({
            model,
            models: normalizeSelectedOpenCodeModels(settingsToSave.models, model.OPENCODE_MODEL),
            activeModel: model.OPENCODE_MODEL,
            subagentModel: model.OPENCODE_SUB_AGENT_MODEL,
          }),
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
          description: 'Also written to OpenCode config',
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
    selectedModels,
    addModel,
    removeModel,
    setActiveModel,
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
