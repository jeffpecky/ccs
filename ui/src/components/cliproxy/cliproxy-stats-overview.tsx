/**
 * CLIProxy Stats Overview Component
 *
 * Full-width dashboard section showing comprehensive CLIProxyAPI statistics.
 * Features:
 * - Status indicator with uptime
 * - Request metrics with success rate visualization
 * - Token usage with cost estimation
 * - Model breakdown with usage distribution
 * - Session history
 * Respects privacy mode to blur sensitive data.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Server,
  Zap,
  ZapOff,
  Activity,
  Coins,
  Cpu,
  CheckCircle2,
  XCircle,
  TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCliproxyStats, useCliproxyStatus } from '@/hooks/use-cliproxy-stats';
import { useCliproxyUpdateCheck } from '@/hooks/use-cliproxy';
import { usePrivacy, PRIVACY_BLUR_CLASS } from '@/contexts/privacy-context';
import { useTranslation } from 'react-i18next';

interface CliproxyStatsOverviewProps {
  className?: string;
}

export function CliproxyStatsOverview({ className }: CliproxyStatsOverviewProps) {
  const { t } = useTranslation();
  const { privacyMode } = usePrivacy();
  const { data: status, isLoading: statusLoading } = useCliproxyStatus();
  const { data: stats, isLoading: statsLoading, error } = useCliproxyStats(status?.running);
  const { data: updateCheck } = useCliproxyUpdateCheck();
  const backendLabel = updateCheck?.backendLabel ?? 'CLIProxy';

  const isLoading = statusLoading || (status?.running && statsLoading);

  // Loading state
  if (isLoading) {
    return (
      <div className={cn('space-y-4', className)}>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }

  // Offline state
  if (!status?.running) {
    return (
      <div className={cn('space-y-4', className)}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
              <Activity className="h-5 w-5" />
              {t('cliproxyStatsOverview.sessionStatistics')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('cliproxyStatsOverview.realTimeMetrics', { backend: backendLabel })}
            </p>
          </div>
          <Badge variant="secondary" className="w-fit gap-1.5">
            <ZapOff className="h-3.5 w-3.5" />
            {t('cliproxyStatsOverview.offline')}
          </Badge>
        </div>

        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="p-4 rounded-full bg-muted/50 mb-4">
              <Server className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="font-medium mb-1">{t('cliproxyStatsOverview.noActiveSession')}</h3>
            <p className="text-sm text-muted-foreground max-w-md">
              {t('cliproxyStatsOverview.noActiveSessionHint')}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={cn('space-y-4', className)}>
        <Card className="border-destructive/50">
          <CardContent className="flex items-center gap-4 py-6">
            <XCircle className="h-8 w-8 text-destructive shrink-0" />
            <div>
              <h3 className="font-medium">{t('cliproxyStatsOverview.failedLoadStats')}</h3>
              <p className="text-sm text-muted-foreground">{error.message}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Calculate derived stats
  const totalRequests = stats?.totalRequests ?? 0;
  const failedRequests = stats?.quotaExceededCount ?? 0;
  const successRequests = totalRequests - failedRequests;
  const successRate = totalRequests > 0 ? Math.round((successRequests / totalRequests) * 100) : 100;
  const totalTokens = stats?.tokens?.total ?? 0;

  // Get model breakdown sorted by usage
  const models = Object.entries(stats?.requestsByModel ?? {}).sort((a, b) => b[1] - a[1]);
  const maxModelRequests = models.length > 0 ? models[0][1] : 1;

  // Define color palette for models
  const modelColors = [
    'bg-blue-500',
    'bg-purple-500',
    'bg-amber-500',
    'bg-emerald-500',
    'bg-rose-500',
    'bg-cyan-500',
  ];

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
            <Activity className="h-5 w-5" />
            {t('cliproxyStatsOverview.sessionStatistics')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('cliproxyStatsOverview.realTimeMetrics', { backend: backendLabel })}
          </p>
        </div>
        <Badge
          variant="outline"
          className="w-fit gap-1.5 text-green-600 border-green-200 bg-green-50 dark:bg-green-900/10 dark:border-green-800"
        >
          <Zap className="h-3.5 w-3.5" />
          {t('cliproxyStatsOverview.running')}
        </Badge>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Requests Card */}
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('cliproxyStatsOverview.totalRequests')}
                </p>
                <p className="text-2xl font-bold">{formatNumber(totalRequests)}</p>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                  <span className="text-muted-foreground">
                    {t('cliproxyStatsOverview.successCount', { count: successRequests })}
                  </span>
                </div>
              </div>
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/20">
                <TrendingUp className="h-4 w-4 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Success Rate Card */}
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1 flex-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('cliproxyStatsOverview.successRate')}
                </p>
                <p className="text-2xl font-bold">{successRate}%</p>
                <div className="h-1.5 mt-2 bg-muted/50 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      successRate >= 90 ? 'bg-green-500' : 'bg-amber-500'
                    )}
                    style={{ width: `${successRate}%` }}
                  />
                </div>
              </div>
              <div
                className={cn(
                  'p-2 rounded-lg',
                  successRate >= 90
                    ? 'bg-green-100 dark:bg-green-900/20'
                    : 'bg-amber-100 dark:bg-amber-900/20'
                )}
              >
                {successRate >= 90 ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-amber-600" />
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tokens Card */}
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('cliproxyStatsOverview.totalTokens')}
                </p>
                <p className={cn('text-2xl font-bold', privacyMode && PRIVACY_BLUR_CLASS)}>
                  {formatNumber(totalTokens)}
                </p>
                <p
                  className={cn(
                    'text-[10px] text-muted-foreground',
                    privacyMode && PRIVACY_BLUR_CLASS
                  )}
                >
                  {t('cliproxyStatsOverview.estimatedCost', {
                    cost: estimateCost(totalTokens).toFixed(2),
                  })}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/20">
                <Coins className="h-4 w-4 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Models Card */}
        <Card className="hover:shadow-md transition-shadow">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('cliproxyStatsOverview.modelsUsed')}
                </p>
                <p className="text-2xl font-bold">{models.length}</p>
                <p className="text-[10px] text-muted-foreground">
                  {models.length > 0 ? formatModelName(models[0][0]) : 'None'}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-cyan-100 dark:bg-cyan-900/20">
                <Cpu className="h-4 w-4 text-cyan-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Model Breakdown */}
      {models.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              {t('cliproxyStatsOverview.modelUsageDistribution')}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-3">
              {models.map(([model, count], index) => {
                const percentage = Math.round((count / totalRequests) * 100);
                const barPercentage = Math.round((count / maxModelRequests) * 100);
                const displayName = formatModelName(model);
                const colorClass = modelColors[index % modelColors.length];

                return (
                  <div key={model} className="group">
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={cn('w-2 h-2 rounded-full shrink-0', colorClass)} />
                        <span className="font-medium truncate" title={model}>
                          {displayName}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-muted-foreground shrink-0">
                        <span>{t('cliproxyStatsOverview.requestCount', { count })}</span>
                        <span className="text-xs font-medium w-10 text-right">{percentage}%</span>
                      </div>
                    </div>
                    <div className="h-2 bg-muted/50 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all duration-500',
                          colorClass
                        )}
                        style={{ width: `${barPercentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Format large numbers with K/M suffix */
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}

/** Format model names for display */
function formatModelName(model: string): string {
  let name = model
    .replace(/^gemini-claude-/, '')
    .replace(/^gemini-/, '')
    .replace(/^claude-/, '')
    .replace(/^anthropic\./, '')
    .replace(/-thinking$/, ' Thinking');

  name = name
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  if (name.length > 25) {
    name = name.slice(0, 23) + '...';
  }

  return name;
}

/** Estimate cost based on token count (rough average) */
function estimateCost(tokens: number): number {
  // Average cost per 1M tokens across models (~$3 for input, ~$15 for output)
  // Assuming 30% input, 70% output ratio
  const avgCostPerMillion = 3 * 0.3 + 15 * 0.7;
  return (tokens / 1000000) * avgCostPerMillion;
}
