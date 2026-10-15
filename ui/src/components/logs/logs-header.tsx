import { RefreshCw, Settings, ScrollText, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FOCUS_RING, MONO_NUMERIC } from './tokens';

export interface LogsHeaderStats {
  entries: number;
  traces: number;
  errors: number;
}

export interface LogsHeaderProps {
  isFetching: boolean;
  hasError: boolean;
  capturedCount: number;
  stats?: LogsHeaderStats;
  onRefresh: () => void;
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
}

/**
 * Logs page header.
 *
 * Two rows:
 * 1. Title bar (`LOGS.STREAM` ornamental marker matching dashboard's
 *    `HEALTH.X` design language) + status pill + actions.
 * 2. Stat strip — entries / traces / errors counters mirroring the home
 *    page's `LIVE Account Monitor` card grid.
 *
 * Visual unity is the goal here, not minimalism for its own sake.
 */
export function LogsHeader({
  isFetching,
  hasError,
  capturedCount,
  stats,
  onRefresh,
  onOpenSettings,
  onOpenShortcuts,
}: LogsHeaderProps) {
  const status = hasError ? 'error' : isFetching ? 'syncing' : 'live';
  const statusLabel =
    status === 'error' ? 'Disconnected' : status === 'syncing' ? 'Syncing' : 'Live';
  const dotClass =
    status === 'error' ? 'bg-red-500' : status === 'syncing' ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className="shrink-0 border-b border-border bg-background">
      <div className="flex h-14 items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-3">
          <ScrollText className="h-4 w-4 text-foreground/70" aria-hidden="true" />
          <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
            LOGS.STREAM
          </span>
          <h1 className="text-base font-semibold tracking-tight text-foreground">Live activity</h1>
          <span
            role="status"
            aria-live="polite"
            className="ml-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-[12px] font-medium text-foreground/80"
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', dotClass)} aria-hidden="true" />
            {statusLabel}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            aria-label="Refresh logs"
            className={cn('h-8 gap-2 px-2.5 text-xs font-medium', FOCUS_RING)}
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')}
              aria-hidden="true"
            />
            Refresh
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenShortcuts}
            aria-label="Show keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            className={cn('h-8 w-8', FOCUS_RING)}
          >
            <HelpCircle className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenSettings}
            aria-label="Open logging settings"
            className={cn('h-8 w-8', FOCUS_RING)}
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Stat strip — visual unity with home page's `LIVE Account Monitor`. */}
      <div className="flex items-center gap-6 border-t border-border/60 bg-muted/20 px-4 py-2">
        <Stat label="Entries" value={capturedCount} fallback={`${capturedCount}`} />
        {stats ? (
          <>
            <Stat label="Traces" value={stats.traces} fallback={`${stats.traces}`} />
            <Stat
              label="Errors"
              value={stats.errors}
              fallback={`${stats.errors}`}
              tone={stats.errors > 0 ? 'error' : 'neutral'}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

interface StatProps {
  label: string;
  value: number;
  fallback: string;
  tone?: 'neutral' | 'error';
}

function Stat({ label, value, fallback, tone = 'neutral' }: StatProps) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          'text-[14px] font-semibold tabular-nums',
          tone === 'error' ? 'text-red-600 dark:text-red-400' : 'text-foreground',
          MONO_NUMERIC
        )}
        title={String(value)}
      >
        {fallback}
      </span>
    </div>
  );
}
