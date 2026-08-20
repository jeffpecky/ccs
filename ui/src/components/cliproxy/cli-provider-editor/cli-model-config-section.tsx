/**
 * CLI Model Config Section
 * Presets and model mapping configuration UI
 */

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Sparkles, Zap, Star, X, Plus } from 'lucide-react';
import { FlexibleModelSelector } from '../provider-model-selector';
import { ExtendedContextToggle } from '../extended-context-toggle';
import { stripExtendedContextSuffix } from '@/lib/extended-context-utils';
import { findCatalogModel, getResolvedCatalogModels } from '@/lib/model-catalogs';
import type { ModelConfigSectionProps } from './types';
import { useTranslation } from 'react-i18next';

type CatalogPresetModel = NonNullable<ModelConfigSectionProps['catalog']>['models'][number];

function getPresetUpdates(
  model: CatalogPresetModel,
  toPreferredModelId: (modelId: string) => string
): Record<string, string> {
  const mapping = model.presetMapping || {
    default: model.id,
    opus: model.id,
    sonnet: model.id,
    haiku: model.id,
  };

  return {
    ANTHROPIC_MODEL: toPreferredModelId(mapping.default),
    ANTHROPIC_DEFAULT_OPUS_MODEL: toPreferredModelId(mapping.opus),
    ANTHROPIC_DEFAULT_SONNET_MODEL: toPreferredModelId(mapping.sonnet),
    ANTHROPIC_DEFAULT_HAIKU_MODEL: toPreferredModelId(mapping.haiku),
  };
}

// Tools that use Claude-style model mapping (Default, Opus, Sonnet, Haiku)
const CLAUDE_STYLE_TOOLS = ['claude-code'];

// Tools that use simple model list + subagent (OpenCode, Codex, etc.)
const SIMPLE_MODEL_TOOLS = ['opencode', 'codex', 'open-claw', 'hermes-agent'];

export function CLIModelConfigSection({
  catalog,
  savedPresets,
  currentModel,
  opusModel,
  sonnetModel,
  haikuModel,
  providerModels,
  routing,
  provider,
  extendedContextEnabled,
  onExtendedContextToggle,
  onApplyPreset,
  onUpdateEnvValue,
  onOpenCustomPreset,
  onDeletePreset,
  isDeletePending,
}: ModelConfigSectionProps) {
  const { t } = useTranslation();
  const pinningReady = (routing?.models ?? []).some((hint) => hint.pinnedAvailable);
  const routingHintMap = useMemo(
    () =>
      new Map((routing?.models ?? []).map((hint) => [hint.modelId.toLowerCase(), hint] as const)),
    [routing]
  );
  const toPreferredModelId = (modelId: string): string =>
    routingHintMap.get(modelId.toLowerCase())?.recommendedModelId ?? modelId;

  const extendedContextModels = useMemo(() => {
    if (!catalog) return [];

    const selectedModels = [currentModel, opusModel, sonnetModel, haikuModel]
      .filter((modelId): modelId is string => Boolean(modelId))
      .map((modelId) => stripExtendedContextSuffix(modelId));

    const uniqueIds = [...new Set(selectedModels)];
    return uniqueIds
      .map((modelId) => findCatalogModel(catalog.provider, modelId, catalog))
      .filter((model): model is NonNullable<typeof model> => Boolean(model?.extendedContext));
  }, [catalog, currentModel, opusModel, sonnetModel, haikuModel]);

  const resolvedCatalogModels = useMemo(
    () => getResolvedCatalogModels(catalog, providerModels),
    [catalog, providerModels]
  );

  const presetGroups = useMemo(() => {
    const presetModels = resolvedCatalogModels.filter((model) => model.presetMapping);
    if (presetModels.length === 0) return [];

    const hasPaidPresets = presetModels.some((model) => model.tier === 'paid');
    if (!hasPaidPresets) {
      return [{ key: 'default', models: presetModels.slice(0, 4) }];
    }

    return [
      {
        key: 'free',
        label: 'Free Tier',
        description: 'Available on free or paid plans',
        badgeClassName: 'text-[10px] bg-green-100 text-green-700 border-green-200',
        iconClassName: 'text-green-600',
        models: presetModels.filter((model) => model.tier !== 'paid'),
      },
      {
        key: 'paid',
        label: 'Paid Tier',
        description: 'Requires paid access',
        badgeClassName: 'text-[10px] bg-amber-100 text-700 border-amber-200',
        iconClassName: 'text-amber-700',
        models: presetModels.filter((model) => model.tier === 'paid'),
      },
    ].filter((group) => group.models.length > 0);
  }, [resolvedCatalogModels]);

  const showPresets = presetGroups.length > 0 || savedPresets.length > 0;
  const isSimpleModel = SIMPLE_MODEL_TOOLS.includes(provider);

  // Simple model list UI for OpenCode, Codex, etc.
  if (isSimpleModel) {
    return <SimpleModelConfigUI
      currentModel={currentModel}
      providerModels={providerModels}
      catalog={catalog}
      routing={routing}
      onUpdateEnvValue={onUpdateEnvValue}
    />;
  }

  // Claude-style UI (Default, Opus, Sonnet, Haiku)
  return (
    <>
      {/* Quick Presets */}
      {showPresets && (
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            Presets
          </h3>
          <p className="text-xs text-muted-foreground mb-3">{t('providerEditor.presets')}</p>
          <div className="space-y-4">
            {presetGroups.map((group) => (
              <div key={group.key}>
                {'label' in group && group.label && (
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className={group.badgeClassName}>
                      {group.label}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">{group.description}</span>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {group.models.map((model) => (
                    <Button
                      key={model.id}
                      variant="outline"
                      size="sm"
                      className="text-xs h-7 gap-1"
                      onClick={() => onApplyPreset(getPresetUpdates(model, toPreferredModelId))}
                    >
                      <Zap
                        className={`w-3 h-3 ${'iconClassName' in group ? group.iconClassName : ''}`}
                      />
                      {model.name}
                    </Button>
                  ))}
                </div>
              </div>
            ))}

            <div className="flex flex-wrap gap-2">
              {/* User saved presets */}
              {savedPresets.map((preset) => (
                <div key={preset.name} className="group relative">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="text-xs h-7 gap-1 pr-6"
                    onClick={() => {
                      onApplyPreset({
                        ANTHROPIC_MODEL: toPreferredModelId(preset.default),
                        ANTHROPIC_DEFAULT_OPUS_MODEL: toPreferredModelId(preset.opus),
                        ANTHROPIC_DEFAULT_SONNET_MODEL: toPreferredModelId(preset.sonnet),
                        ANTHROPIC_DEFAULT_HAIKU_MODEL: toPreferredModelId(preset.haiku),
                      });
                    }}
                  >
                    <Star className="w-3 h-3 fill-current" />
                    {preset.name}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-7 w-5 opacity-0 group-hover:opacity-100 hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeletePreset(preset.name);
                    }}
                    disabled={isDeletePending}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ))}

              <Button
                variant="outline"
                size="sm"
                className="text-xs h-7 gap-1 border-primary/50 text-primary hover:bg-primary/10 hover:border-primary"
                onClick={onOpenCustomPreset}
              >
                <Plus className="w-3 h-3" />
                Custom
              </Button>
            </div>
          </div>
        </div>
      )}

      <Separator />

      {/* Model Mapping */}
      <div>
        <h3 className="text-sm font-medium mb-2">{t('providerEditor.modelMapping')}</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Configure which models to use for each tier
        </p>
        {routing ? (
          <p className="text-[11px] text-muted-foreground mb-3 rounded-md border bg-muted/30 px-2.5 py-2">
            {pinningReady ? (
              <>
                Preferred pinned model names use the <code>{routing.prefix}/</code> prefix.
                Unprefixed names can still resolve to a different backend when providers overlap.
              </>
            ) : (
              <>
                Managed pinning for <code>{routing.prefix}/</code> is not currently advertised by
                the proxy. Unprefixed names may still be ambiguous until prefix repair completes.
              </>
            )}
          </p>
        ) : null}
        {provider === 'codex' && (
          <p className="text-[11px] text-muted-foreground mb-3 rounded-md border bg-muted/30 px-2.5 py-2">
            Codex tip: suffixes <code>-minimal</code>, <code>-low</code>, <code>-medium</code>,{' '}
            <code>-high</code>, and <code>-xhigh</code> pin reasoning effort. <code>-fast</code>{' '}
            enables the Codex fast service tier on models that support it, including combined forms
            such as <code>gpt-5.4-high-fast</code>.
          </p>
        )}
        <div className="space-y-4">
          <FlexibleModelSelector
            label="Default Model"
            description="Used when no specific tier is requested"
            value={currentModel}
            onChange={(model) => onUpdateEnvValue('ANTHROPIC_MODEL', model)}
            catalog={catalog}
            allModels={providerModels}
            routing={routing}
          />
          {/* Extended Context Toggle - shows when any saved mapping supports it */}
          {extendedContextModels.length > 0 && onExtendedContextToggle && (
            <ExtendedContextToggle
              models={extendedContextModels}
              provider={provider}
              enabled={extendedContextEnabled ?? false}
              onToggle={onExtendedContextToggle}
            />
          )}
          <FlexibleModelSelector
            label="Opus (Most capable)"
            description="For complex reasoning tasks"
            value={opusModel}
            onChange={(model) => onUpdateEnvValue('ANTHROPIC_DEFAULT_OPUS_MODEL', model)}
            catalog={catalog}
            allModels={providerModels}
            routing={routing}
          />
          <FlexibleModelSelector
            label="Sonnet (Balanced)"
            description="Balance of speed and capability"
            value={sonnetModel}
            onChange={(model) => onUpdateEnvValue('ANTHROPIC_DEFAULT_SONNET_MODEL', model)}
            catalog={catalog}
            allModels={providerModels}
            routing={routing}
          />
          <FlexibleModelSelector
            label="Haiku (Fast)"
            description="Quick responses for simple tasks"
            value={haikuModel}
            onChange={(model) => onUpdateEnvValue('ANTHROPIC_DEFAULT_HAIKU_MODEL', model)}
            catalog={catalog}
            allModels={providerModels}
            routing={routing}
          />
        </div>
      </div>
    </>
  );
}

// Simple model list UI for OpenCode, Codex, etc.
function SimpleModelConfigUI({
  currentModel,
  providerModels,
  catalog,
  routing,
  onUpdateEnvValue,
}: {
  currentModel?: string;
  providerModels: Array<{ id: string; owned_by: string }>;
  catalog?: ModelConfigSectionProps['catalog'];
  routing?: ModelConfigSectionProps['routing'];
  onUpdateEnvValue: (key: string, value: string) => void;
}) {
  const [selectedModels, setSelectedModels] = useState<string[]>(() => {
    // Parse existing models from currentModel (comma-separated or single)
    if (currentModel) {
      return currentModel.split(',').map((m) => m.trim()).filter(Boolean);
    }
    return [];
  });
  const [activeModel, setActiveModel] = useState<string>(currentModel || '');
  const [subagentModel, setSubagentModel] = useState<string>('');
  const [showModelSelector, setShowModelSelector] = useState(false);

  const handleAddModel = (modelId: string) => {
    if (!selectedModels.includes(modelId)) {
      const newModels = [...selectedModels, modelId];
      setSelectedModels(newModels);
      // Update the env value with comma-separated list
      onUpdateEnvValue('ANTHROPIC_MODEL', newModels.join(', '));
      // Set as active if first model
      if (!activeModel) {
        setActiveModel(modelId);
      }
    }
  };

  const handleRemoveModel = (modelId: string) => {
    const newModels = selectedModels.filter((m) => m !== modelId);
    setSelectedModels(newModels);
    onUpdateEnvValue('ANTHROPIC_MODEL', newModels.join(', '));
    // Clear active if removed
    if (activeModel === modelId) {
      setActiveModel(newModels[0] || '');
    }
  };

  const handleSetActive = (modelId: string) => {
    setActiveModel(modelId === activeModel ? '' : modelId);
  };

  return (
    <div className="space-y-4">
      {/* Models */}
      <div>
        <h3 className="text-sm font-medium mb-2">Models</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Add models you want to use. Click a model to set it as active.
        </p>
        <div className="flex flex-wrap gap-1.5 min-h-[32px] px-2 py-1.5 bg-muted/30 rounded border">
          {selectedModels.length === 0 ? (
            <span className="text-xs text-muted-foreground">No models selected</span>
          ) : (
            selectedModels.map((model) => (
              <span
                key={model}
                onClick={() => handleSetActive(model)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer transition-colors ${
                  model === activeModel
                    ? 'bg-primary/10 text-primary border border-primary'
                    : 'bg-muted text-muted-foreground border border-transparent hover:border-border'
                }`}
                title={model === activeModel ? 'Click to clear active' : 'Click to set as active'}
              >
                {model === activeModel && <Star className="w-3 h-3 fill-current" />}
                {model}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveModel(model);
                  }}
                  className="ml-0.5 hover:text-destructive"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))
          )}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={() => setShowModelSelector(!showModelSelector)}
          >
            <Plus className="w-3 h-3 mr-1" />
            Add Model
          </Button>
          {selectedModels.length > 0 && activeModel && (
            <span className="text-xs text-muted-foreground">
              Active: <span className="text-primary">{activeModel}</span>
            </span>
          )}
          {selectedModels.length > 0 && !activeModel && (
            <span className="text-xs text-yellow-600">Click a model to set active</span>
          )}
        </div>
        {showModelSelector && (
          <div className="mt-2 p-2 border rounded bg-muted/30">
            <FlexibleModelSelector
              label=""
              description=""
              value={undefined}
              onChange={(model) => {
                handleAddModel(model);
                setShowModelSelector(false);
              }}
              catalog={catalog}
              allModels={providerModels}
              routing={routing}
            />
          </div>
        )}
      </div>

      <Separator />

      {/* Subagent Model */}
      <div>
        <h3 className="text-sm font-medium mb-2">Subagent Model</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Model used for spawned subagents (explorer, reviewer, etc.)
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={subagentModel}
            onChange={(e) => setSubagentModel(e.target.value)}
            placeholder={activeModel || 'provider/model-id (defaults to main model)'}
            className="flex-1 px-2 py-1.5 bg-background rounded border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          {subagentModel && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => setSubagentModel('')}
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
