import { Pause, Play, ArrowDownToLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FOCUS_RING } from './tokens';

export interface LiveTailControlsProps {
  isPaused: boolean;
  pendingCount: number;
  onTogglePause: () => void;
  onJumpToBottom?: () => void;
}

export function LiveTailControls({
  isPaused,
  pendingCount,
  onTogglePause,
  onJumpToBottom,
}: LiveTailControlsProps) {
  return (
    <div className="flex w-full items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={isPaused}
          onClick={onTogglePause}
          className={cn('h-7 gap-1.5 px-2 text-xs font-medium', FOCUS_RING)}
        >
          {isPaused ? (
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Pause className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {isPaused ? 'Resume tail' : 'Pause tail'}
        </Button>
        {isPaused && pendingCount > 0 ? (
          <button
            type="button"
            onClick={onTogglePause}
            aria-live="polite"
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 text-[11px] font-medium text-amber-700 dark:text-amber-300',
              FOCUS_RING
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
            {pendingCount} new {pendingCount === 1 ? 'entry' : 'entries'} · click to resume
          </button>
        ) : null}
      </div>
      {onJumpToBottom ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={onJumpToBottom}
          className={cn('h-7 gap-1.5 px-2 text-xs', FOCUS_RING)}
        >
          <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden="true" />
          Jump to bottom
        </Button>
      ) : null}
    </div>
  );
}
