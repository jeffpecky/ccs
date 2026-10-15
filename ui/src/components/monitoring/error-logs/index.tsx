/**
 * Error Logs Monitor Component
 *
 * Displays CLIProxyAPI error logs with master-detail split view.
 * ETL: Parses raw logs into structured data for rich display.
 * - Left panel: Log list with status code, provider, endpoint, relative time
 * - Right panel: Tabbed view (Overview, Headers, Request, Response, Raw)
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useCliproxyErrorLogs } from '@/hooks/use-cliproxy-stats';
import { useCliproxyStatus } from '@/hooks/use-cliproxy-stats';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertTriangle, FileWarning, GripVertical, GripHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ErrorLogItem } from './error-log-item';
import { LogContentPanel } from './log-content-panel';

export function ErrorLogsMonitor() {
  const { t } = useTranslation();
  const { data: status, isLoading: isStatusLoading } = useCliproxyStatus();
  const { data: logs, isLoading, error } = useCliproxyErrorLogs(status?.running ?? false);

  // Vertical resize state
  const [height, setHeight] = useState(500);
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-scroll handler
  const stopAutoScroll = () => {
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
  };

  // Resize handlers
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const containerTopDoc = rect.top + window.scrollY;
      const newHeight = e.pageY - containerTopDoc;

      // Constrain height (min 300, no max)
      setHeight(Math.max(300, newHeight));

      // Auto-scroll logic
      const viewportHeight = window.innerHeight;
      const distFromBottom = viewportHeight - e.clientY;
      const scrollSpeed = 15;

      stopAutoScroll();

      if (distFromBottom < 50) {
        scrollIntervalRef.current = setInterval(() => {
          window.scrollBy(0, scrollSpeed);
        }, 16);
      } else if (e.clientY < 50) {
        scrollIntervalRef.current = setInterval(() => {
          window.scrollBy(0, -scrollSpeed);
        }, 16);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      stopAutoScroll();
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
      stopAutoScroll();
    };
  }, [isResizing]);

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  // Compute default selection (first log name or null)
  const defaultLogName = useMemo(() => logs?.[0]?.name ?? null, [logs]);

  // Use controlled selection that defaults to first log
  const [selectedLog, setSelectedLog] = useState<string | null>(null);

  // Effective selection: use user selection if available, otherwise default
  const effectiveSelection = selectedLog ?? defaultLogName;

  // Get absolute path for the selected log
  const selectedAbsolutePath = useMemo(() => {
    if (!effectiveSelection || !logs) return undefined;
    const log = logs.find((l) => l.name === effectiveSelection);
    return log?.absolutePath;
  }, [effectiveSelection, logs]);

  // Guards
  if (isStatusLoading) return null;
  if (!status?.running) return null;
  if (isLoading) {
    return (
      <div className="rounded-xl border border-border overflow-hidden font-mono text-sm bg-card/50 dark:bg-zinc-900/60 backdrop-blur-sm h-[500px]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="p-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }
  if (!logs || logs.length === 0) return null;

  const errorCount = logs.length;

  return (
    <div
      ref={containerRef}
      className="rounded-xl border border-border overflow-hidden font-mono text-sm text-foreground bg-card/50 dark:bg-zinc-900/60 backdrop-blur-sm flex flex-col shadow-sm transition-[height] duration-0 ease-linear relative group/container"
      style={{ height }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-gradient-to-r from-amber-500/10 via-transparent to-transparent dark:from-amber-500/15 shrink-0">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-semibold tracking-tight">{t('errorLogs.title')}</span>
          <span className="text-xs text-muted-foreground ml-1">
            {t('errorLogs.failedRequests', { count: errorCount })}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileWarning className="w-3.5 h-3.5" />
          <span>{t('errorLogs.cliproxyDiagnostics')}</span>
        </div>
      </div>

      {/* Resizable Panel Layout */}
      <div className="flex-1 min-h-0">
        <PanelGroup direction="horizontal">
          {/* Left Panel: Log List */}
          <Panel defaultSize={30} minSize={20} maxSize={50} className="flex flex-col min-w-0">
            <ScrollArea className="h-full">
              <div className="divide-y divide-border/50">
                {logs.slice(0, 50).map((log) => (
                  <ErrorLogItem
                    key={log.name}
                    name={log.name}
                    size={log.size}
                    modified={log.modified}
                    isSelected={effectiveSelection === log.name}
                    onClick={() => setSelectedLog(log.name)}
                    statusCode={log.statusCode}
                    model={log.model}
                  />
                ))}
              </div>
              {logs.length > 50 && (
                <div className="px-3 py-3 text-center text-[10px] text-muted-foreground border-t border-border/50">
                  {t('errorLogs.showingCount', { total: logs.length })}
                </div>
              )}
            </ScrollArea>
          </Panel>

          {/* Resize Handle */}
          <PanelResizeHandle className="w-[1px] bg-border hover:bg-primary/50 transition-colors flex items-center justify-center group relative z-10 w-2 -ml-1 flex items-center justify-center outline-none">
            <div className="w-[1px] h-full bg-border group-hover:bg-primary/50 transition-colors" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-8 rounded-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-muted border border-border">
              <GripVertical className="h-4 w-4 text-muted-foreground" />
            </div>
          </PanelResizeHandle>

          {/* Right Panel: Log Content */}
          <Panel className="flex flex-col min-w-0 bg-background/50">
            <LogContentPanel name={effectiveSelection} absolutePath={selectedAbsolutePath} />
          </Panel>
        </PanelGroup>
      </div>

      {/* Use standard footer if error, otherwise show resize handle */}
      {error ? (
        <div className="px-4 py-2 border-t border-border text-xs text-destructive bg-destructive/5 shrink-0">
          {error.message}
        </div>
      ) : (
        <div
          className="h-2 bg-border/10 border-t border-border/30 hover:bg-primary/10 transition-colors cursor-row-resize flex items-center justify-center group/handle shrink-0"
          onMouseDown={startResizing}
        >
          <GripHorizontal className="w-8 h-3 text-border group-hover:text-primary/50 transition-colors" />
        </div>
      )}
    </div>
  );
}

// Re-export components
export { ErrorLogItem } from './error-log-item';
export { LogContentPanel } from './log-content-panel';
export { TabButton, StatusBadge } from './ui-primitives';
export { OverviewTab, HeadersTab, BodyTab, RawTab } from './tab-components';
export type { TabType, ErrorLogItemProps, LogContentPanelProps } from './types';
