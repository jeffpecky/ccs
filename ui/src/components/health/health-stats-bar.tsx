import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface HealthStatsBarProps {
  total: number;
  passed: number;
  warnings: number;
  errors: number;
  info: number;
}

interface StatItemProps {
  label: string;
  value: number;
  color: string;
  bgColor: string;
}

function StatItem({ label, value, color, bgColor }: StatItemProps) {
  return (
    <div className="flex items-center gap-2">
      <div className={cn('w-2 h-2 rounded-full animate-pulse', bgColor)} />
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <span className={cn('font-mono font-bold text-sm', color)}>{value}</span>
    </div>
  );
}

export function HealthStatsBar({ total, passed, warnings, errors, info }: HealthStatsBarProps) {
  const { t } = useTranslation();
  // Calculate percentages for the progress bar
  const passedPct = (passed / total) * 100;
  const warningPct = (warnings / total) * 100;
  const errorPct = (errors / total) * 100;
  const infoPct = (info / total) * 100;

  return (
    <div className="space-y-3">
      {/* Progress bar visualization */}
      <div className="h-2 rounded-full overflow-hidden bg-muted/50 flex">
        {errorPct > 0 && (
          <div
            className="h-full bg-red-500 transition-all duration-500"
            style={{ width: `${errorPct}%` }}
          />
        )}
        {warningPct > 0 && (
          <div
            className="h-full bg-yellow-500 transition-all duration-500"
            style={{ width: `${warningPct}%` }}
          />
        )}
        {infoPct > 0 && (
          <div
            className="h-full bg-blue-500 transition-all duration-500"
            style={{ width: `${infoPct}%` }}
          />
        )}
        {passedPct > 0 && (
          <div
            className="h-full bg-green-500 transition-all duration-500"
            style={{ width: `${passedPct}%` }}
          />
        )}
      </div>

      {/* Stats row */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {t('health.checks')}
          </span>
          <span className="font-mono font-bold text-lg">{total}</span>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <StatItem label="OK" value={passed} color="text-green-500" bgColor="bg-green-500" />
          <StatItem label="WARN" value={warnings} color="text-yellow-500" bgColor="bg-yellow-500" />
          <StatItem label="ERR" value={errors} color="text-red-500" bgColor="bg-red-500" />
          <StatItem label="INFO" value={info} color="text-blue-500" bgColor="bg-blue-500" />
        </div>
      </div>
    </div>
  );
}
