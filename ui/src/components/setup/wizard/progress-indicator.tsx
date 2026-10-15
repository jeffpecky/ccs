/**
 * Progress Indicator Component
 * Shows step dots for wizard progress
 */

import type { ProgressIndicatorProps } from './types';

export function ProgressIndicator({ currentProgress, allSteps }: ProgressIndicatorProps) {
  return (
    <div className="flex justify-center gap-1 pt-2">
      {allSteps.map((s, i) => (
        <div
          key={s}
          className={`w-2 h-2 rounded-full transition-colors ${
            currentProgress >= i ? 'bg-primary' : 'bg-muted'
          }`}
        />
      ))}
    </div>
  );
}
