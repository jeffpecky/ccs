import type { LogsLevel } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { getLevelLabel } from './utils';
import { LEVEL_TOKENS } from './tokens';

export function LogLevelBadge({ level, className }: { level: LogsLevel; className?: string }) {
  const token = LEVEL_TOKENS[level];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        token.border,
        token.bg,
        token.fg,
        className
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', token.dot)} aria-hidden="true" />
      {getLevelLabel(level)}
    </span>
  );
}
