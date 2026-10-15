/**
 * Session Stats Card Component
 *
 * Displays session usage metrics including active sessions, average duration,
 * and session cost breakdown. Respects privacy mode to blur sensitive data.
 */

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Clock, Users, Zap, Terminal } from 'lucide-react';
import type { PaginatedSessions } from '@/hooks/use-usage';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { usePrivacy, PRIVACY_BLUR_CLASS } from '@/contexts/privacy-context';
import { getProjectDisplayName } from './project-name-utils';
import { useTranslation } from 'react-i18next';

interface SessionStatsCardProps {
  data: PaginatedSessions | undefined;
  isLoading?: boolean;
  className?: string;
}

export function SessionStatsCard({ data, isLoading, className }: SessionStatsCardProps) {
  const { privacyMode } = usePrivacy();
  const { t } = useTranslation();

  const stats = useMemo(() => {
    if (!data?.sessions || data.sessions.length === 0) return null;

    const sessions = data.sessions;
    const totalSessions = data.total;
    const sampledSessions = sessions.length;
    const hasPartialSample = data.hasMore || data.offset > 0;

    // Calculate total cost for visible sessions
    const totalCost = sessions.reduce((sum, s) => sum + s.cost, 0);
    const avgCost = totalCost / sessions.length;

    return {
      displayedSessions: hasPartialSample ? sampledSessions : totalSessions,
      totalSessions,
      avgCost,
      hasPartialSample,
      recentSessions: sessions.slice(0, 3),
    };
  }, [data]);

  if (isLoading) {
    return (
      <Card className={cn('flex flex-col h-full min-h-0 overflow-hidden gap-0 py-0', className)}>
        <CardHeader className="px-3 py-2">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="px-3 pb-3 pt-0 flex-1">
          <Skeleton className="h-full w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!stats) {
    return (
      <Card className={cn('flex flex-col h-full min-h-0 overflow-hidden gap-0 py-0', className)}>
        <CardHeader className="px-3 py-2">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Terminal className="w-4 h-4" />
            {/* TODO i18n: missing key for "Session Stats" */}
            Session Stats
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 pt-0 flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground text-center">
            {t('analyticsCards.noSessionData')}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={cn('flex flex-col h-full min-h-0 overflow-hidden gap-0 py-0 shadow-sm', className)}
    >
      <CardHeader className="px-3 py-2">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Terminal className="w-4 h-4" />
          {/* TODO i18n: missing key for "Session Stats" */}
          Session Stats
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0 flex-1 min-h-0 flex flex-col gap-3">
        {/* Key Metrics Grid */}
        <div className="grid grid-cols-2 gap-2">
          {/* Total Sessions */}
          <div className="p-2 rounded-md bg-muted/50 border text-center">
            <div className="flex items-center justify-center gap-1.5 text-blue-600 dark:text-blue-400">
              <Users className="w-4 h-4" />
              <span className="text-xl font-bold">{stats.displayedSessions}</span>
            </div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">
              {stats.hasPartialSample ? 'Sampled Sessions' : 'Total Sessions'}
            </p>
            {stats.hasPartialSample && (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {stats.totalSessions} total
              </p>
            )}
          </div>

          {/* Avg Cost */}
          <div className="p-2 rounded-md bg-muted/50 border text-center">
            <div className="flex items-center justify-center gap-1.5 text-green-600 dark:text-green-400">
              <Zap className="w-4 h-4" />
              <span className={cn('text-xl font-bold', privacyMode && PRIVACY_BLUR_CLASS)}>
                ${stats.avgCost.toFixed(2)}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">
              {stats.hasPartialSample ? 'Recent Avg Cost' : 'Avg Cost/Session'}
            </p>
          </div>
        </div>

        {/* Recent Activity List */}
        <div className="flex-1 min-h-0 space-y-2">
          <div className="flex items-center gap-1 text-xs text-muted-foreground font-medium mb-1">
            <Clock className="w-3 h-3" />
            {/* TODO i18n: missing key for "Recent Activity" */}
            Recent Activity
          </div>
          <div className="space-y-1.5 max-h-full overflow-y-auto pr-1">
            {stats.recentSessions.map((session) => (
              <div
                key={session.sessionId}
                className="flex items-center justify-between text-xs p-1.5 rounded bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="font-medium truncate" title={session.projectPath}>
                      {getProjectDisplayName(session.projectPath)}
                    </span>
                    {(session.target ?? 'claude') !== 'claude' && (
                      <span className="shrink-0 px-1 py-0 text-[9px] font-medium rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 uppercase">
                        {session.target}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(session.lastActivity), { addSuffix: true })}
                  </span>
                </div>
                <div className={cn('text-right shrink-0 ml-2', privacyMode && PRIVACY_BLUR_CLASS)}>
                  <div className="font-mono">${session.cost.toFixed(2)}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {formatCompact(session.tokens ?? session.inputTokens + session.outputTokens)}{' '}
                    toks
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatCompact(num: number): string {
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}
