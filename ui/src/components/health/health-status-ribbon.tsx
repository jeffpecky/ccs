import { useEffect, useState } from 'react';
import { Cpu, RefreshCw, Terminal, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface HealthStatusRibbonProps {
  summary: {
    passed: number;
    warnings: number;
    errors: number;
    total: number;
    info: number;
  };
  version: string;
  lastScan: number;
  isLoading: boolean;
  onRefresh: () => void;
}

function formatRelativeTime(
  timestamp: number,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return t('health.justNow');
  if (seconds < 60) return t('health.secondsAgo', { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('health.minutesAgo', { count: minutes });
  // Roll up to hours so a stale "120 minutes ago" reads as "2 hours ago"
  const hours = Math.floor(minutes / 60);
  return t('health.hoursAgo', { count: hours });
}

export function HealthStatusRibbon({
  summary,
  version,
  lastScan,
  isLoading,
  onRefresh,
}: HealthStatusRibbonProps) {
  const { t } = useTranslation();

  // formatRelativeTime reads Date.now() during render. Without a ticking
  // re-render, the "last scan" label freezes at whatever it showed on mount
  // and never advances to "1 minute ago", "2 hours ago", etc. — even though
  // the underlying lastScan timestamp is stale. Force a re-render every
  // second; the cost is negligible (one tiny component) and the UX win is
  // a label that actually behaves like a relative timestamp.
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const copyDoctorCommand = () => {
    navigator.clipboard.writeText('ccs doctor');
    toast.success(t('health.copied'));
  };

  const hasIssues = summary.errors > 0 || summary.warnings > 0;

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-2xl border transition-all duration-500',
        hasIssues
          ? 'bg-rose-500/5 border-rose-500/20 shadow-[0_0_20px_-12px_rgba(244,63,94,0.3)]'
          : 'bg-emerald-500/5 border-emerald-500/20 shadow-[0_0_20px_-12px_rgba(16,185,129,0.3)]'
      )}
    >
      {/* Animated Mesh Gradient Background */}
      <div
        className={cn(
          'absolute inset-0 opacity-[0.05] blur-3xl pointer-events-none transition-colors duration-1000',
          hasIssues ? 'bg-rose-500' : 'bg-emerald-500'
        )}
      />

      <div className="relative flex flex-col md:flex-row items-center gap-4 px-6 py-4">
        {/* Status Indicator */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="relative">
            <div
              className={cn(
                'w-2.5 h-2.5 rounded-full',
                hasIssues ? 'bg-rose-500' : 'bg-emerald-500'
              )}
            />
            <div
              className={cn(
                'absolute inset-0 rounded-full animate-ping opacity-40',
                hasIssues ? 'bg-rose-500' : 'bg-emerald-500'
              )}
            />
          </div>
          <h1 className="font-mono text-sm font-bold tracking-tight uppercase">
            {hasIssues ? t('health.issuesDetected') : t('health.systemOptimal')}
          </h1>
        </div>

        <div className="hidden md:block h-4 w-px bg-border/50" />

        {/* Stats Summary */}
        <div className="flex items-center gap-6 text-xs font-mono">
          <div className="flex flex-col">
            <span className="text-muted-foreground uppercase text-[10px] tracking-widest">
              Checks
            </span>
            <span>{summary.total}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-muted-foreground uppercase text-[10px] tracking-widest">
              Passed
            </span>
            <span className="text-emerald-500">{summary.passed}</span>
          </div>
          {summary.warnings > 0 && (
            <div className="flex flex-col">
              <span className="text-muted-foreground uppercase text-[10px] tracking-widest">
                Warnings
              </span>
              <span className="text-amber-500 font-bold">{summary.warnings}</span>
            </div>
          )}
          {summary.errors > 0 && (
            <div className="flex flex-col">
              <span className="text-muted-foreground uppercase text-[10px] tracking-widest">
                Errors
              </span>
              <span className="text-rose-500 font-bold underline decoration-rose-500/30">
                {summary.errors}
              </span>
            </div>
          )}
        </div>

        <div className="flex-1" />

        {/* Meta & Actions */}
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end text-[10px] font-mono text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <RefreshCw className={cn('w-2.5 h-2.5', isLoading && 'animate-spin')} />
              <span>{lastScan ? formatRelativeTime(lastScan, t) : '--'}</span>
            </div>
            <div className="flex items-center gap-1.5 opacity-60">
              <Cpu className="w-2.5 h-2.5" />
              <span>{version}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={copyDoctorCommand}
              className="h-8 px-3 gap-2 font-mono text-[10px] bg-background/40 hover:bg-background/60 border border-border/40 rounded-full"
            >
              <Terminal className="w-3 h-3" />
              <span className="hidden sm:inline">ccs doctor</span>
              <Copy className="w-3 h-3 opacity-40" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onRefresh}
              disabled={isLoading}
              className="h-8 w-8 rounded-full bg-background/40 hover:bg-background/60 border border-border/40"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
