/**
 * CLI Provider Editor Component
 * Split-view editor for CLI tool provider settings
 */

/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, Code2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  useCliproxyModels,
  usePresets,
  useCreatePreset,
  useDeletePreset,
} from '@/hooks/use-cliproxy';
import { CLIPROXY_DEFAULT_PORT } from '@/lib/preset-utils';
import { isDeniedAgyModelId } from '@/lib/utils';
import i18n from '@/lib/i18n';
import { useTranslation } from 'react-i18next';
import { useCLIProviderEditor } from './use-cli-provider-editor';
import { CLICustomPresetDialog } from './cli-custom-preset-dialog';
import { CLIRawEditorSection } from './cli-raw-editor-section';
import { CLIProviderInfoTab } from './cli-provider-info-tab';
import { CLIProviderEditorHeader } from './cli-provider-editor-header';
import { CLIModelConfigTab } from './cli-model-config-tab';
import type { CLIProviderEditorProps, ModelMappingValues } from './types';

export function CLIProviderEditor({
  provider,
  displayName,
  authStatus,
  catalog,
  routing,
  logoProvider,
  baseProvider,
  isRemoteMode,
  port,
  defaultTarget,
  topNotice,
}: CLIProviderEditorProps) {
  const [customPresetOpen, setCustomPresetOpen] = useState(false);
  const { t } = useTranslation();

  const { data: modelsData } = useCliproxyModels();
  const { data: presetsData } = usePresets(provider);
  const createPresetMutation = useCreatePreset();
  const deletePresetMutation = useDeletePreset();

  const modelFilterProvider = baseProvider || provider;
  const isAgyProvider = modelFilterProvider.toLowerCase() === 'agy';

  const savedPresets = useMemo(() => {
    const presets = presetsData?.presets || [];
    if (!isAgyProvider) return presets;

    return presets.filter(
      (preset) =>
        !isDeniedAgyModelId(preset.default) &&
        !isDeniedAgyModelId(preset.opus) &&
        !isDeniedAgyModelId(preset.sonnet) &&
        !isDeniedAgyModelId(preset.haiku)
    );
  }, [isAgyProvider, presetsData?.presets]);

  const providerModels = useMemo(() => {
    if (!modelsData?.models) return [];
    const ownerMap: Record<string, string[]> = {
      gemini: ['google'],
      agy: ['antigravity'],
      codex: ['openai'],
      cursor: ['cursor'],
      gitlab: ['gitlab', 'duo'],
      codebuddy: ['codebuddy'],
      qwen: ['alibaba', 'qwen'],
      iflow: ['iflow'],
      kilo: ['kilo'],
      qoder: ['qoder'],
      kiro: ['kiro', 'aws'],
      ghcp: ['github', 'copilot'],
      kimi: ['kimi', 'moonshot'],
    };
    const owners = ownerMap[modelFilterProvider.toLowerCase()] || [
      modelFilterProvider.toLowerCase(),
    ];
    return modelsData.models.filter((m) => {
      if (!owners.some((o) => m.owned_by.toLowerCase().includes(o))) return false;
      if (!isAgyProvider) return true;
      return !isDeniedAgyModelId(m.id);
    });
  }, [isAgyProvider, modelsData, modelFilterProvider]);

  const providerRoute = (baseProvider || provider).toLowerCase();

  const {
    data,
    isLoading,
    refetch,
    rawJsonContent,
    rawJsonEdits,
    isRawJsonValid,
    hasChanges,
    currentModel,
    opusModel,
    sonnetModel,
    haikuModel,
    extendedContextEnabled,
    toggleExtendedContext,
    handleRawJsonChange,
    updateEnvValue,
    updateEnvValues,
    saveMutation,
    conflictDialog,
    handleConflictResolve,
    missingRequiredFields,
  } = useCLIProviderEditor(provider, catalog);

  // Fetch effective API key for presets (uses configured value, not hardcoded)
  const { data: authTokens } = useQuery<{ apiKey: { value: string } }>({
    queryKey: ['auth-tokens-raw'],
    queryFn: async () => {
      const response = await fetch('/api/settings/auth/tokens/raw');
      if (!response.ok) return { apiKey: { value: 'ccs-internal-managed' } };
      return response.json();
    },
    staleTime: 60000, // Cache for 1 minute
  });
  const effectiveApiKey = authTokens?.apiKey?.value ?? 'ccs-internal-managed';

  const handleApplyPreset = (updates: Record<string, string>) => {
    if (
      isAgyProvider &&
      [
        updates.ANTHROPIC_MODEL,
        updates.ANTHROPIC_DEFAULT_OPUS_MODEL,
        updates.ANTHROPIC_DEFAULT_SONNET_MODEL,
        updates.ANTHROPIC_DEFAULT_HAIKU_MODEL,
      ].some((modelId) => typeof modelId === 'string' && isDeniedAgyModelId(modelId))
    ) {
      toast.error(t('providerEditor.agyDenylist'));
      return;
    }

    const effectivePort = port ?? CLIPROXY_DEFAULT_PORT;
    updateEnvValues({
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${effectivePort}/api/provider/${providerRoute}`,
      ANTHROPIC_AUTH_TOKEN: effectiveApiKey,
      ...updates,
    });
    toast.success(`Applied "${updates.ANTHROPIC_MODEL?.split('/').pop() || 'preset'}" preset`);
  };

  const handleCustomPresetApply = (values: ModelMappingValues, presetName?: string) => {
    if (
      isAgyProvider &&
      [values.default, values.opus, values.sonnet, values.haiku].some((modelId) =>
        isDeniedAgyModelId(modelId)
      )
    ) {
      toast.error(t('providerEditor.agyDenylist'));
      return;
    }

    const effectivePort = port ?? CLIPROXY_DEFAULT_PORT;
    updateEnvValues({
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${effectivePort}/api/provider/${providerRoute}`,
      ANTHROPIC_AUTH_TOKEN: effectiveApiKey,
      ANTHROPIC_MODEL: values.default,
      ANTHROPIC_DEFAULT_OPUS_MODEL: values.opus,
      ANTHROPIC_DEFAULT_SONNET_MODEL: values.sonnet,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: values.haiku,
    });
    toast.success(`Applied ${presetName ? `"${presetName}"` : 'custom'} preset`);
    setCustomPresetOpen(false);
  };

  const handleCustomPresetSave = (values: ModelMappingValues, presetName?: string) => {
    if (!presetName) {
      toast.error(i18n.t('commonToast.enterPresetName'));
      return;
    }
    if (
      isAgyProvider &&
      [values.default, values.opus, values.sonnet, values.haiku].some((modelId) =>
        isDeniedAgyModelId(modelId)
      )
    ) {
      toast.error(t('providerEditor.agyDenylist'));
      return;
    }
    createPresetMutation.mutate({ profile: provider, data: { name: presetName, ...values } });
    setCustomPresetOpen(false);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <CLIProviderEditorHeader
        provider={provider}
        displayName={displayName}
        logoProvider={logoProvider}
        data={data}
        isLoading={isLoading}
        hasChanges={hasChanges}
        isRawJsonValid={isRawJsonValid}
        isSaving={saveMutation.isPending}
        isRemoteMode={isRemoteMode}
        port={port}
        onRefetch={refetch}
        onSave={() => saveMutation.mutate()}
      />
      {topNotice ? <div className="border-b bg-muted/10 px-4 py-3">{topNotice}</div> : null}

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <span className="ml-3 text-muted-foreground">{t('providerEditor.loadingSettings')}</span>
        </div>
      ) : (
        <div className="min-h-0 flex-1 grid grid-cols-[40%_60%] divide-x overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-muted/5">
            <Tabs defaultValue="config" className="h-full flex flex-col">
              <div className="px-4 pt-4 shrink-0">
                <TabsList className="w-full">
                  <TabsTrigger value="config" className="flex-1">
                    Model Config
                  </TabsTrigger>
                  <TabsTrigger value="info" className="flex-1">
                    Info & Usage
                  </TabsTrigger>
                </TabsList>
              </div>
              <div className="flex-1 overflow-hidden flex flex-col">
                <TabsContent
                  value="config"
                  className="flex-1 mt-0 border-0 p-0 data-[state=inactive]:hidden flex flex-col overflow-hidden"
                >
                  <CLIModelConfigTab
                    provider={provider}
                    catalog={catalog}
                    savedPresets={savedPresets}
                    currentModel={currentModel}
                    opusModel={opusModel}
                    sonnetModel={sonnetModel}
                    haikuModel={haikuModel}
                    providerModels={providerModels}
                    routing={routing}
                    extendedContextEnabled={extendedContextEnabled}
                    onExtendedContextToggle={toggleExtendedContext}
                    onApplyPreset={handleApplyPreset}
                    onUpdateEnvValue={updateEnvValue}
                    onOpenCustomPreset={() => setCustomPresetOpen(true)}
                    onDeletePreset={(name) =>
                      deletePresetMutation.mutate({ profile: provider, name })
                    }
                    isDeletePending={deletePresetMutation.isPending}
                  />
                </TabsContent>
                <TabsContent
                  value="info"
                  className="h-full mt-0 border-0 p-0 data-[state=inactive]:hidden"
                >
                  <CLIProviderInfoTab
                    provider={provider}
                    displayName={displayName}
                    baseProvider={baseProvider}
                    defaultTarget={defaultTarget}
                    data={data}
                    authStatus={authStatus}
                    supportsModelConfig={Boolean(catalog)}
                  />
                </TabsContent>
              </div>
            </Tabs>
          </div>

          <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            <div className="px-6 py-2 bg-muted/30 border-b flex items-center gap-2 shrink-0 h-[45px]">
              <Code2 className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">
                {t('rawEditorSection.rawConfig')} (JSON)
              </span>
            </div>
            <CLIRawEditorSection
              rawJsonContent={rawJsonContent}
              isRawJsonValid={isRawJsonValid}
              rawJsonEdits={rawJsonEdits}
              onRawJsonChange={handleRawJsonChange}
              profileEnv={data?.settings?.env}
              missingRequiredFields={missingRequiredFields}
            />
          </div>
        </div>
      )}

      <ConfirmDialog
        open={conflictDialog}
        title="File Modified Externally"
        description="This settings file was modified by another process. Overwrite with your changes or discard?"
        confirmText="Overwrite"
        variant="destructive"
        onConfirm={() => handleConflictResolve(true)}
        onCancel={() => handleConflictResolve(false)}
      />

      <CLICustomPresetDialog
        open={customPresetOpen}
        onClose={() => setCustomPresetOpen(false)}
        currentValues={{
          default: currentModel || '',
          opus: opusModel || '',
          sonnet: sonnetModel || '',
          haiku: haikuModel || '',
        }}
        onApply={handleCustomPresetApply}
        onSave={handleCustomPresetSave}
        isSaving={createPresetMutation.isPending}
        catalog={catalog}
        allModels={providerModels}
        routing={routing}
      />
    </div>
  );
}

export type { CLIProviderEditorProps, ModelMappingValues } from './types';
export { UsageCommand } from './usage-command';
export { CLICustomPresetDialog } from './cli-custom-preset-dialog';
export { CLIModelConfigSection } from './cli-model-config-section';
export { CLIRawEditorSection } from './cli-raw-editor-section';
export { CLIProviderInfoTab } from './cli-provider-info-tab';
export { CLIProviderEditorHeader } from './cli-provider-editor-header';
export { CLIModelConfigTab } from './cli-model-config-tab';
export { useCLIProviderEditor } from './use-cli-provider-editor';
