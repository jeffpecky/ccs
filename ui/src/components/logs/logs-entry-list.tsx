import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Virtuoso } from 'react-virtuoso';
import type { LogsEntry } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { LogsRow } from './logs-row';
import { LogsTraceRow } from './logs-trace-row';
import { type RowDensity } from './tokens';
import { LogsEmpty } from './logs-empty';
import { deriveTraceGroups, type DerivedItem } from './derive-trace-groups';

export interface LogsEntryListProps {
  entries: LogsEntry[];
  selectedEntryId: string | null;
  onSelect: (entryId: string) => void;
  sourceLabels: Record<string, string>;
  isLoading: boolean;
  isFetching: boolean;
  /**
   * Slot for live-tail controls (pause/resume + pending pill).
   * Phase-04 owns the controls; phase-03 just provides the slot.
   */
  liveTailSlot?: ReactNode;
  /** Density toggle (phase-04 may surface a switch). Defaults to cozy. */
  density?: RowDensity;
}

// Column layout shared by the header and every row variant:
//   chevron(16) · time(88) · level(64) · module(120) · message(flex) · latency(64) · request(100)
// Stage chips render inline at the start of the MESSAGE column rather
// than as a dedicated column. Fixed columns kept lean so MESSAGE has
// breathing room at common saved-layout list-panel widths (~600px).
const COLS_TEMPLATE =
  'grid grid-cols-[16px_88px_64px_120px_minmax(0,1fr)_64px_100px] items-center gap-3 px-3';

export function LogsEntryList({
  entries,
  selectedEntryId,
  onSelect,
  sourceLabels,
  isLoading,
  isFetching: _isFetching,
  liveTailSlot,
  density = 'cozy',
}: LogsEntryListProps) {
  const items = useMemo(() => deriveTraceGroups(entries), [entries]);
  // Two-set tristate: `userExpanded` = explicitly opened, `userCollapsed`
  // = explicitly closed. Auto-expand (when selection lives inside a trace)
  // only fires when the id is in neither set, so a user click on an
  // auto-expanded chevron actually collapses — previously it added to
  // `expanded` while auto-expand kept showing it, so no visible change.
  const [userExpanded, setUserExpanded] = useState<Set<string>>(new Set());
  const [userCollapsed, setUserCollapsed] = useState<Set<string>>(new Set());

  // Compute the auto-expand id (if any) — derived inside toggle and the
  // effective set so a single source of truth drives both render and
  // click logic.
  const autoExpandedId = useMemo(() => {
    if (!selectedEntryId) return null;
    const owning = items.find(
      (it) => it.kind === 'trace' && it.children.some((c) => c.id === selectedEntryId)
    );
    return owning && owning.kind === 'trace' ? owning.requestId : null;
  }, [items, selectedEntryId]);

  const toggle = useCallback(
    (requestId: string) => {
      const isAutoExpanded = autoExpandedId === requestId;
      const isExplicitlyOpen = userExpanded.has(requestId);
      const isExplicitlyClosed = userCollapsed.has(requestId);
      const isCurrentlyOpen = isExplicitlyOpen || (isAutoExpanded && !isExplicitlyClosed);

      if (isCurrentlyOpen) {
        // Close: clear user-open, mark user-closed (beats auto-expand).
        setUserExpanded((prev) => {
          if (!prev.has(requestId)) return prev;
          const next = new Set(prev);
          next.delete(requestId);
          return next;
        });
        setUserCollapsed((prev) => {
          if (prev.has(requestId)) return prev;
          const next = new Set(prev);
          next.add(requestId);
          return next;
        });
      } else {
        // Open: clear user-closed, mark user-open.
        setUserExpanded((prev) => {
          if (prev.has(requestId)) return prev;
          const next = new Set(prev);
          next.add(requestId);
          return next;
        });
        setUserCollapsed((prev) => {
          if (!prev.has(requestId)) return prev;
          const next = new Set(prev);
          next.delete(requestId);
          return next;
        });
      }
    },
    [autoExpandedId, userExpanded, userCollapsed]
  );

  const effectiveExpanded = useMemo(() => {
    const result = new Set(userExpanded);
    if (autoExpandedId && !userCollapsed.has(autoExpandedId)) {
      result.add(autoExpandedId);
    }
    return result;
  }, [userExpanded, userCollapsed, autoExpandedId]);

  const renderItem = useCallback(
    (_index: number, item: DerivedItem) => {
      if (item.kind === 'trace') {
        return (
          <LogsTraceRow
            group={item}
            isExpanded={effectiveExpanded.has(item.requestId)}
            selectedEntryId={selectedEntryId}
            density={density}
            sourceLabel={sourceLabels[item.source] ?? item.source}
            onToggle={toggle}
            onSelect={onSelect}
          />
        );
      }
      return (
        <LogsRow
          entry={item.entry}
          isSelected={item.entry.id === selectedEntryId}
          density={density}
          sourceLabel={sourceLabels[item.entry.source] ?? item.entry.source}
          onSelect={onSelect}
          repeatCount={item.repeatCount}
        />
      );
    },
    [density, effectiveExpanded, onSelect, selectedEntryId, sourceLabels, toggle]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {/* Sticky column header outside Virtuoso scroll body */}
      <div
        role="row"
        className={cn(
          COLS_TEMPLATE,
          'h-9 shrink-0 border-b border-border bg-muted/30 text-[12px] font-medium uppercase tracking-wide text-muted-foreground'
        )}
      >
        <span role="columnheader" aria-hidden="true" />
        <span role="columnheader">Time</span>
        <span role="columnheader">Level</span>
        <span role="columnheader">Module</span>
        <span role="columnheader">Message</span>
        <span role="columnheader" className="text-right">
          Latency
        </span>
        <span role="columnheader" className="text-right">
          Request
        </span>
      </div>

      {liveTailSlot ? (
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-background px-3">
          {liveTailSlot}
        </div>
      ) : null}

      <div role="grid" className="min-h-0 flex-1">
        {isLoading ? (
          <div className="space-y-1 p-2">
            {Array.from({ length: 14 }).map((_, idx) => (
              <div
                key={idx}
                className="h-9 w-full animate-pulse rounded border border-border/40 bg-muted/30"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <LogsEmpty variant="noResults" />
        ) : (
          <Virtuoso
            data={items}
            itemContent={renderItem}
            increaseViewportBy={{ top: 200, bottom: 400 }}
            followOutput={(atBottom) => (atBottom ? 'auto' : false)}
            computeItemKey={(_idx, item) =>
              item.kind === 'trace' ? `t:${item.requestId}` : `l:${item.entry.id}`
            }
          />
        )}
      </div>
    </div>
  );
}
