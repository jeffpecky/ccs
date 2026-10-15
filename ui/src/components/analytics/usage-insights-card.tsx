import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, Zap, Gauge, DollarSign, Database, Lightbulb } from 'lucide-react';
import type { Anomaly, AnomalySummary, AnomalyType } from '@/hooks/use-usage';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface UsageInsightsCardProps {
  anomalies?: Anomaly[];
  summary?: AnomalySummary;
  isLoading?: boolean;
  className?: string;
}

const ANOMALY_CONFIG: Record<
  AnomalyType,
  {
    icon: React.ComponentType<{ className?: string }>;
    color: string;
    bgColor: string;
    label: string;
  }
> = {
  high_input: {
    icon: Zap,
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-100 dark:bg-amber-900/20',
    label: 'High Input Volume',
  },
  high_io_ratio: {
    icon: Gauge,
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-100 dark:bg-orange-900/20',
    label: 'High I/O Ratio',
  },
  cost_spike: {
    icon: DollarSign,
    color: 'text-red-600 dark:text-red-400',
    bgColor: 'bg-red-100 dark:bg-red-900/20',
    label: 'Cost Spike Detected',
  },
  high_cache_read: {
    icon: Database,
    color: 'text-cyan-600 dark:text-cyan-400',
    bgColor: 'bg-cyan-100 dark:bg-cyan-900/20',
    label: 'Heavy Cache Usage',
  },
};

export function UsageInsightsCard({
  anomalies = [],
  summary,
  isLoading,
  className,
}: UsageInsightsCardProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <Card
        className={cn('flex flex-col h-full border-none shadow-none bg-transparent', className)}
      >
        <div className="px-1 py-2">
          <div className="flex items-center gap-2 mb-4">
            <SkeletonIcon />
            <div className="h-4 w-24 bg-muted rounded animate-pulse" />
          </div>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-muted animate-pulse shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-3/4 bg-muted rounded animate-pulse" />
                  <div className="h-2 w-1/2 bg-muted rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    );
  }

  const hasAnomalies = summary && summary.totalAnomalies > 0;

  if (!hasAnomalies) {
    return (
      <Card
        className={cn('flex flex-col h-full border-none shadow-none bg-transparent', className)}
      >
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-muted-foreground min-h-[200px]">
          <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center mb-3 ring-4 ring-green-50 dark:ring-green-900/10">
            <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400" />
          </div>
          <h3 className="font-medium text-foreground text-sm">
            {t('healthCard.allSystemsNominal')}
          </h3>
          <p className="text-xs mt-1.5 max-w-[200px] leading-relaxed">
            Your usage patterns are within normal ranges for the selected period.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className={cn('flex flex-col h-full border-none shadow-none bg-transparent', className)}>
      <div className="px-1 py-2 flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-amber-500" />
          <h3 className="font-semibold text-sm">{t('analyticsCards.usageInsights')}</h3>
        </div>
        <Badge
          variant="outline"
          className="h-5 px-2 text-[10px] font-medium border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400"
        >
          {summary.totalAnomalies}{' '}
          {/* TODO i18n: missing key for singular/plural "Alert"/"Alerts" */}{' '}
          {summary.totalAnomalies === 1 ? 'Alert' : 'Alerts'}
        </Badge>
      </div>

      <ScrollArea className="flex-1 -mx-2 px-2">
        <div className="space-y-1 pb-2">
          {anomalies.map((anomaly, index) => {
            const config = ANOMALY_CONFIG[anomaly.type];
            const Icon = config.icon;

            return (
              <div
                key={index}
                className="group p-3 rounded-lg hover:bg-muted/50 transition-colors border border-transparent hover:border-border/50"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'p-2 rounded-md shrink-0 ring-1 ring-inset ring-black/5 dark:ring-white/10',
                      config.bgColor
                    )}
                  >
                    <Icon className={cn('h-3.5 w-3.5', config.color)} />
                  </div>

                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-sm text-foreground/90">{config.label}</p>
                      <span className="text-[10px] text-muted-foreground tabular-nums opacity-60 group-hover:opacity-100 transition-opacity">
                        {anomaly.date}
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {anomaly.message}
                    </p>

                    {anomaly.model && (
                      <div className="pt-1.5">
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0 h-5 font-mono bg-muted/50 text-muted-foreground group-hover:bg-background group-hover:text-foreground transition-colors"
                        >
                          {anomaly.model}
                        </Badge>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </Card>
  );
}

function SkeletonIcon() {
  return <div className="w-4 h-4 bg-muted rounded-full animate-pulse" />;
}
