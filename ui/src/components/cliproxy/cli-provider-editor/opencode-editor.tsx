/**
 * OpenCode Tool Editor Component
 * Split-view editor for OpenCode CLI tool provider settings
 */

/* eslint-disable react-refresh/only-export-components */
import { useMemo } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, Code2, Star, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCliproxyModels, useAiProviderModels } from '@/hooks/use-cliproxy';
import { useOpenCodeEditor } from './use-opencode-editor';
import { CLIRawEditorSection } from './cli-raw-editor-section';
import { CLIProviderInfoTab } from './cli-provider-info-tab';
import { CLIProviderEditorHeader } from './cli-provider-editor-header';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FlexibleModelSelector } from '../provider-model-selector';
import type { CLIProviderEditorProps } from './types';
import type { ProviderCatalog } from '../provider-model-selector';
import type { CliproxyProviderRoutingHints } from '@/lib/api-client';

export function OpenCodeModelConfigTab({
  currentModel,
  selectedModels,
  subagentModel,
  providerModels,
  catalog,
  routing,
  onUpdateEnvValue,
  onAddModel,
  onRemoveModel,
  onSetActiveModel,
}: {
  currentModel?: string;
  selectedModels: string[];
  subagentModel?: string;
  providerModels: Array<{ id: string; owned_by: string }>;
  catalog?: ProviderCatalog;
  routing?: CliproxyProviderRoutingHints;
  onUpdateEnvValue: (key: string, value: string) => void;
  onAddModel: (model: string) => void;
  onRemoveModel: (model: string) => void;
  onSetActiveModel: (model: string) => void;
}) {
  const handleModelSelect = (model: string) => {
    onAddModel(model);
    onSetActiveModel(model);
  };
  return (
    <ScrollArea className="flex-1">
      <div className="p-4 space-y-6">
        <div>
          <h3 className="text-sm font-medium mb-2">Model Mapping</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Configure which models to use for each role
          </p>
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="text-sm font-medium">Models</div>
              <div className="flex flex-wrap gap-2" aria-label="Selected models">
                {selectedModels.length === 0 ? (
                  <span className="text-xs text-muted-foreground">No models selected</span>
                ) : null}
                {selectedModels.map((model) => (
                  <div
                    key={model}
                    className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${model === currentModel ? 'border-primary text-primary' : 'border-border'}`}
                  >
                    <button
                      type="button"
                      className="flex items-center gap-1"
                      onClick={() => onSetActiveModel(model)}
                      aria-label={`Set ${model} active`}
                    >
                      {model === currentModel ? <Star className="h-3 w-3 fill-current" /> : null}
                      {model}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveModel(model)}
                      aria-label={`Remove ${model}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <FlexibleModelSelector
              label="Add Model"
              description="Add another model to OpenCode"
              value={currentModel}
              onChange={handleModelSelect}
              catalog={catalog}
              allModels={providerModels}
              routing={routing}
              hideRecommended={true}
            />
            <FlexibleModelSelector
              label="Subagent Model"
              description="Model used for spawned subagents (explorer, reviewer, etc.)"
              value={subagentModel}
              onChange={(model) => onUpdateEnvValue('OPENCODE_SUB_AGENT_MODEL', model)}
              catalog={catalog}
              allModels={providerModels}
              routing={routing}
              hideRecommended={true}
            />
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}

export function OpenCodeEditor({
  provider,
  toolId,
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
  const { t } = useTranslation();

  const {
    data,
    isLoading,
    refetch,
    rawJsonContent,
    rawJsonEdits,
    isRawJsonValid,
    hasChanges,
    currentModel,
    selectedModels,
    subagentModel,
    addModel,
    removeModel,
    setActiveModel,
    handleRawJsonChange,
    updateEnvValue,
    saveMutation,
    conflictDialog,
    handleConflictResolve,
    missingRequiredFields,
  } = useOpenCodeEditor(provider, catalog, toolId, port);

  const { data: modelsData } = useCliproxyModels();
  const { data: nvidiaModels } = useAiProviderModels('nvidia-api-key');
  const { data: cloudflareModels } = useAiProviderModels('cloudflare-api-key');
  const { data: openrouterModels } = useAiProviderModels('openrouter-api-key');
  const providerModels = useMemo(() => {
    const base = modelsData?.models ?? [];
    const extra = [
      ...(nvidiaModels?.models ?? []),
      ...(cloudflareModels?.models ?? []),
      ...(openrouterModels?.models ?? []),
    ];
    const seen = new Set(base.map((m) => m.id));
    const merged = [...base];
    for (const m of extra) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        merged.push({ id: m.id, owned_by: m.owned_by, object: 'model', created: 0 });
      }
    }
    return merged.map((m) => ({ id: m.id, owned_by: m.owned_by }));
  }, [modelsData, nvidiaModels, cloudflareModels, openrouterModels]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <CLIProviderEditorHeader
        provider={provider}
        displayName={displayName}
        logoProvider={logoProvider}
        toolId={toolId}
        data={data}
        isLoading={isLoading}
        hasChanges={hasChanges}
        isRawJsonValid={isRawJsonValid && Boolean(currentModel)}
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
                  <OpenCodeModelConfigTab
                    currentModel={currentModel}
                    selectedModels={selectedModels}
                    subagentModel={subagentModel}
                    providerModels={providerModels}
                    catalog={catalog}
                    routing={routing}
                    onUpdateEnvValue={updateEnvValue}
                    onAddModel={addModel}
                    onRemoveModel={removeModel}
                    onSetActiveModel={setActiveModel}
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
              profileEnv={data?.settings?.model}
              missingRequiredFields={missingRequiredFields}
              hideGlobalEnvIndicator
              toolName="OpenCode"
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
    </div>
  );
}

export type { CLIProviderEditorProps } from './types';
export { CLIRawEditorSection } from './cli-raw-editor-section';
export { CLIProviderInfoTab } from './cli-provider-info-tab';
export { CLIProviderEditorHeader } from './cli-provider-editor-header';
export { CLIModelConfigTab } from './cli-model-config-tab';
export { useOpenCodeEditor } from './use-opencode-editor';
