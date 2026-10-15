/**
 * Model Config Tab Content
 * Presets and model mapping configuration
 */

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Zap } from 'lucide-react';
import { TabsContent } from '@/components/ui/tabs';
import { useTranslation } from 'react-i18next';
import type { CopilotModel } from '@/hooks/use-copilot';
import { FREE_PRESETS, PAID_PRESETS } from './presets';
import { FlexibleModelSelector } from './model-selector';
import type { ModelPreset } from './types';

function formatCompactTokens(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return millions % 1 === 0 ? `${millions}M` : `${millions.toFixed(1)}M`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return thousands % 1 === 0 ? `${thousands}K` : `${thousands.toFixed(1)}K`;
  }
  return `${value}`;
}

function formatModelLimits(model?: CopilotModel): string | null {
  if (!model?.limits) return null;

  const parts: string[] = [];
  if (model.limits.maxPromptTokens) {
    parts.push(`prompt ${formatCompactTokens(model.limits.maxPromptTokens)}`);
  }
  if (model.limits.maxContextWindowTokens) {
    parts.push(`context ${formatCompactTokens(model.limits.maxContextWindowTokens)}`);
  }
  if (model.limits.maxOutputTokens) {
    parts.push(`output ${formatCompactTokens(model.limits.maxOutputTokens)}`);
  }

  return parts.length > 0 ? parts.join(' | ') : null;
}

interface ModelConfigTabProps {
  currentModel: string;
  opusModel: string;
  sonnetModel: string;
  haikuModel: string;
  models: CopilotModel[];
  modelsLoading: boolean;
  onApplyPreset: (preset: ModelPreset) => void;
  onUpdateModel: (model: string) => void;
  onUpdateOpusModel: (model: string) => void;
  onUpdateSonnetModel: (model: string) => void;
  onUpdateHaikuModel: (model: string) => void;
}

export function ModelConfigTab({
  currentModel,
  opusModel,
  sonnetModel,
  haikuModel,
  models,
  modelsLoading,
  onApplyPreset,
  onUpdateModel,
  onUpdateOpusModel,
  onUpdateSonnetModel,
  onUpdateHaikuModel,
}: ModelConfigTabProps) {
  const { t } = useTranslation();
  const mappedModelLimits = [
    { label: 'Default', id: currentModel },
    { label: 'Opus', id: opusModel || currentModel },
    { label: 'Sonnet', id: sonnetModel || currentModel },
    { label: 'Haiku', id: haikuModel || currentModel },
  ]
    .map(({ label, id }) => {
      const model = models.find((entry) => entry.id === id);
      const limits = formatModelLimits(model);
      return limits ? { label, id, limits } : null;
    })
    .filter((entry): entry is { label: string; id: string; limits: string } => entry !== null);

  return (
    <TabsContent
      value="config"
      className="flex-1 mt-0 border-0 p-0 data-[state=inactive]:hidden flex flex-col overflow-hidden"
    >
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Quick Presets */}
          <div>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              {t('providerEditor.presets')}
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              {t('copilotConfigForm.modelMapping')}
            </p>

            {/* Free Tier Presets */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Badge
                  variant="outline"
                  className="text-[10px] bg-green-100 text-green-700 border-green-200"
                >
                  {/* TODO i18n: missing key for 'Free Tier' */}
                  Free Tier
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  {t('copilotConfigForm.noPremiumUsage')}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {FREE_PRESETS.map((preset) => (
                  <Button
                    key={preset.name}
                    variant="outline"
                    size="sm"
                    className="text-xs h-7 gap-1"
                    onClick={() => onApplyPreset(preset)}
                    title={preset.description}
                  >
                    <Zap className="w-3 h-3 text-green-600" />
                    {preset.name}
                  </Button>
                ))}
              </div>
            </div>

            {/* Paid Tier Presets */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge
                  variant="outline"
                  className="text-[10px] bg-blue-100 text-blue-700 border-blue-200"
                >
                  {/* TODO i18n: missing key for 'Pro+ Required' */}
                  Pro+ Required
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  {/* TODO i18n: missing key for 'Uses premium request quota' */}
                  Uses premium request quota
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {PAID_PRESETS.map((preset) => (
                  <Button
                    key={preset.name}
                    variant="outline"
                    size="sm"
                    className="text-xs h-7 gap-1"
                    onClick={() => onApplyPreset(preset)}
                    title={preset.description}
                  >
                    <Zap className="w-3 h-3" />
                    {preset.name}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <Separator />

          {/* Model Mapping */}
          <div>
            <h3 className="text-sm font-medium mb-2">{t('copilotConfigForm.modelMapping')}</h3>
            <p className="text-xs text-muted-foreground mb-4">
              {/* TODO i18n: missing key for model mapping description */}
              Configure which models to use for each tier
            </p>
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
              <p className="font-medium">{t('copilotConfigForm.githubCopilotControls')}</p>
              <p className="mt-1">
                {/* TODO i18n: missing key for 'CCS can switch Copilot models...' */}
                CCS can switch Copilot models, but it cannot increase the provider&apos;s max prompt
                or context window.
              </p>
              {mappedModelLimits.length > 0 ? (
                <div className="mt-2 space-y-1 text-[11px] font-mono">
                  {mappedModelLimits.map((entry) => (
                    <p key={`${entry.label}-${entry.id}`}>
                      {entry.label}: {entry.id} ({entry.limits})
                    </p>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[11px] font-mono">
                  {/* TODO i18n: missing key for 'Start the daemon to inspect...' */}
                  Start the daemon to inspect live model limits from GitHub Copilot metadata.
                </p>
              )}
            </div>
            <div className="space-y-4">
              <FlexibleModelSelector
                label="Default Model"
                description="Used when no specific tier is requested"
                value={currentModel}
                onChange={onUpdateModel}
                models={models}
                disabled={modelsLoading}
              />
              <FlexibleModelSelector
                label="Opus (Most capable)"
                description="For complex reasoning tasks"
                value={opusModel || currentModel}
                onChange={onUpdateOpusModel}
                models={models}
                disabled={modelsLoading}
              />
              <FlexibleModelSelector
                label="Sonnet (Balanced)"
                description="Balance of speed and capability"
                value={sonnetModel || currentModel}
                onChange={onUpdateSonnetModel}
                models={models}
                disabled={modelsLoading}
              />
              <FlexibleModelSelector
                label="Haiku (Fast)"
                description="Quick responses for simple tasks"
                value={haikuModel || currentModel}
                onChange={onUpdateHaikuModel}
                models={models}
                disabled={modelsLoading}
              />
            </div>
          </div>
        </div>
      </ScrollArea>
    </TabsContent>
  );
}
