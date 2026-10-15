/**
 * Quick Stats Row Component
 * Compact stats display for CLIProxy Overview tab
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Activity, CheckCircle2, Coins, Cpu } from 'lucide-react';
import { useCliproxyStats } from '@/hooks/use-cliproxy';

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string | number;
}

function StatCard({ icon, label, value }: StatCardProps) {
  return (
    <Card className="py-3">
      <CardContent className="p-0 px-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-muted text-muted-foreground">{icon}</div>
          <div>
            <p className="text-2xl font-bold">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map((i) => (
        <Card key={i} className="py-3">
          <CardContent className="p-0 px-4">
            <div className="h-12 bg-muted animate-pulse rounded" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function QuickStatsRow() {
  const { t } = useTranslation();
  const { data: stats, isLoading } = useCliproxyStats();

  if (isLoading) {
    return <StatsSkeleton />;
  }

  const usage = stats?.usage ?? {};
  const totalRequests = (usage.total_requests as number) ?? 0;
  const successCount = (usage.success_count as number) ?? 0;
  const totalTokens = (usage.total_tokens as number) ?? 0;

  const successRate = totalRequests > 0 ? ((successCount / totalRequests) * 100).toFixed(1) : '0';

  const tokenDisplay =
    totalTokens > 1000 ? `${(totalTokens / 1000).toFixed(1)}K` : String(totalTokens);

  const apis = (usage.apis as Record<string, { models?: Record<string, unknown> }>) ?? {};
  const modelCount = Object.keys(apis).reduce((count, api) => {
    const apiData = apis[api];
    return count + Object.keys(apiData?.models ?? {}).length;
  }, 0);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard
        icon={<Activity className="w-4 h-4" />}
        label={t('quickStats.totalRequests')}
        value={totalRequests}
      />
      <StatCard
        icon={<CheckCircle2 className="w-4 h-4" />}
        label={t('quickStats.successRate')}
        value={`${successRate}%`}
      />
      <StatCard
        icon={<Coins className="w-4 h-4" />}
        label={t('quickStats.totalTokens')}
        value={tokenDisplay}
      />
      <StatCard
        icon={<Cpu className="w-4 h-4" />}
        label={t('quickStats.activeModels')}
        value={modelCount}
      />
    </div>
  );
}
