/**
 * Usage Summary Cards Component
 *
 * Displays key metrics in a card grid layout.
 * Shows total tokens, cost, cache tokens, and average cost per day.
 * Respects privacy mode to blur sensitive financial data.
 */

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { DollarSign, Database, FileText, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UsageSummary } from '@/hooks/use-usage';
import { usePrivacy, PRIVACY_BLUR_CLASS } from '@/contexts/privacy-context';
import { useTranslation } from 'react-i18next';

interface UsageSummaryCardsProps {
  data?: UsageSummary;
  isLoading?: boolean;
}

export function UsageSummaryCards({ data, isLoading }: UsageSummaryCardsProps) {
  const { privacyMode } = usePrivacy();
  const { t } = useTranslation();
  const totalTokens = data?.totalTokens ?? 0;
  const totalInputTokens = data?.totalInputTokens ?? 0;
  const totalOutputTokens = data?.totalOutputTokens ?? 0;
  const totalCacheTokens = data?.totalCacheTokens ?? 0;
  const totalIoTokens = totalInputTokens + totalOutputTokens;

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-[100px]" />
                  <Skeleton className="h-8 w-[80px]" />
                </div>
                <Skeleton className="h-8 w-8 rounded-lg" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // Calculate cache cost percentage
  const cacheCost =
    (data?.tokenBreakdown?.cacheCreation?.cost ?? 0) + (data?.tokenBreakdown?.cacheRead?.cost ?? 0);
  const cacheCostPercent = data?.totalCost ? Math.round((cacheCost / data.totalCost) * 100) : 0;
  const totalTokensIncludesCache = totalCacheTokens > 0 && totalTokens > totalIoTokens;
  const totalTokensTitle =
    totalCacheTokens > 0 && !totalTokensIncludesCache
      ? 'Total Tokens (I/O)'
      : t('analyticsSummary.totalTokens');
  const totalTokensSubtitle = totalTokensIncludesCache
    ? `${formatNumber(totalInputTokens)} in / ${formatNumber(totalOutputTokens)} out / ${formatNumber(totalCacheTokens)} cache`
    : t('analyticsSummary.totalTokensSubtitle', {
        input: formatNumber(totalInputTokens),
        output: formatNumber(totalOutputTokens),
      });

  const cards = [
    {
      title: totalTokensTitle,
      value: totalTokens,
      icon: FileText,
      format: (v: number) => formatNumber(v),
      color: 'text-blue-600',
      bgColor: 'bg-blue-100 dark:bg-blue-900/20',
      subtitle: totalTokensSubtitle,
    },
    {
      title: t('analyticsSummary.totalCost'),
      value: data?.totalCost ?? 0,
      icon: DollarSign,
      format: (v: number) => `$${v.toFixed(2)}`,
      color: 'text-green-600',
      bgColor: 'bg-green-100 dark:bg-green-900/20',
      subtitle: t('analyticsSummary.totalCostSubtitle', {
        value: data?.averageCostPerDay?.toFixed(2) ?? '0.00',
      }),
    },
    {
      title: t('analyticsSummary.cacheTokens'),
      value: data?.totalCacheTokens ?? 0,
      icon: Database,
      format: (v: number) => formatNumber(v),
      color: 'text-cyan-600',
      bgColor: 'bg-cyan-100 dark:bg-cyan-900/20',
      subtitle: t('analyticsSummary.cacheTokensSubtitle', {
        cost: cacheCost.toFixed(2),
        percent: cacheCostPercent,
      }),
    },
    {
      title: t('analyticsSummary.inputCost'),
      value: data?.tokenBreakdown?.input?.cost ?? 0,
      icon: ArrowDownRight,
      format: (v: number) => `$${v.toFixed(2)}`,
      color: 'text-purple-600',
      bgColor: 'bg-purple-100 dark:bg-purple-900/20',
      subtitle: t('analyticsSummary.tokensSubtitle', {
        value: formatNumber(data?.tokenBreakdown?.input?.tokens ?? 0),
      }),
    },
    {
      title: t('analyticsSummary.outputCost'),
      value: data?.tokenBreakdown?.output?.cost ?? 0,
      icon: ArrowUpRight,
      format: (v: number) => `$${v.toFixed(2)}`,
      color: 'text-orange-600',
      bgColor: 'bg-orange-100 dark:bg-orange-900/20',
      subtitle: t('analyticsSummary.tokensSubtitle', {
        value: formatNumber(data?.tokenBreakdown?.output?.tokens ?? 0),
      }),
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {cards.map((card, index) => {
        const Icon = card.icon;
        return (
          <Card key={index} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center justify-between space-x-2">
                <div className="space-y-1 min-w-0">
                  <p className="text-xs font-medium text-muted-foreground truncate">{card.title}</p>
                  <p
                    className={cn('text-xl font-bold truncate', privacyMode && PRIVACY_BLUR_CLASS)}
                  >
                    {card.format(card.value)}
                  </p>
                  {card.subtitle && (
                    <p
                      className={cn(
                        'text-[10px] text-muted-foreground truncate',
                        privacyMode && PRIVACY_BLUR_CLASS
                      )}
                    >
                      {card.subtitle}
                    </p>
                  )}
                </div>
                <div className={cn('p-2 rounded-lg shrink-0', card.bgColor)}>
                  <Icon className={cn('h-4 w-4', card.color)} />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// Helper to format large numbers
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}
