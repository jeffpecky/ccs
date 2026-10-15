import { ChevronRight, Copy, Terminal, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useFixHealth, type HealthCheck } from '@/hooks/use-health';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

const statusConfig = {
  ok: { dot: 'bg-green-500', label: 'OK', labelColor: 'text-green-500' },
  warning: { dot: 'bg-yellow-500', label: 'WARN', labelColor: 'text-yellow-500' },
  error: { dot: 'bg-red-500', label: 'ERR', labelColor: 'text-red-500' },
  info: { dot: 'bg-blue-500', label: 'INFO', labelColor: 'text-blue-500' },
};

export function HealthCheckItem({ check }: { check: HealthCheck }) {
  const { t } = useTranslation();
  const fixMutation = useFixHealth();
  const config = statusConfig[check.status];
  const [isOpen, setIsOpen] = useState(false);
  const hasExpandableContent = check.details || check.fix;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t('health.copied'));
  };

  // Compact single-line display for items without expandable content
  if (!hasExpandableContent) {
    return (
      <div
        className={cn(
          'group flex items-center gap-3 px-3 py-2 rounded-lg',
          'hover:bg-muted/50 transition-colors duration-150',
          'border border-transparent hover:border-border/50'
        )}
      >
        {/* Status dot with pulse animation */}
        <div className="relative flex items-center justify-center w-4 h-4">
          <div className={cn('w-2 h-2 rounded-full', config.dot)} />
          {check.status !== 'ok' && (
            <div
              className={cn('absolute w-2 h-2 rounded-full animate-ping opacity-75', config.dot)}
            />
          )}
        </div>

        {/* Check name */}
        <span className="flex-1 text-sm font-medium truncate">{check.name}</span>

        {/* Status label */}
        <span className={cn('font-mono text-xs font-semibold', config.labelColor)}>
          [{config.label}]
        </span>

        {/* Fix button for fixable non-ok items */}
        {check.fixable && check.status !== 'ok' && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => fixMutation.mutate(check.id)}
            disabled={fixMutation.isPending}
            className="h-6 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Wrench className="w-3 h-3 mr-1" />
            {t('health.fix')}
          </Button>
        )}
      </div>
    );
  }

  // Expandable display for items with details or fix commands
  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={cn(
          'group rounded-lg border transition-all duration-150',
          isOpen
            ? 'border-border bg-muted/30'
            : 'border-transparent hover:border-border/50 hover:bg-muted/50'
        )}
      >
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center gap-3 px-3 py-2 text-left">
            {/* Status dot */}
            <div className="relative flex items-center justify-center w-4 h-4">
              <div className={cn('w-2 h-2 rounded-full', config.dot)} />
              {check.status !== 'ok' && (
                <div
                  className={cn(
                    'absolute w-2 h-2 rounded-full animate-ping opacity-75',
                    config.dot
                  )}
                />
              )}
            </div>

            {/* Check name */}
            <span className="flex-1 text-sm font-medium truncate">{check.name}</span>

            {/* Status label */}
            <span className={cn('font-mono text-xs font-semibold', config.labelColor)}>
              [{config.label}]
            </span>

            {/* Chevron indicator */}
            <ChevronRight
              className={cn(
                'w-4 h-4 text-muted-foreground transition-transform duration-200',
                isOpen && 'rotate-90'
              )}
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-3 pb-3 pt-1 space-y-2 ml-7">
            {/* Message */}
            <p className="text-xs text-muted-foreground">{check.message}</p>

            {/* Details block */}
            {check.details && (
              <pre className="text-xs font-mono text-muted-foreground bg-background/50 rounded p-2 overflow-x-auto border border-border/50">
                {check.details}
              </pre>
            )}

            {/* Fix command block */}
            {check.fix && (
              <div className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 bg-background/50 rounded px-2 py-1.5 border border-border/50">
                  <Terminal className="w-3 h-3 text-muted-foreground shrink-0" />
                  <code className="text-xs font-mono flex-1 truncate">{check.fix}</code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => check.fix && copyToClipboard(check.fix)}
                    className="h-5 w-5 p-0"
                  >
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>

                {check.fixable && check.status !== 'ok' && (
                  <Button
                    size="sm"
                    onClick={() => fixMutation.mutate(check.id)}
                    disabled={fixMutation.isPending}
                    className="h-7 px-3 text-xs"
                  >
                    <Wrench className="w-3 h-3 mr-1" />
                    {t('health.applyFix')}
                  </Button>
                )}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
