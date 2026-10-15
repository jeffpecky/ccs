import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ErrorLogsMonitor } from '@/components/error-logs-monitor';
import { LogsConfigCard } from '@/components/logs/logs-config-card';
import { LogsDetailPanel } from '@/components/logs/logs-detail-panel';
import { LogsEntryList } from '@/components/logs/logs-entry-list';
import { LogsEmpty } from '@/components/logs/logs-empty';
import { LogsError } from '@/components/logs/logs-error';
import { LogsFilters } from '@/components/logs/logs-filters';
import { LogsHeader } from '@/components/logs/logs-header';
import { LiveTailControls } from '@/components/logs/live-tail-controls';
import { LogsShortcutsDialog } from '@/components/logs/logs-shortcuts-dialog';
import { useLogsKeyboardNav } from '@/components/logs/use-logs-keyboard-nav';
import {
  getSourceLabelMap,
  type useLogsWorkspace,
  type useUpdateLogsConfig,
} from '@/hooks/use-logs';

const LAYOUT_KEY = 'ccs.logs.layout.v1';
const DESKTOP_BREAKPOINT = 1200;

type Workspace = ReturnType<typeof useLogsWorkspace>;
type UpdateConfig = ReturnType<typeof useUpdateLogsConfig>;

interface LayoutSizes {
  filters: number;
  list: number;
  detail: number;
}

const DEFAULT_SIZES: LayoutSizes = { filters: 22, list: 52, detail: 26 };

function readSavedSizes(): LayoutSizes {
  if (typeof window === 'undefined') return DEFAULT_SIZES;
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    if (!raw) return DEFAULT_SIZES;
    const parsed = JSON.parse(raw) as Partial<LayoutSizes>;
    if (
      typeof parsed.filters === 'number' &&
      typeof parsed.list === 'number' &&
      typeof parsed.detail === 'number'
    ) {
      return { filters: parsed.filters, list: parsed.list, detail: parsed.detail };
    }
  } catch {
    // ignore
  }
  return DEFAULT_SIZES;
}

function useDesktopLayout(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= DESKTOP_BREAKPOINT
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
    const sync = () => setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return isDesktop;
}

type SheetKey = 'settings' | 'detail' | null;

export interface LogsShellProps {
  workspace: Workspace;
  updateConfig: UpdateConfig;
}

export function LogsShell({ workspace, updateConfig }: LogsShellProps) {
  const isDesktop = useDesktopLayout();
  const sourceLabels = useMemo(
    () => getSourceLabelMap(workspace.sourcesQuery.data ?? []),
    [workspace.sourcesQuery.data]
  );
  const [activeSheet, setActiveSheet] = useState<SheetKey>(null);
  const [sizes, setSizes] = useState<LayoutSizes>(readSavedSizes);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const config = workspace.configQuery.data;

  const handleRefresh = useCallback(() => {
    void Promise.all([workspace.sourcesQuery.refetch(), workspace.entriesQuery.refetch()]);
  }, [workspace.entriesQuery, workspace.sourcesQuery]);

  const onLayout = useCallback((next: number[]) => {
    if (next.length !== 3) return;
    const [filters, list, detail] = next as [number, number, number];
    const updated = { filters, list, detail };
    setSizes(updated);
    try {
      window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
  }, []);

  const openSettings = useCallback(() => setActiveSheet('settings'), []);
  const openDetailSheet = useCallback(() => setActiveSheet('detail'), []);
  const closeSheet = useCallback(() => setActiveSheet(null), []);

  // On mobile, selecting an entry opens the detail bottom-sheet.
  // We wrap `setSelectedEntryId` so it stays an event-driven side effect.
  const baseSetSelectedEntryId = workspace.setSelectedEntryId;
  const handleSelectEntry = useCallback(
    (id: string | null) => {
      baseSetSelectedEntryId(id);
      if (!isDesktop && id) setActiveSheet('detail');
    },
    [baseSetSelectedEntryId, isDesktop]
  );

  const handleShowTrace = useCallback(
    (requestId: string) => {
      workspace.setRequestIdFilter(requestId);
      workspace.setSearch('');
    },
    [workspace]
  );

  const entryIds = useMemo(
    () => (workspace.entriesQuery.data ?? []).map((e) => e.id),
    [workspace.entriesQuery.data]
  );

  // Derive header stat strip values once per data refetch.
  const headerStats = useMemo(() => {
    const data = workspace.entriesQuery.data ?? [];
    const requestIds = new Set<string>();
    let errors = 0;
    for (const entry of data) {
      if (entry.requestId) requestIds.add(entry.requestId);
      if (entry.level === 'error') errors += 1;
    }
    return { entries: data.length, traces: requestIds.size, errors };
  }, [workspace.entriesQuery.data]);

  const focusSearch = useCallback(() => {
    const input = document.getElementById('logs-search') as HTMLInputElement | null;
    if (input) {
      input.focus();
      input.select();
    } else if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, []);

  useLogsKeyboardNav({
    entryIds,
    selectedId: workspace.selectedEntryId,
    onSelect: workspace.setSelectedEntryId,
    onTogglePause: workspace.liveTail.togglePause,
    onFocusSearch: focusSearch,
    onOpenShortcuts: () => setShortcutsOpen(true),
    onCloseDetail: !isDesktop && activeSheet === 'detail' ? closeSheet : undefined,
  });

  if (!config) return null;

  const filtersNode = (
    <LogsFilters
      sources={workspace.sourcesQuery.data ?? []}
      selectedSource={workspace.selectedSource}
      onSourceChange={workspace.setSelectedSource}
      selectedLevel={workspace.selectedLevel}
      onLevelChange={workspace.setSelectedLevel}
      search={workspace.search}
      onSearchChange={workspace.setSearch}
      limit={workspace.limit}
      onLimitChange={workspace.setLimit}
      onRefresh={handleRefresh}
      isRefreshing={workspace.entriesQuery.isFetching || workspace.sourcesQuery.isFetching}
      moduleFilter={workspace.moduleFilter}
      onModuleChange={workspace.setModuleFilter}
      stageFilter={workspace.stageFilter}
      onStageChange={workspace.setStageFilter}
      requestIdFilter={workspace.requestIdFilter}
      onRequestIdChange={workspace.setRequestIdFilter}
      timeWindow={workspace.timeWindow}
      onTimeWindowChange={workspace.setTimeWindow}
      hideDashboardInternals={workspace.hideDashboardInternals}
      onHideDashboardInternalsChange={workspace.setHideDashboardInternals}
      onClearAll={workspace.clearAdvancedFilters}
    />
  );

  const liveTailSlot = (
    <LiveTailControls
      isPaused={workspace.liveTail.isPaused}
      pendingCount={workspace.liveTail.pendingCount}
      onTogglePause={workspace.liveTail.togglePause}
    />
  );

  const listNode = workspace.entriesQuery.error ? (
    <LogsError
      error={workspace.entriesQuery.error as Error}
      onRetry={() => void workspace.entriesQuery.refetch()}
    />
  ) : (
    <LogsEntryList
      entries={workspace.entriesQuery.data ?? []}
      selectedEntryId={workspace.selectedEntryId}
      onSelect={handleSelectEntry}
      sourceLabels={sourceLabels}
      isLoading={workspace.entriesQuery.isLoading}
      isFetching={workspace.entriesQuery.isFetching}
      liveTailSlot={liveTailSlot}
    />
  );

  const detailNode = workspace.isSelectionOutOfScope ? (
    <LogsEmpty variant="selectionOutOfScope" onClearFilters={workspace.clearAdvancedFilters} />
  ) : (
    <LogsDetailPanel
      entry={workspace.selectedEntry}
      sourceLabel={
        workspace.selectedEntry ? sourceLabels[workspace.selectedEntry.source] : undefined
      }
      onShowTrace={handleShowTrace}
      redact={Boolean(config.redact)}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <LogsHeader
        isFetching={workspace.entriesQuery.isFetching || workspace.sourcesQuery.isFetching}
        hasError={Boolean(workspace.entriesQuery.error)}
        capturedCount={workspace.entriesQuery.data?.length ?? 0}
        stats={headerStats}
        onRefresh={handleRefresh}
        onOpenSettings={openSettings}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />

      <Tabs defaultValue="stream" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-10 shrink-0 items-center border-b border-border bg-background px-4">
          <TabsList className="h-8 bg-muted/40">
            <TabsTrigger value="stream" className="text-xs">
              Stream
            </TabsTrigger>
            <TabsTrigger value="errors" className="text-xs">
              Upstream errors
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="stream"
          className="m-0 flex min-h-0 flex-1 overflow-hidden focus-visible:outline-none"
        >
          {isDesktop ? (
            <PanelGroup
              direction="horizontal"
              onLayout={onLayout}
              className="flex min-h-0 flex-1"
              autoSaveId={LAYOUT_KEY}
            >
              <Panel defaultSize={sizes.filters} minSize={16} maxSize={36} order={1}>
                <div className="flex h-full min-h-0 flex-col overflow-y-auto border-r border-border bg-background p-4">
                  {filtersNode}
                </div>
              </Panel>
              <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-foreground/20 data-[resize-handle-active]:bg-foreground/30" />
              <Panel defaultSize={sizes.list} minSize={32} order={2}>
                <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
                  {listNode}
                </div>
              </Panel>
              <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-foreground/20 data-[resize-handle-active]:bg-foreground/30" />
              <Panel defaultSize={sizes.detail} minSize={20} maxSize={42} order={3}>
                <div className="flex h-full min-h-0 flex-col overflow-hidden border-l border-border bg-background">
                  {detailNode}
                </div>
              </Panel>
            </PanelGroup>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="border-b border-border p-3">{filtersNode}</div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{listNode}</div>
            </div>
          )}
        </TabsContent>

        <TabsContent
          value="errors"
          className="m-0 flex-1 overflow-y-auto p-4 focus-visible:outline-none"
        >
          <div className="mx-auto max-w-5xl space-y-4">
            <header className="space-y-1">
              <h2 className="text-base font-semibold text-foreground">CLIProxy upstream errors</h2>
              <p className="text-sm text-muted-foreground">
                Historical failure stream from the upstream proxy. Distinct from the structured
                stream.
              </p>
            </header>
            <ErrorLogsMonitor />
          </div>
        </TabsContent>
      </Tabs>

      {/* Logging settings sheet (right). Phase-05 may replace body with extracted form. */}
      <Sheet
        open={activeSheet === 'settings'}
        onOpenChange={(open) => (open ? openSettings() : closeSheet())}
      >
        <SheetContent side="right" className="w-full max-w-md">
          <SheetHeader>
            <SheetTitle>Logging settings</SheetTitle>
            <SheetDescription>
              Configure retention, redaction, and sampling for the logs surface.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 px-4 pb-6">
            <LogsConfigCard
              config={config}
              onSave={(payload) => updateConfig.mutate(payload)}
              isPending={updateConfig.isPending}
            />
          </div>
        </SheetContent>
      </Sheet>

      <LogsShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {/* Mobile detail sheet (bottom). Desktop renders detail in panel directly. */}
      {!isDesktop ? (
        <Sheet
          open={activeSheet === 'detail'}
          onOpenChange={(open) => (open ? openDetailSheet() : closeSheet())}
        >
          <SheetContent side="bottom" className="h-[85vh]">
            <SheetHeader>
              <SheetTitle>Entry detail</SheetTitle>
              <SheetDescription>Selected log entry context and raw payload.</SheetDescription>
            </SheetHeader>
            <div className="mt-2 flex min-h-0 flex-1 overflow-hidden">{detailNode}</div>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  );
}
