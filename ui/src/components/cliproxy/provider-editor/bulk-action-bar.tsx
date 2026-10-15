/**
 * Bulk Action Bar Component
 * Appears when accounts are selected for bulk pause/resume operations
 */

import { Button } from '@/components/ui/button';
import { Pause, Play, Loader2 } from 'lucide-react';

interface BulkActionBarProps {
  selectedCount: number;
  onPauseSelected: () => void;
  onResumeSelected: () => void;
  onClearSelection: () => void;
  isPausing: boolean;
  isResuming: boolean;
}

export function BulkActionBar({
  selectedCount,
  onPauseSelected,
  onResumeSelected,
  onClearSelection,
  isPausing,
  isResuming,
}: BulkActionBarProps) {
  // Show bar when at least 1 account is selected (per validation decision)
  if (selectedCount < 1) return null;

  const isLoading = isPausing || isResuming;

  return (
    <div className="flex items-center gap-3 p-2 bg-muted/50 rounded-lg border mt-2">
      <span className="text-sm text-muted-foreground">{selectedCount} selected</span>
      <Button
        variant="ghost"
        size="sm"
        className="text-xs h-6 px-2"
        onClick={onClearSelection}
        disabled={isLoading}
      >
        Clear
      </Button>
      <div className="flex gap-2 ml-auto">
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={onPauseSelected}
          disabled={isLoading}
        >
          {isPausing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Pause className="w-3 h-3" />}
          {/* TODO i18n: missing key for "Pause Selected" */}
          Pause Selected
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          onClick={onResumeSelected}
          disabled={isLoading}
        >
          {isResuming ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          {/* TODO i18n: missing key for "Resume Selected" */}
          Resume Selected
        </Button>
      </div>
    </div>
  );
}
