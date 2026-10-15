import { Inbox, FilterX, MousePointer, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type LogsEmptyVariant = 'selection' | 'noData' | 'noResults' | 'selectionOutOfScope';

export interface LogsEmptyProps {
  variant: LogsEmptyVariant;
  onClearFilters?: () => void;
}

const COPY: Record<LogsEmptyVariant, { title: string; body: string; icon: typeof Inbox }> = {
  selection: {
    title: 'No entry selected',
    body: 'Pick a row in the list to inspect its context. Use j/k to move and Enter to focus the detail.',
    icon: MousePointer,
  },
  noData: {
    title: 'No log activity yet',
    body: 'Once requests flow through the system, structured entries will appear here.',
    icon: Inbox,
  },
  noResults: {
    title: 'No entries match your filters',
    body: 'Adjust source, level, search, or time window to see more entries.',
    icon: FilterX,
  },
  selectionOutOfScope: {
    title: 'Selected entry not visible under current filter',
    body: 'Clear your filter or select another row to inspect details.',
    icon: EyeOff,
  },
};

export function LogsEmpty({ variant, onClearFilters }: LogsEmptyProps) {
  const { title, body, icon: Icon } = COPY[variant];
  const showClear = variant === 'selectionOutOfScope' || variant === 'noResults';

  return (
    <div
      role="status"
      className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-muted/30 text-muted-foreground">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="max-w-xs text-[13px] leading-relaxed text-muted-foreground">{body}</p>
      {showClear && onClearFilters ? (
        <Button variant="outline" size="sm" onClick={onClearFilters} className="mt-1">
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
