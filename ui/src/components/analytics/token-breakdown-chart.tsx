/**
 * Token Breakdown Chart Component
 *
 * Displays token usage breakdown by type (input, output, cache).
 * Shows stacked bar chart with cost breakdown. Respects privacy mode.
 */

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import type { TokenBreakdown } from '@/hooks/use-usage';
import { cn } from '@/lib/utils';
import { usePrivacy, PRIVACY_BLUR_CLASS } from '@/contexts/privacy-context';
import { useTranslation } from 'react-i18next';

interface TokenBreakdownChartProps {
  data?: TokenBreakdown;
  isLoading?: boolean;
  className?: string;
}

const COLORS = {
  input: '#3b82f6', // blue-500
  output: '#f97316', // orange-500
  cacheCreation: '#06b6d4', // cyan-500
  cacheRead: '#22c55e', // green-500
};

export function TokenBreakdownChart({ data, isLoading, className }: TokenBreakdownChartProps) {
  const { privacyMode } = usePrivacy();
  const { t } = useTranslation();

  const chartData = useMemo(() => {
    if (!data) return [];

    return [
      {
        name: 'Input',
        tokens: data.input.tokens,
        cost: data.input.cost,
        fill: COLORS.input,
      },
      {
        name: 'Output',
        tokens: data.output.tokens,
        cost: data.output.cost,
        fill: COLORS.output,
      },
      {
        name: 'Cache Write',
        tokens: data.cacheCreation.tokens,
        cost: data.cacheCreation.cost,
        fill: COLORS.cacheCreation,
      },
      {
        name: 'Cache Read',
        tokens: data.cacheRead.tokens,
        cost: data.cacheRead.cost,
        fill: COLORS.cacheRead,
      },
    ];
  }, [data]);

  // Calculate totals for percentages
  const totals = useMemo(() => {
    const totalTokens = chartData.reduce((sum, d) => sum + d.tokens, 0);
    const totalCost = chartData.reduce((sum, d) => sum + d.cost, 0);
    return { totalTokens, totalCost };
  }, [chartData]);

  if (isLoading) {
    return <Skeleton className={cn('h-[250px] w-full', className)} />;
  }

  if (!data || chartData.every((d) => d.tokens === 0)) {
    return (
      <div className={cn('h-[250px] flex items-center justify-center', className)}>
        <p className="text-muted-foreground">{t('analyticsCards.noTokenData')}</p>
      </div>
    );
  }

  return (
    <div className={cn('w-full', className)}>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 5, right: 30, left: 70, bottom: 5 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            className="stroke-muted"
            horizontal={true}
            vertical={false}
          />

          <XAxis
            type="number"
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={{ className: 'stroke-muted' }}
            tickFormatter={(value) => formatNumber(value)}
          />

          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={{ className: 'stroke-muted' }}
            width={60}
          />

          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const item = payload[0].payload as (typeof chartData)[0];
              const tokenPercent =
                totals.totalTokens > 0
                  ? ((item.tokens / totals.totalTokens) * 100).toFixed(1)
                  : '0';
              const costPercent =
                totals.totalCost > 0 ? ((item.cost / totals.totalCost) * 100).toFixed(1) : '0';

              return (
                <div className="rounded-lg border bg-background p-3 shadow-lg">
                  <p className="font-medium mb-2">{item.name}</p>
                  <p className="text-sm">
                    Tokens: {formatNumber(item.tokens)} ({tokenPercent}%)
                  </p>
                  <p className="text-sm">
                    Cost: ${item.cost.toFixed(2)} ({costPercent}%)
                  </p>
                </div>
              );
            }}
          />

          <Legend
            formatter={(value) => <span className="text-xs">{value}</span>}
            wrapperStyle={{ paddingTop: '10px' }}
          />

          <Bar dataKey="tokens" name="Tokens" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>

      {/* Cost breakdown summary */}
      <div
        className={cn(
          'mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs',
          privacyMode && PRIVACY_BLUR_CLASS
        )}
      >
        {chartData.map((item) => (
          <div key={item.name} className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.fill }} />
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{item.name}</p>
              <p className="text-muted-foreground">${item.cost.toFixed(2)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatNumber(num: number): string {
  if (num >= 1000000000) {
    return `${(num / 1000000000).toFixed(1)}B`;
  }
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toLocaleString();
}
