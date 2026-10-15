import { Skeleton } from '@/components/ui/skeleton';
import { ShieldCheck } from 'lucide-react';
import { HealthStatusRibbon, HealthPriorityList, HealthAuditSection } from '@/components/health';
import { useHealth } from '@/hooks/use-health';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

function LoadingSkeleton() {
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-12">
      {/* Ribbon skeleton */}
      <Skeleton className="h-20 w-full rounded-2xl" />

      <div className="space-y-16">
        {/* Priority skeleton */}
        <div className="space-y-6">
          <Skeleton className="h-4 w-48" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Skeleton className="h-40 rounded-[2rem]" />
            <Skeleton className="h-40 rounded-[2rem]" />
          </div>
        </div>

        {/* Audit skeleton */}
        <div className="space-y-4">
          <Skeleton className="h-4 w-48" />
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function HealthPage() {
  const { t } = useTranslation();
  const { data, isLoading, refetch, dataUpdatedAt } = useHealth();

  if (isLoading && !data) {
    return <LoadingSkeleton />;
  }

  const priorityChecks =
    data?.checks.filter((c) => c.status === 'error' || c.status === 'warning') ?? [];
  const hasIssues = priorityChecks.length > 0;

  return (
    <div className="relative pb-20 overflow-hidden">
      {/* Dynamic Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className={cn(
            'absolute top-[5%] -left-[5%] w-[60%] h-[60%] blur-[100px] rounded-full opacity-[0.08] transition-colors duration-1000',
            hasIssues ? 'bg-rose-500' : 'bg-emerald-500'
          )}
        />
        <div
          className={cn(
            'absolute -bottom-[5%] -right-[5%] w-[50%] h-[50%] blur-[100px] rounded-full opacity-[0.06] transition-colors duration-1000',
            hasIssues ? 'bg-amber-500' : 'bg-blue-500'
          )}
        />
        {/* Grain overlay - Local SVG data URI for reliability */}
        <div
          className="absolute inset-0 opacity-[0.03] mix-blend-overlay"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          }}
        />
      </div>

      <div className="relative p-6 max-w-6xl mx-auto space-y-12">
        {/* Status Ribbon */}
        {data && (
          <HealthStatusRibbon
            summary={data.summary}
            version={data.version}
            lastScan={dataUpdatedAt}
            isLoading={isLoading}
            onRefresh={refetch}
          />
        )}

        <div className="space-y-16">
          {/* Priority Issues */}
          {hasIssues ? (
            <HealthPriorityList checks={priorityChecks} />
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="py-20 flex flex-col items-center text-center space-y-6"
            >
              <div className="relative">
                <div className="w-24 h-24 rounded-[2.5rem] bg-emerald-500/10 flex items-center justify-center">
                  <ShieldCheck className="w-12 h-12 text-emerald-500" />
                </div>
                <div className="absolute inset-0 w-24 h-24 rounded-[2.5rem] bg-emerald-500/20 animate-ping opacity-20" />
              </div>
              <div className="space-y-2">
                <h2 className="text-3xl font-bold tracking-tight">{t('health.allSystemsClear')}</h2>
                <p className="text-muted-foreground max-w-[40ch] mx-auto">
                  {t('health.optimalStateDesc')}
                </p>
              </div>
            </motion.div>
          )}

          {/* Detailed Audit */}
          {data?.groups && <HealthAuditSection groups={data.groups} />}
        </div>

        {/* Footer metadata */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-[10px] uppercase tracking-widest font-mono text-muted-foreground/60 border-t border-border/40 pt-8">
          <div className="flex items-center gap-6">
            <div className="flex flex-col">
              <span className="opacity-50">Build</span>
              <span className="text-foreground">{data?.version ?? '--'}</span>
            </div>
            <div className="flex flex-col">
              <span className="opacity-50">Platform</span>
              <span className="text-foreground">
                {typeof navigator !== 'undefined' ? navigator.platform : 'linux'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-muted/30 border border-border/40">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>{t('health.liveMonitoring')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
