/**
 * Copilot Config Form Hook
 * State management for the copilot config form
 */

import { useState, useMemo, useCallback } from 'react';
import { useCopilot } from '@/hooks/use-copilot';
import type { CopilotNormalizationWarning } from '@/hooks/use-copilot';
import { isApiConflictError } from '@/lib/api-client';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import type { ModelPreset } from './types';

/** Required env vars for Copilot settings (informational only - runtime fills defaults) */
const REQUIRED_ENV_KEYS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY'] as const;

/** Check settings for missing fields (for UI warnings) */
function checkMissingFields(settings: { env?: Record<string, string> } | undefined): string[] {
  const env = settings?.env || {};
  return REQUIRED_ENV_KEYS.filter((key) => !env[key]?.trim());
}

function dedupeWarnings(
  warnings: CopilotNormalizationWarning[] | undefined
): CopilotNormalizationWarning[] {
  if (!warnings || warnings.length === 0) return [];
  const unique = new Map<string, CopilotNormalizationWarning>();
  warnings.forEach((warning) => {
    unique.set(warning.message, warning);
  });
  return [...unique.values()];
}

export function useCopilotConfigForm() {
  const { t } = useTranslation();
  const {
    config,
    configLoading,
    models,
    modelsLoading,
    rawSettings,
    rawSettingsLoading,
    updateConfigAsync,
    isUpdating,
    saveRawSettingsAsync,
    isSavingRawSettings,
    refetchRawSettings,
  } = useCopilot();

  // Track local overrides for form fields
  const [localOverrides, setLocalOverrides] = useState<{
    enabled?: boolean;
    autoStart?: boolean;
    port?: number;
    accountType?: 'individual' | 'business' | 'enterprise';
    model?: string;
    rateLimit?: string;
    waitOnLimit?: boolean;
    opusModel?: string;
    sonnetModel?: string;
    haikuModel?: string;
  }>({});

  // Raw JSON editor state
  const [rawJsonEdits, setRawJsonEdits] = useState<string | null>(null);
  const [conflictDialog, setConflictDialog] = useState(false);

  // Use local overrides if set, otherwise use config values
  const enabled = localOverrides.enabled ?? config?.enabled ?? false;
  const autoStart = localOverrides.autoStart ?? config?.auto_start ?? false;
  const port = localOverrides.port ?? config?.port ?? 4141;
  const accountType = localOverrides.accountType ?? config?.account_type ?? 'individual';
  const currentModel = localOverrides.model ?? config?.model ?? 'claude-sonnet-4-6';
  const rateLimit = localOverrides.rateLimit ?? config?.rate_limit?.toString() ?? '';
  const waitOnLimit = localOverrides.waitOnLimit ?? config?.wait_on_limit ?? true;
  const opusModel = localOverrides.opusModel ?? config?.opus_model ?? '';
  const sonnetModel = localOverrides.sonnetModel ?? config?.sonnet_model ?? '';
  const haikuModel = localOverrides.haikuModel ?? config?.haiku_model ?? '';

  const updateField = <K extends keyof typeof localOverrides>(
    key: K,
    value: (typeof localOverrides)[K]
  ) => {
    setLocalOverrides((prev) => ({ ...prev, [key]: value }));
  };

  // Batch update for presets
  const applyPreset = (preset: ModelPreset) => {
    setLocalOverrides((prev) => ({
      ...prev,
      model: preset.default,
      opusModel: preset.opus,
      sonnetModel: preset.sonnet,
      haikuModel: preset.haiku,
    }));
    toast.success(t('toasts.presetApplied', { name: preset.name }));
  };

  // Raw JSON content
  const rawJsonContent = useMemo(() => {
    if (rawJsonEdits !== null) return rawJsonEdits;
    if (rawSettings?.settings) return JSON.stringify(rawSettings.settings, null, 2);
    return '{\n  "env": {}\n}';
  }, [rawJsonEdits, rawSettings]);

  const handleRawJsonChange = useCallback((value: string) => {
    setRawJsonEdits(value);
  }, []);

  // Check if JSON is valid
  const isRawJsonValid = useMemo(() => {
    try {
      JSON.parse(rawJsonContent);
      return true;
    } catch {
      return false;
    }
  }, [rawJsonContent]);

  // Check for unsaved changes
  const hasChanges = useMemo(() => {
    const hasLocalChanges = Object.keys(localOverrides).length > 0;
    const hasJsonChanges =
      rawJsonEdits !== null && rawJsonEdits !== JSON.stringify(rawSettings?.settings, null, 2);
    return hasLocalChanges || hasJsonChanges;
  }, [localOverrides, rawJsonEdits, rawSettings]);

  // Validation state for missing required fields (informational warning)
  const currentSettingsForValidation = useMemo(() => {
    if (rawJsonEdits !== null) {
      try {
        return JSON.parse(rawJsonEdits);
      } catch {
        return rawSettings?.settings;
      }
    }
    return rawSettings?.settings;
  }, [rawJsonEdits, rawSettings?.settings]);

  const missingFields = useMemo(
    () => checkMissingFields(currentSettingsForValidation),
    [currentSettingsForValidation]
  );

  const normalizationWarnings = useMemo(
    () => dedupeWarnings([...(config?.warnings ?? []), ...(rawSettings?.warnings ?? [])]),
    [config?.warnings, rawSettings?.warnings]
  );

  const handleSave = async ({
    overwriteRawSettings = false,
  }: { overwriteRawSettings?: boolean } = {}) => {
    try {
      const saveWarnings: CopilotNormalizationWarning[] = [];

      // Save config changes
      if (Object.keys(localOverrides).length > 0) {
        const configResult = await updateConfigAsync({
          enabled,
          auto_start: autoStart,
          port,
          account_type: accountType,
          model: currentModel,
          rate_limit: rateLimit ? parseInt(rateLimit, 10) : null,
          wait_on_limit: waitOnLimit,
          opus_model: opusModel || undefined,
          sonnet_model: sonnetModel || undefined,
          haiku_model: haikuModel || undefined,
        });
        saveWarnings.push(...(configResult.warnings ?? []));
      }

      // Save raw JSON changes (no blocking validation - runtime uses defaults)
      let missing: string[] = [];
      if (rawJsonEdits !== null && isRawJsonValid) {
        const settingsToSave = JSON.parse(rawJsonContent);
        missing = checkMissingFields(settingsToSave);

        const saveResult = await saveRawSettingsAsync({
          settings: settingsToSave,
          expectedMtime: overwriteRawSettings ? undefined : rawSettings?.mtime,
        });
        saveWarnings.push(...(saveResult.warnings ?? []));
      }

      const uniqueWarnings = dedupeWarnings(saveWarnings);
      const descriptions: string[] = [];
      if (uniqueWarnings.length > 0) {
        descriptions.push(uniqueWarnings.map((warning) => warning.message).join(' '));
      }
      if (missing.length > 0) {
        descriptions.push(`Missing fields will use defaults: ${missing.join(', ')}`);
      }

      if (uniqueWarnings.length > 0) {
        toast.warning(t('toasts.settingsSavedWithAdjustments'), {
          description: descriptions.join(' '),
        });
      } else if (descriptions.length > 0) {
        toast.success(t('toasts.settingsSaved'), {
          description: descriptions.join(' '),
        });
      } else {
        toast.success(t('toasts.settingsSaved'));
      }

      // Clear local state
      setLocalOverrides({});
      setRawJsonEdits(null);
    } catch (error) {
      if (isApiConflictError(error)) {
        setConflictDialog(true);
      } else {
        toast.error(t('toasts.failedSaveSettings'));
      }
    }
  };

  const handleConflictResolve = async (overwrite: boolean) => {
    setConflictDialog(false);
    if (overwrite) {
      await handleSave({ overwriteRawSettings: true });
    } else {
      setRawJsonEdits(null);
    }
  };

  return {
    // Loading states
    configLoading,
    rawSettingsLoading,
    modelsLoading,
    isUpdating,
    isSavingRawSettings,

    // Data
    models,
    rawSettings,
    rawJsonContent,
    rawJsonEdits,

    // Computed values
    enabled,
    autoStart,
    port,
    accountType,
    currentModel,
    rateLimit,
    waitOnLimit,
    opusModel,
    sonnetModel,
    haikuModel,
    isRawJsonValid,
    hasChanges,
    normalizationWarnings,

    // Dialog state
    conflictDialog,

    // Actions
    updateField,
    applyPreset,
    handleRawJsonChange,
    handleSave,
    handleConflictResolve,
    refetchRawSettings,

    /** List of required env vars that are missing (empty if all present) - informational */
    missingRequiredFields: missingFields,
  };
}

