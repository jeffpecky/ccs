/**
 * Extended Context Toggle Component
 * Shows toggle when any selected mapping supports 1M token context.
 */

import { Zap, Info } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { isNativeGeminiModel } from '@/lib/extended-context-utils';
import type { ModelEntry } from './provider-model-selector';
import { useTranslation } from 'react-i18next';

interface ExtendedContextToggleProps {
  /** Compatible selected models */
  models: ModelEntry[];
  /** Provider name for display */
  provider: string;
  /** Whether extended context is enabled */
  enabled: boolean;
  /** Callback when toggle changes */
  onToggle: (enabled: boolean) => void;
  /** Whether the toggle is disabled (saving state) */
  disabled?: boolean;
  /** Additional className */
  className?: string;
}

export function ExtendedContextToggle({
  models,
  provider: _provider,
  enabled,
  onToggle,
  disabled,
  className,
}: ExtendedContextToggleProps) {
  const { t } = useTranslation();
  if (models.length === 0) {
    return null;
  }

  const hasGeminiModels = models.some((model) => isNativeGeminiModel(model.id));
  const hasClaudeModels = models.some((model) => !isNativeGeminiModel(model.id));

  let behaviorHint = 'Compatible mappings stay on standard context unless you turn this on.';
  if (hasGeminiModels && hasClaudeModels) {
    behaviorHint =
      'Gemini-compatible mappings can use 1M automatically. Claude mappings stay plain unless you turn this on.';
  } else if (hasGeminiModels) {
    behaviorHint =
      'Gemini-compatible mappings can use 1M by default. Turn this off to keep standard context.';
  }

  return (
    <div
      className={cn(
        'rounded-lg border p-3 space-y-2',
        enabled ? 'border-primary/50 bg-primary/5' : 'border-border bg-muted/30',
        className
      )}
    >
      {/* Header with toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className={cn('w-4 h-4', enabled ? 'text-primary' : 'text-muted-foreground')} />
          <span className="text-sm font-medium">{t('extendedContext.extendedContext')}</span>
          <Badge variant={enabled ? 'default' : 'secondary'} className="text-[10px] h-5 px-1.5">
            1M tokens
          </Badge>
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} disabled={disabled} />
      </div>

      {/* Info text */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p>
            Applies the explicit <code>[1m]</code> long-context suffix to compatible saved mappings.
          </p>
          <p className="text-[10px]">{behaviorHint}</p>
          <p className="text-amber-600 dark:text-amber-500">
            CCS only saves <code>[1m]</code>. Provider pricing and entitlement are separate, and
            some accounts can still return 429 extra-usage errors for long-context requests.
          </p>
        </div>
      </div>
    </div>
  );
}
