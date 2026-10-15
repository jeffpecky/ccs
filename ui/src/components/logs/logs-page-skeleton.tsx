import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Logs surface initial-load skeleton.
 * Shape mirrors the new shell: 48px header, 40px tab bar, 3-pane body.
 * `aria-busy` lives here; phase-06 layers full a11y polish.
 */
export function LogsPageSkeleton() {
  const { t } = useTranslation();
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      aria-busy="true"
      aria-live="polite"
      aria-label={t('logsPageSkeleton.loadingLogs')}
    >
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-6 w-28" />
      </div>
      <div className="flex h-10 items-center border-b border-border px-4">
        <Skeleton className="h-6 w-40" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[22%_52%_26%] gap-px bg-border">
        <div className="space-y-3 bg-background p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
        <div className="space-y-2 bg-background p-3">
          {Array.from({ length: 12 }).map((_, idx) => (
            <Skeleton key={idx} className="h-8 w-full" />
          ))}
        </div>
        <div className="space-y-3 bg-background p-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </div>
  );
}
