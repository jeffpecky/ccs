/**
 * Droid Editor Component
 * Split-view editor for Factory Droid CLI tool provider settings
 */

/* eslint-disable react-refresh/only-export-components */
import { useMemo } from 'react';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, Code2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCliproxyModels } from '@/hooks/use-cliproxy';
import { useDroidEditor } from './use-droid-editor';
import { CLIRawEditorSection } from './cli-raw-editor-section';
import { CLIProviderInfoTab } from './cli-provider-info-tab';
import { CLIProviderEditorHeader } from './cli-provider-editor-header';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FlexibleModelSelector } from '../provider-model-selector';
import type { CLIProviderEditorProps } from './types';
import type { ProviderCatalog } from '../provider-model-selector';
import type { CliproxyProviderRoutingHints } from '@/lib/api-client';

function DroidModelConfigTab({
  currentModel,
  subagentModel,
  providerModels,
  catalog,
  routing,
  onUpdateEnvValue,
}: {
  currentModel?: string;
  subagentModel?: string;
  providerModels: Array<{ id: string; owned_by: string }>;
  catalog?: ProviderCatalog;
  routing?: CliproxyProviderRoutingHints;
  onUpdateEnvValue: (key: string, value: string) => void;
}) {
  return (
    <ScrollArea className="flex-1">
      <div className="p-4 space-y-6">
        <div>
          <h3 className="text-sm font-medium mb-2">Model Mapping</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Configure which models to use for each role
          </p>
          <div className="space-y-4">
            <FlexibleModelSelector
              label="Default Model"
              description="Used when no specific role is requested"
              value={currentModel}
              onChange={(model) => onUpdateEnvValue('OPENAI_MODEL', model)}
              catalog={catalog}
              allModels={providerModels}
              routing={routing}
              hideRecommended={true}
            />
            <FlexibleModelSelector
              label="Subagent Model"
              description="Model used for spawned subagents (explorer, reviewer, etc.)"
              value={subagentModel}
              onChange={(model) => onUpdateEnvValue('OPENAI_SUB_AGENT_MODEL', model)}
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

export function DroidEditor({
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
    subagentModel,
    handleRawJsonChange,
    updateEnvValue,
    saveMutation,
    conflictDialog,
    handleConflictResolve,
    missingRequiredFields,
  } = useDroidEditor(provider, catalog, toolId);

  const { data: modelsData } = useCliproxyModels();
  const providerModels = useMemo(() => {
    if (!modelsData?.models) return [];
    return modelsData.models.map((m) => ({
      id: m.id,
      owned_by: m.owned_by,
    }));
  }, [modelsData]);

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
                  <DroidModelConfigTab
                    currentModel={currentModel}
                    subagentModel={subagentModel}
                    providerModels={providerModels}
                    catalog={catalog}
                    routing={routing}
                    onUpdateEnvValue={updateEnvValue}
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
              hideGlobalEnvIndicator
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
export { useDroidEditor } from './use-droid-editor';



