/**
 * Premium compact stats visualization for account cards
 */

import { cn } from '@/lib/utils';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface AccountCardStatsProps {
  success: number;
  failure: number;
  showDetails: boolean;
}

export function AccountCardStats({ success, failure, showDetails }: AccountCardStatsProps) {
  const { t } = useTranslation();
  const total = success + failure;
  const successRate = total > 0 ? (success / total) * 100 : 100;

  return (
    <div className="mt-2 space-y-2">
      {/* Primary Row: Success Rate & Total */}
      <div className="flex items-end justify-between px-0.5">
        <div className="flex flex-col">
          <span className="text-[8px] text-muted-foreground/70 uppercase font-bold tracking-tight">
            {t('authMonitorLive.successRate')}
          </span>
          <span
            className={cn(
              'text-sm font-mono font-bold leading-none mt-0.5',
              successRate === 100
                ? 'text-emerald-600 dark:text-emerald-400'
                : successRate >= 90
                  ? 'text-amber-500'
                  : 'text-red-500'
            )}
          >
            {Math.round(successRate)}%
          </span>
        </div>
        <div className="flex flex-col items-end">
          {/* TODO i18n: missing key for "Volume" */}
          <span className="text-[8px] text-muted-foreground/70 uppercase font-bold tracking-tight">
            Volume
          </span>
          <span className="text-xs font-mono font-medium text-foreground/80 leading-none mt-0.5">
            {total.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Detailed Stats - Collapsible */}
      <div
        className={cn(
          'grid grid-cols-2 gap-2 overflow-hidden transition-all duration-300 ease-in-out',
          showDetails ? 'max-h-20 opacity-100 mt-2' : 'max-h-0 opacity-0 mt-0'
        )}
      >
        <div className="flex items-center gap-1.5 px-1.5 py-1 rounded-md bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/10">
          <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600 dark:text-emerald-400" />
          <span className="text-[10px] font-mono font-bold text-emerald-600 dark:text-emerald-400">
            {success}
          </span>
        </div>
        <div
          className={cn(
            'flex items-center gap-1.5 px-1.5 py-1 rounded-md border',
            failure > 0
              ? 'bg-red-500/5 dark:bg-red-500/10 border-red-500/20'
              : 'bg-muted/10 border-transparent opacity-40'
          )}
        >
          <XCircle
            className={cn('w-2.5 h-2.5', failure > 0 ? 'text-red-500' : 'text-muted-foreground')}
          />
          <span
            className={cn(
              'text-[10px] font-mono font-bold',
              failure > 0 ? 'text-red-500' : 'text-muted-foreground'
            )}
          >
            {failure}
          </span>
        </div>
      </div>
    </div>
  );
}
