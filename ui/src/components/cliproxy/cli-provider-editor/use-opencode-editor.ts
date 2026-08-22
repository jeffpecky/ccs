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

// OpenCode-specific required fields
const REQUIRED_ENV_KEYS = ['OPENCODE_BASE_URL', 'OPENCODE_API_KEY'] as const;

function checkMissingFields(settings: { model?: Record<string, string> }): string[] {
  const model = settings?.model || {};
  return REQUIRED_ENV_KEYS.filter((key) => !model[key]?.trim());
}

const NATIVE_CONFIG_TOOLS: Record<string, string> = {
  opencode: '/api/cli-tools/opencode-settings',
};

export function useOpenCodeEditor(
  provider: string,
  _catalog?: ProviderCatalog,
  toolId?: string
): OpenCodeEditorReturn {
  const [rawJsonEdits, setRawJsonEdits] = useState<string | null>(null);
  const [conflictDialog, setConflictDialog] = useState(false);
  const queryClient = useQueryClient();

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

      const nativeEndpoint = toolId ? NATIVE_CONFIG_TOOLS[toolId] : undefined;
      if (nativeEndpoint) {
        const model = settingsToSave.model || {};
        const nativeRes = await fetch(nativeEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model }),
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
