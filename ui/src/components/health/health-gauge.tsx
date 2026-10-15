import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface HealthGaugeProps {
  passed: number;
  total: number;
  status: 'ok' | 'warning' | 'error';
  size?: 'sm' | 'md' | 'lg';
}

const sizeConfig = {
  sm: { dimension: 80, strokeWidth: 6, fontSize: 'text-lg', labelSize: 'text-[10px]' },
  md: { dimension: 120, strokeWidth: 8, fontSize: 'text-3xl', labelSize: 'text-xs' },
  lg: { dimension: 160, strokeWidth: 10, fontSize: 'text-4xl', labelSize: 'text-sm' },
};

const statusColors = {
  ok: { stroke: '#22C55E', glow: 'rgba(34, 197, 94, 0.4)' },
  warning: { stroke: '#EAB308', glow: 'rgba(234, 179, 8, 0.4)' },
  error: { stroke: '#EF4444', glow: 'rgba(239, 68, 68, 0.4)' },
};

export function HealthGauge({ passed, total, status, size = 'md' }: HealthGaugeProps) {
  const { t } = useTranslation();
  const config = sizeConfig[size];
  const colors = statusColors[status];
  const percentage = total > 0 ? Math.round((passed / total) * 100) : 0;

  const radius = (config.dimension - config.strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;
  const center = config.dimension / 2;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg
        width={config.dimension}
        height={config.dimension}
        className="transform -rotate-90"
        style={{ filter: `drop-shadow(0 0 8px ${colors.glow})` }}
      >
        {/* Background track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={config.strokeWidth}
          className="text-muted/30"
        />
        {/* Progress arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={colors.stroke}
          strokeWidth={config.strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className="transition-all duration-1000 ease-out"
        />
        {/* Animated glow dot at end of arc */}
        {percentage > 0 && (
          <circle
            cx={center + radius * Math.cos((percentage / 100) * 2 * Math.PI - Math.PI / 2)}
            cy={center + radius * Math.sin((percentage / 100) * 2 * Math.PI - Math.PI / 2)}
            r={config.strokeWidth / 2}
            fill={colors.stroke}
            className="animate-pulse"
            style={{ filter: `drop-shadow(0 0 4px ${colors.glow})` }}
          />
        )}
      </svg>
      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('font-mono font-bold tracking-tight', config.fontSize)}>
          {percentage}
        </span>
        <span
          className={cn(
            'font-mono uppercase tracking-widest text-muted-foreground',
            config.labelSize
          )}
        >
          {t('health.healthLabel')}
        </span>
      </div>
    </div>
  );
}
