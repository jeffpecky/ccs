/**
 * Error Log Item Component
 * Individual log entry in the list view - shows status code, model, endpoint, time
 */

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Clock } from 'lucide-react';
import { ProviderIcon } from '@/components/shared/provider-icon';
import { parseFilename, formatRelativeTime } from '@/lib/error-log-parser';
import type { ErrorLogItemProps } from './types';

/** Get status badge color based on HTTP status code */
function getStatusColor(code?: number): string {
  if (!code) return 'bg-gray-100 text-gray-600';
  if (code === 429) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
  if (code >= 500) return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
  if (code >= 400)
    return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400';
  return 'bg-gray-100 text-gray-600';
}

/** Format model name for display (full name) */
function formatModel(model?: string): string {
  if (!model) return '';
  return model;
}

export function ErrorLogItem({
  name,
  size: _size,
  modified,
  isSelected,
  onClick,
  statusCode,
  model,
}: ErrorLogItemProps) {
  const parsed = useMemo(() => parseFilename(name), [name]);
  const displayModel = useMemo(() => formatModel(model), [model]);

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full px-2.5 py-2 flex items-center gap-2 text-left transition-colors',
        'hover:bg-muted/40 border-l-[3px]',
        isSelected ? 'bg-muted/50 border-l-red-500' : 'border-l-transparent'
      )}
    >
      {/* Status Badge - prominent */}
      <span
        className={cn(
          'shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded min-w-[32px] text-center',
          getStatusColor(statusCode)
        )}
      >
        {statusCode || '???'}
      </span>

      {/* Provider Icon */}
      <ProviderIcon
        provider={parsed.provider}
        size={18}
        withBackground={true}
        className="shrink-0"
      />

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Row 1: Endpoint */}
        <span className="text-[11px] font-medium text-foreground truncate">
          {parsed.endpoint || 'unknown'}
        </span>
        {/* Row 2: Model (full name) */}
        {displayModel && (
          <span className="text-[10px] text-muted-foreground truncate" title={displayModel}>
            {displayModel}
          </span>
        )}
        {/* Row 3: Time */}
        <div className="flex items-center gap-1 text-[9px] text-muted-foreground/60">
          <Clock className="w-2.5 h-2.5" />
          <span>{formatRelativeTime(modified)}</span>
        </div>
      </div>
    </button>
  );
}
