import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface LogsErrorProps {
  error: Error | { message?: string } | null;
  onRetry: () => void;
}

export function LogsError({ error, onRetry }: LogsErrorProps) {
  const message = error?.message ?? 'Unknown error fetching logs.';
  return (
    <div
      role="alert"
      className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-semibold text-foreground">Could not load logs</h3>
      <p className="max-w-sm text-[13px] leading-relaxed text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry} className="gap-2">
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        Retry
      </Button>
    </div>
  );
}
