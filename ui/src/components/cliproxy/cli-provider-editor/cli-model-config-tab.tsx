/**
 * CLI Model Config Tab
 * Contains model config section and provider-specific settings
 */

import { ScrollArea } from '@/components/ui/scroll-area';
import { CLIModelConfigSection } from './cli-model-config-section';
import type { ProviderCatalog } from '../provider-model-selector';
import type { CliproxyProviderRoutingHints } from '@/lib/api-client';

interface CLIModelConfigTabProps {
  provider: string;
  toolId?: string;
  catalog?: ProviderCatalog;
  savedPresets: Array<{
    name: string;
    default: string;
    opus: string;
    sonnet: string;
    haiku: string;
  }>;
  currentModel?: string;
  opusModel?: string;
  sonnetModel?: string;
  haikuModel?: string;
  providerModels: Array<{ id: string; owned_by: string }>;
  routing?: CliproxyProviderRoutingHints;
  extendedContextEnabled?: boolean;
  onExtendedContextToggle?: (enabled: boolean) => void;
  onApplyPreset: (updates: Record<string, string>) => void;
  onUpdateEnvValue: (key: string, value: string) => void;
  onOpenCustomPreset: () => void;
  onDeletePreset: (name: string) => void;
  isDeletePending?: boolean;
}

export function CLIModelConfigTab({
  provider,
  toolId,
  catalog,
  savedPresets,
  currentModel,
  opusModel,
  sonnetModel,
  haikuModel,
  providerModels,
  routing,
  extendedContextEnabled,
  onExtendedContextToggle,
  onApplyPreset,
  onUpdateEnvValue,
  onOpenCustomPreset,
  onDeletePreset,
  isDeletePending,
}: CLIModelConfigTabProps) {
  return (
    <ScrollArea className="flex-1">
      <div className="p-4 space-y-6">
        <CLIModelConfigSection
          catalog={catalog}
          savedPresets={savedPresets}
          currentModel={currentModel}
          opusModel={opusModel}
          sonnetModel={sonnetModel}
          haikuModel={haikuModel}
          providerModels={providerModels}
          routing={routing}
          provider={provider}
          toolId={toolId}
          extendedContextEnabled={extendedContextEnabled}
          onExtendedContextToggle={onExtendedContextToggle}
          onApplyPreset={onApplyPreset}
          onUpdateEnvValue={onUpdateEnvValue}
          onOpenCustomPreset={onOpenCustomPreset}
          onDeletePreset={onDeletePreset}
          isDeletePending={isDeletePending}
        />
      </div>
    </ScrollArea>
  );
}

