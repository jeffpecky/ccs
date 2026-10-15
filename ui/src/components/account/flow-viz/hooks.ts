/**
 * Custom hooks for drag and position management
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import type { DragOffset, ContainerExpansion } from './types';

interface UseDragPositionsOptions {
  storageKey: string;
  onDrag?: () => void;
}

interface UseDragPositionsReturn {
  dragOffsets: Record<string, DragOffset>;
  draggingId: string | null;
  didDragRef: React.MutableRefObject<boolean>;
  handlePointerDown: (id: string, e: React.PointerEvent) => void;
  handlePointerMove: (e: React.PointerEvent) => void;
  handlePointerUp: () => void;
  getOffset: (id: string) => DragOffset;
  resetPositions: () => void;
  hasCustomPositions: boolean;
}

/**
 * Hook for managing draggable card positions with localStorage persistence
 */
export function useDragPositions({
  storageKey,
  onDrag,
}: UseDragPositionsOptions): UseDragPositionsReturn {
  // Drag state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(
    null
  );
  const didDragRef = useRef(false);

  // Load saved positions from localStorage
  const loadSavedPositions = useCallback((): Record<string, DragOffset> => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return JSON.parse(saved);
    } catch {
      // Ignore parse errors
    }
    return {};
  }, [storageKey]);

  const [dragOffsets, setDragOffsets] = useState<Record<string, DragOffset>>(() =>
    loadSavedPositions()
  );

  // Save positions to localStorage when they change
  useEffect(() => {
    if (Object.keys(dragOffsets).length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(dragOffsets));
    }
  }, [dragOffsets, storageKey]);

  // Reset positions handler
  const resetPositions = useCallback(() => {
    setDragOffsets({});
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  // Drag handlers
  const handlePointerDown = useCallback(
    (id: string, e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      const offset = dragOffsets[id] || { x: 0, y: 0 };
      dragStartRef.current = { x: e.clientX, y: e.clientY, offsetX: offset.x, offsetY: offset.y };
      didDragRef.current = false;
      setDraggingId(id);
    },
    [dragOffsets]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingId || !dragStartRef.current) return;
      const start = dragStartRef.current;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      // Track if actual movement occurred (threshold of 3px)
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        didDragRef.current = true;
      }
      setDragOffsets((prev) => ({
        ...prev,
        [draggingId]: {
          x: start.offsetX + dx,
          y: start.offsetY + dy,
        },
      }));
      // Notify parent to recalculate paths
      if (onDrag) {
        requestAnimationFrame(onDrag);
      }
    },
    [draggingId, onDrag]
  );

  const handlePointerUp = useCallback(() => {
    setDraggingId(null);
    dragStartRef.current = null;
  }, []);

  // Get offset for a card
  const getOffset = (id: string): DragOffset => dragOffsets[id] || { x: 0, y: 0 };

  return {
    dragOffsets,
    draggingId,
    didDragRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    getOffset,
    resetPositions,
    hasCustomPositions: Object.keys(dragOffsets).length > 0,
  };
}

/**
 * Calculate container expansion based on drag offsets
 */
export function useContainerExpansion(dragOffsets: Record<string, DragOffset>): ContainerExpansion {
  let minY = 0,
    maxY = 0;
  Object.values(dragOffsets).forEach((offset) => {
    minY = Math.min(minY, offset.y);
    maxY = Math.max(maxY, offset.y);
  });
  return {
    paddingTop: Math.max(0, -minY),
    paddingBottom: Math.max(0, maxY),
    extraHeight: Math.max(0, Math.abs(minY), Math.abs(maxY)) * 2,
  };
}

interface AccountLike {
  id: string;
  successCount: number;
  failureCount: number;
}

/**
 * Hook for detecting new activity and triggering pulse animations
 */
export function usePulseAnimation(accounts: AccountLike[]): Set<string> {
  const [pulsingAccounts, setPulsingAccounts] = useState<Set<string>>(new Set());
  const prevCountsRef = useRef<Record<string, number>>({});

  // Detect new activity and trigger pulse animation
  useEffect(() => {
    const newPulsing = new Set<string>();
    const newCounts: Record<string, number> = {};

    accounts.forEach((account) => {
      const currentCount = account.successCount + account.failureCount;
      newCounts[account.id] = currentCount;
      const prev = prevCountsRef.current[account.id];
      if (prev !== undefined && currentCount > prev) {
        newPulsing.add(account.id);
      }
    });

    prevCountsRef.current = newCounts;

    if (newPulsing.size > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Valid pattern for animation triggers
      setPulsingAccounts(newPulsing);

      const timer = setTimeout(() => setPulsingAccounts(new Set()), 2000);
      return () => clearTimeout(timer);
    }
  }, [accounts]);

  return pulsingAccounts;
}
