/**
 * UI Primitives for Error Logs Monitor
 * TabButton and StatusBadge components
 */

import { cn } from '@/lib/utils';
import { getStatusColor } from '@/lib/error-log-parser';

/** Tab button component */
export function TabButton({
  active,
  onClick,
  children,
  icon: Icon,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-2.5 py-1.5 text-xs font-medium rounded transition-colors flex items-center gap-1.5',
        active
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
      )}
    >
      {Icon && <Icon className="w-3.5 h-3.5" />}
      {children}
    </button>
  );
}

/** Status badge component */
export function StatusBadge({ code }: { code: number }) {
  const colorClass = getStatusColor(code);
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center min-w-[36px] px-2 py-0.5 rounded text-xs font-bold',
        'bg-current/10 border border-current/20',
        colorClass
      )}
    >
      {code}
    </span>
  );
}
