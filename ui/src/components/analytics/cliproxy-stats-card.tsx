/**
 * CLIProxy Stats Card Component
 *
 * Displays CLIProxyAPI usage statistics with:
 * - Status indicator (running/offline)
 * - Total requests with success rate ring
 * - Total tokens usage
 * - Model breakdown with usage bars
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Server, Zap, Cpu, Coins } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCliproxyStats, useCliproxyStatus } from '@/hooks/use-cliproxy-stats';
import { useTranslation } from 'react-i18next';

interface CliproxyStatsCardProps {
  className?: string;
  isLoading?: boolean; // External loading state from parent (for synchronized loading UI)
}

export function CliproxyStatsCard({
  className,
  isLoading: externalLoading,
}: CliproxyStatsCardProps) {
  const { data: status, isLoading: statusLoading } = useCliproxyStatus();
  const { data: stats, isLoading: statsLoading, error } = useCliproxyStats(status?.running);
  const { t } = useTranslation();

  const isLoading = externalLoading || statusLoading || (status?.running && statsLoading);

  if (isLoading) {
    return (
      <Card className={cn('flex flex-col h-full min-h-0 overflow-hidden gap-0 py-0', className)}>
        <CardHeader className="px-3 py-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Server className="h-4 w-4" />
            {/* TODO i18n: missing key for "CLIProxy Stats" */}
            CLIProxy Stats
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 pt-0 flex-1">
          <div className="space-y-3">
            <Skeleton className="h-4 w-[100px]" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Proxy not running
  if (!status?.running) {
    return (
      <Card
        className={cn(
          'flex flex-col h-full min-h-0 overflow-hidden gap-0 py-0 border-dashed',
          className
        )}
      >
        <CardHeader className="px-3 py-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              {/* TODO i18n: missing key for "CLIProxy Stats" */}
              CLIProxy Stats
            </CardTitle>
            <Badge variant="secondary" className="text-[10px] h-5">
              {t('cliproxyStatsOverview.offline')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="px-3 pb-3 pt-0 flex-1 flex items-center justify-center">
          <p className="text-xs text-muted-foreground text-center">
            {t('cliproxyStatsOverview.noActiveSessionHint')}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Error fetching stats
  if (error) {
    return (
      <Card
        className={cn(
          'flex flex-col h-full min-h-0 overflow-hidden gap-0 py-0 border-destructive/50',
          className
        )}
      >
        <CardHeader className="px-3 py-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Server className="h-4 w-4" />
              {/* TODO i18n: missing key for "CLIProxy Stats" */}
              CLIProxy Stats
            </CardTitle>
            <Badge variant="destructive" className="text-[10px] h-5">
              {/* TODO i18n: missing key for "Error" */}
              Error
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="px-3 pb-3 pt-0 flex-1">
          <p className="text-xs text-destructive">{error.message}</p>
        </CardContent>
      </Card>
    );
  }

  // Calculate stats
  const totalRequests = stats?.totalRequests ?? 0;
  const failedRequests = stats?.quotaExceededCount ?? 0;
  const successRequests = totalRequests - failedRequests;
  const successRate = totalRequests > 0 ? Math.round((successRequests / totalRequests) * 100) : 100;
  const totalTokens = stats?.tokens?.total ?? 0;

  // Get model breakdown sorted by usage
  const models = Object.entries(stats?.requestsByModel ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4); // Top 4 models

  const maxModelRequests = models.length > 0 ? models[0][1] : 1;

  return (
    <Card className={cn('flex flex-col h-full min-h-0 overflow-hidden gap-0 py-0', className)}>
      <CardHeader className="px-3 py-2 border-b bg-muted/5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Server className="h-4 w-4" />
            {/* TODO i18n: missing key for "CLIProxy Stats" */}
            CLIProxy Stats
          </CardTitle>
          <Badge
            variant="outline"
            className="text-[10px] h-5 text-green-600 border-green-200 bg-green-50 dark:bg-green-900/10 dark:border-green-800"
          >
            <Zap className="h-3 w-3 mr-0.5" />
            {t('cliproxyStatsOverview.running')}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0 flex-1 min-h-0">
        <ScrollArea className="h-full">
          <div className="p-3 space-y-3">
            {/* Key metrics row */}
            <div className="grid grid-cols-2 gap-2">
              {/* Requests with success ring */}
              <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
                <div className="relative">
                  <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
                    <circle
                      cx="18"
                      cy="18"
                      r="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      className="text-muted/30"
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeDasharray={`${successRate * 0.88} 88`}
                      strokeLinecap="round"
                      className={successRate >= 90 ? 'text-green-500' : 'text-amber-500'}
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold">
                    {successRate}%
                  </span>
                </div>
                <div className="min-w-0">
                  <div className="text-lg font-bold leading-none">
                    {formatNumber(totalRequests)}
                  </div>
                  <div className="text-[9px] text-muted-foreground mt-0.5">
                    {failedRequests > 0 ? `${failedRequests} failed` : 'All success'}
                    {/* TODO i18n: missing keys for "failed" / "All success" */}
                  </div>
                </div>
              </div>

              {/* Tokens */}
              <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/30">
                <div className="p-1.5 rounded-md bg-purple-100 dark:bg-purple-900/20">
                  <Coins className="h-4 w-4 text-purple-600" />
                </div>
                <div className="min-w-0">
                  <div className="text-lg font-bold leading-none">{formatNumber(totalTokens)}</div>
                  <div className="text-[9px] text-muted-foreground mt-0.5">
                    {t('cliproxyStatsOverview.totalTokens')}
                  </div>
                </div>
              </div>
            </div>

            {/* Model breakdown */}
            {models.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                  <Cpu className="h-3 w-3" />
                  {t('cliproxyStatsOverview.modelsUsed')}
                </div>
                <div className="space-y-1">
                  {models.map(([model, count]) => {
                    const percentage = Math.round((count / maxModelRequests) * 100);
                    const displayName = formatModelName(model);
                    return (
                      <div key={model} className="group">
                        <div className="flex items-center justify-between text-[10px] mb-0.5">
                          <span className="truncate font-medium" title={model}>
                            {displayName}
                          </span>
                          <span className="text-muted-foreground shrink-0 ml-2">{count}</span>
                        </div>
                        <div className="h-1 bg-muted/50 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent/70 rounded-full transition-all"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
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

/** Format model names for display (remove prefixes, shorten) */
function formatModelName(model: string): string {
  // Remove common prefixes
  let name = model
    .replace(/^gemini-claude-/, '')
    .replace(/^gemini-/, '')
    .replace(/^claude-/, '')
    .replace(/^anthropic\./, '')
    .replace(/-thinking$/, ' Thinking');

  // Capitalize first letter of each word
  name = name
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  // Shorten long names
  if (name.length > 20) {
    name = name.slice(0, 18) + '...';
  }

  return name;
}
