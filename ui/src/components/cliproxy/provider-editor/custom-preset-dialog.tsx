/**
 * Custom Preset Dialog
 * Configure all model mappings at once with save option
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Sparkles, Loader2, Star, Zap } from 'lucide-react';
import { FlexibleModelSelector } from '../provider-model-selector';
import type { CustomPresetDialogProps, ModelMappingValues } from './types';
import { useTranslation } from 'react-i18next';

function normalizePresetValues(
  values: ModelMappingValues,
  routing: CustomPresetDialogProps['routing']
): ModelMappingValues {
  const toPreferredModelId = (modelId: string): string => {
    const hint = routing?.models.find(
      (entry) => entry.modelId.toLowerCase() === modelId.toLowerCase()
    );
    return hint?.recommendedModelId ?? modelId;
  };

  return {
    default: toPreferredModelId(values.default),
    opus: toPreferredModelId(values.opus),
    sonnet: toPreferredModelId(values.sonnet),
    haiku: toPreferredModelId(values.haiku),
  };
}

export function CustomPresetDialog({
  open,
  onClose,
  currentValues,
  onApply,
  onSave,
  isSaving,
  catalog,
  allModels,
  routing,
}: CustomPresetDialogProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState<ModelMappingValues>(
    normalizePresetValues(currentValues, routing)
  );
  const [presetName, setPresetName] = useState('');

  // Reset values when dialog opens with current values
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      setValues(normalizePresetValues(currentValues, routing));
      setPresetName('');
    } else {
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            {t('customPresetDialog.title')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="preset-name">{t('customPresetDialog.presetNameOptional')}</Label>
            <Input
              id="preset-name"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder={t('customPresetDialog.presetNamePlaceholder')}
              className="text-sm"
            />
          </div>
          <Separator />
          {catalog?.provider === 'codex' && (
            <p className="text-[11px] text-muted-foreground rounded-md border bg-muted/30 px-2.5 py-2">
              {t('customPresetDialog.codexTipPrefix')} <code>-medium</code>, <code>-high</code>, and{' '}
              <code>-xhigh</code> {t('customPresetDialog.codexTipSuffix')}
            </p>
          )}
          <FlexibleModelSelector
            label={t('customPresetDialog.defaultModel')}
            description={t('customPresetDialog.defaultModelDesc')}
            value={values.default}
            onChange={(model) => setValues({ ...values, default: model })}
            catalog={catalog}
            allModels={allModels}
            routing={routing}
          />
          <FlexibleModelSelector
            label={t('customPresetDialog.opusModel')}
            description={t('customPresetDialog.opusModelDesc')}
            value={values.opus}
            onChange={(model) => setValues({ ...values, opus: model })}
            catalog={catalog}
            allModels={allModels}
            routing={routing}
          />
          <FlexibleModelSelector
            label={t('customPresetDialog.sonnetModel')}
            description={t('customPresetDialog.sonnetModelDesc')}
            value={values.sonnet}
            onChange={(model) => setValues({ ...values, sonnet: model })}
            catalog={catalog}
            allModels={allModels}
            routing={routing}
          />
          <FlexibleModelSelector
            label={t('customPresetDialog.haikuModel')}
            description={t('customPresetDialog.haikuModelDesc')}
            value={values.haiku}
            onChange={(model) => setValues({ ...values, haiku: model })}
            catalog={catalog}
            allModels={allModels}
            routing={routing}
          />
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>
            {t('customPresetDialog.cancel')}
          </Button>
          {onSave && (
            <Button
              variant="secondary"
              onClick={() => onSave(values, presetName || undefined)}
              disabled={isSaving || !presetName.trim()}
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Star className="w-4 h-4 mr-1" />
              )}
              {t('customPresetDialog.savePreset')}
            </Button>
          )}
          <Button onClick={() => onApply(values, presetName || undefined)}>
            <Zap className="w-4 h-4 mr-1" />
            {t('customPresetDialog.applyPreset')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
