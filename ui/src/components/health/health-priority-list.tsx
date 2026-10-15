import { HealthPriorityCard } from './health-priority-card';
import { type HealthCheck } from '@/hooks/use-health';
import { AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';

interface HealthPriorityListProps {
  checks: HealthCheck[];
}

export function HealthPriorityList({ checks }: HealthPriorityListProps) {
  const { t } = useTranslation();

  if (checks.length === 0) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 px-1">
        <h2 className="text-sm font-bold tracking-widest uppercase text-muted-foreground/60">
          {t('health.attentionRequired')}
        </h2>
        <div className="h-px flex-1 bg-border/40" />
        <span className="font-mono text-xs text-rose-500 font-bold">{checks.length}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AnimatePresence mode="popLayout">
          {checks.map((check) => (
            <HealthPriorityCard key={check.id} check={check} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
