import { useEffect } from 'react';

export interface UseLogsKeyboardNavOptions {
  /** Currently visible entry ids in display order (post-filter, post-grouping flatten). */
  entryIds: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onTogglePause: () => void;
  onFocusSearch: () => void;
  onOpenShortcuts: () => void;
  /** Detail-sheet close (mobile only). Optional. */
  onCloseDetail?: () => void;
  enabled?: boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

/**
 * Centralised keyboard navigation for the logs surface.
 * Bound on `window`. Bail out when typing in form fields or the user has
 * any modifier (cmd/ctrl/alt) other than shift on `?`.
 */
export function useLogsKeyboardNav({
  entryIds,
  selectedId,
  onSelect,
  onTogglePause,
  onFocusSearch,
  onOpenShortcuts,
  onCloseDetail,
  enabled = true,
}: UseLogsKeyboardNavOptions): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // `/` always focuses search, even from inputs (consistent with most apps)
      if (event.key === '/') {
        event.preventDefault();
        onFocusSearch();
        return;
      }
      if (event.key === '?') {
        event.preventDefault();
        onOpenShortcuts();
        return;
      }
      if (isTypingTarget(event.target)) return;

      if (event.key === 'Escape' && onCloseDetail) {
        onCloseDetail();
        return;
      }

      if (event.key === ' ') {
        event.preventDefault();
        onTogglePause();
        return;
      }

      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        if (entryIds.length === 0) return;
        const idx = selectedId ? entryIds.indexOf(selectedId) : -1;
        const next = entryIds[Math.min(idx + 1, entryIds.length - 1)] ?? entryIds[0];
        if (next) onSelect(next);
        return;
      }

      if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (entryIds.length === 0) return;
        const idx = selectedId ? entryIds.indexOf(selectedId) : 0;
        const next = entryIds[Math.max(idx - 1, 0)] ?? entryIds[0];
        if (next) onSelect(next);
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    enabled,
    entryIds,
    selectedId,
    onSelect,
    onTogglePause,
    onFocusSearch,
    onOpenShortcuts,
    onCloseDetail,
  ]);
}
