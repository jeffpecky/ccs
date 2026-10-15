/**
 * Copilot Config Form
 *
 * Form for configuring GitHub Copilot integration settings.
 * Split-view layout matching CLIProxy provider editor:
 * - Left (50%): Friendly UI with model mapping selectors
 * - Right (50%): Raw JSON editor for copilot.settings.json
 */

/* eslint-disable react-refresh/only-export-components */
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertTriangle, Code2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';

import { HeaderSection } from './header-section';
import { ModelConfigTab } from './model-config-tab';
import { SettingsTab } from './settings-tab';
import { InfoTab } from './info-tab';
import { RawEditorSection } from './raw-editor-section';
import { useCopilotConfigForm } from './use-copilot-config-form';

export function CopilotConfigForm() {
  const { t } = useTranslation();
  const {
    configLoading,
    rawSettingsLoading,
    modelsLoading,
    isUpdating,
    isSavingRawSettings,
    models,
    rawSettings,
    rawJsonContent,
    rawJsonEdits,
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
    conflictDialog,
    updateField,
    applyPreset,
    handleRawJsonChange,
    handleSave,
    handleConflictResolve,
    refetchRawSettings,
    missingRequiredFields,
  } = useCopilotConfigForm();

  if (configLoading || rawSettingsLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <HeaderSection
        rawSettings={rawSettings}
        rawSettingsLoading={rawSettingsLoading}
        isUpdating={isUpdating}
        isSavingRawSettings={isSavingRawSettings}
        hasChanges={hasChanges}
        isRawJsonValid={isRawJsonValid}
        onRefresh={() => refetchRawSettings()}
        onSave={handleSave}
      />

      {normalizationWarnings.length > 0 && (
        <div className="px-6 pt-4 shrink-0">
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t('copilotConfigForm.deprecatedModels')}</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                {/* TODO i18n: missing key copilotConfigForm.deprecatedModelsDesc */}
                Loading this page did not rewrite your files. Save the Copilot configuration to
                persist these replacements.
              </p>
              <div className="space-y-1">
                {normalizationWarnings.map((warning) => (
                  <p key={warning.message}>{warning.message}</p>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Split Layout */}
      <div className="flex-1 flex divide-x overflow-hidden">
        {/* Left Column: Friendly UI */}
        <div className="w-[540px] shrink-0 flex flex-col overflow-hidden bg-muted/5">
          <div className="h-full flex flex-col">
            <Tabs defaultValue="config" className="h-full flex flex-col">
              <div className="px-4 pt-4 shrink-0">
                <TabsList className="w-full">
                  <TabsTrigger value="config" className="flex-1">
                    {/* TODO i18n: missing key copilotConfigForm.modelConfig */}
                    Model Config
                  </TabsTrigger>
                  <TabsTrigger value="settings" className="flex-1">
                    {/* TODO i18n: missing key copilotConfigForm.settings */}
                    Settings
                  </TabsTrigger>
                  <TabsTrigger value="info" className="flex-1">
                    {/* TODO i18n: missing key copilotConfigForm.info */}
                    Info
                  </TabsTrigger>
                </TabsList>
              </div>

              <div className="flex-1 overflow-hidden flex flex-col">
                <ModelConfigTab
                  currentModel={currentModel}
                  opusModel={opusModel}
                  sonnetModel={sonnetModel}
                  haikuModel={haikuModel}
                  models={models}
                  modelsLoading={modelsLoading}
                  onApplyPreset={applyPreset}
                  onUpdateModel={(model) => updateField('model', model)}
                  onUpdateOpusModel={(model) => updateField('opusModel', model)}
                  onUpdateSonnetModel={(model) => updateField('sonnetModel', model)}
                  onUpdateHaikuModel={(model) => updateField('haikuModel', model)}
                />

                <SettingsTab
                  enabled={enabled}
                  autoStart={autoStart}
                  port={port}
                  accountType={accountType}
                  rateLimit={rateLimit}
                  waitOnLimit={waitOnLimit}
                  onUpdateEnabled={(v) => updateField('enabled', v)}
                  onUpdateAutoStart={(v) => updateField('autoStart', v)}
                  onUpdatePort={(v) => updateField('port', v)}
                  onUpdateAccountType={(v) => updateField('accountType', v)}
                  onUpdateRateLimit={(v) => updateField('rateLimit', v)}
                  onUpdateWaitOnLimit={(v) => updateField('waitOnLimit', v)}
                />

                <InfoTab rawSettings={rawSettings} />
              </div>
            </Tabs>
          </div>
        </div>

        {/* Right Column: Raw Editor */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="px-6 py-2 bg-muted/30 border-b flex items-center gap-2 shrink-0 h-[45px]">
            <Code2 className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">
              Raw Configuration (JSON)
            </span>
          </div>
          <RawEditorSection
            rawJsonContent={rawJsonContent}
            isRawJsonValid={isRawJsonValid}
            rawJsonEdits={rawJsonEdits}
            rawSettingsEnv={rawSettings?.settings?.env as Record<string, string> | undefined}
            onChange={handleRawJsonChange}
            missingRequiredFields={missingRequiredFields}
          />
        </div>
      </div>

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

// Re-export components for external use
export { FlexibleModelSelector } from './model-selector';
export { UsageCommand } from './usage-command';
export { FREE_PRESETS, PAID_PRESETS } from './presets';
export { ModelConfigTab } from './model-config-tab';
export { SettingsTab } from './settings-tab';
export { InfoTab } from './info-tab';
export { RawEditorSection } from './raw-editor-section';
export { HeaderSection } from './header-section';
export { useCopilotConfigForm } from './use-copilot-config-form';
export type { ModelPreset, FlexibleModelSelectorProps } from './types';
