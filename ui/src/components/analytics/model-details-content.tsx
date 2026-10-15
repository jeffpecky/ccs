import { Badge } from '@/components/ui/badge';
import { ArrowDownRight, ArrowUpRight, Database, Gauge, Sparkles } from 'lucide-react';
import type { ModelUsage } from '@/hooks/use-usage';
import { usePrivacy, PRIVACY_BLUR_CLASS } from '@/contexts/privacy-context';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface ModelDetailsContentProps {
  model: ModelUsage;
}

export function ModelDetailsContent({ model }: ModelDetailsContentProps) {
  const { privacyMode } = usePrivacy();
  const { t } = useTranslation();
  const ioRatioStatus = getIoRatioStatus(model.ioRatio);
  const cacheTokens = model.cacheCreationTokens + model.cacheReadTokens;
  const totalTokensLabel = cacheTokens > 0 ? 'All Tokens' : t('analyticsCards.totalTokens');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          <h4 className="font-semibold leading-none truncate" title={model.model}>
            {model.model}
          </h4>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
            {model.percentage.toFixed(1)}% usage
          </Badge>
          <Badge variant={ioRatioStatus.variant} className="text-[10px] h-5 px-1.5">
            {model.ioRatio.toFixed(0)}:1 I/O
          </Badge>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2 rounded-md bg-muted/50 border text-center">
          <p className={cn('text-lg font-bold', privacyMode && PRIVACY_BLUR_CLASS)}>
            ${model.cost.toFixed(2)}
          </p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {t('analyticsCards.totalCost')}
          </p>
        </div>
        <div className="p-2 rounded-md bg-muted/50 border text-center">
          <p className={cn('text-lg font-bold', privacyMode && PRIVACY_BLUR_CLASS)}>
            {formatCompactNumber(model.tokens)}
          </p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {totalTokensLabel}
          </p>
        </div>
      </div>

      {/* Token Breakdown */}
      <div className="space-y-2">
        <h5 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          {/* TODO i18n: missing key for "Token Breakdown" */}
          Token Breakdown
        </h5>
        <div className={cn('space-y-1', privacyMode && PRIVACY_BLUR_CLASS)}>
          {/* TODO i18n: missing keys for Input/Output/Cache Write/Cache Read labels */}
          <TokenRow
            label="Input"
            tokens={model.inputTokens}
            cost={model.costBreakdown.input.cost}
            color="#335c67"
            icon={ArrowDownRight}
          />
          <TokenRow
            label="Output"
            tokens={model.outputTokens}
            cost={model.costBreakdown.output.cost}
            color="#fff3b0"
            icon={ArrowUpRight}
          />
          <TokenRow
            label="Cache Write"
            tokens={model.cacheCreationTokens}
            cost={model.costBreakdown.cacheCreation.cost}
            color="#e09f3e"
            icon={Database}
          />
          <TokenRow
            label="Cache Read"
            tokens={model.cacheReadTokens}
            cost={model.costBreakdown.cacheRead.cost}
            color="#9e2a2b"
            icon={Database}
          />
        </div>
      </div>

      {/* I/O Ratio Info */}
      <div className="p-2.5 rounded-md border bg-muted/20 space-y-1.5">
        <div className="flex items-center gap-2">
          <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{t('analyticsCards.inputOutputRatio')}</span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug">
          {ioRatioStatus.description}
        </p>
      </div>
    </div>
  );
}

interface TokenRowProps {
  label: string;
  tokens: number;
  cost: number;
  color: string;
  icon: React.ComponentType<{ className?: string }>;
}

function TokenRow({ label, tokens, cost, color, icon: Icon }: TokenRowProps) {
  if (tokens === 0) return null;

  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="w-1 h-6 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="font-medium truncate">{label}</span>
          <span className="font-mono text-muted-foreground">${cost.toFixed(3)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="h-3 w-3 shrink-0" />
          <span>{formatNumber(tokens)}</span>
        </div>
      </div>
    </div>
  );
}

function getIoRatioStatus(ratio: number): {
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  description: string;
} {
  if (ratio >= 200) {
    return {
      variant: 'destructive',
      description: 'Extended thinking or large context loading. Expected for reasoning models.',
    };
  }
  if (ratio >= 50) {
    return {
      variant: 'secondary',
      description: 'More input than output. Typical for analysis tasks.',
    };
  }
  if (ratio >= 5) {
    return {
      variant: 'outline',
      description: 'Balanced input/output ratio for typical coding tasks.',
    };
  }
  return {
    variant: 'default',
    description: 'More output than input. Generation-heavy workload.',
  };
}

function formatNumber(num: number): string {
  return num.toLocaleString();
}

function formatCompactNumber(num: number): string {
  if (num >= 1000000000) return `${(num / 1000000000).toFixed(1)}B`;
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}
