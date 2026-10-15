/**
 * Provider Card Component for Flow Visualization
 */

import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { ProviderIcon } from '@/components/shared/provider-icon';
import { GripVertical } from 'lucide-react';

import type { DragOffset, ProviderData } from './types';

interface ProviderCardProps {
  providerData: ProviderData;
  providerColor: string;
  totalRequests: number;
  maxRequests: number;
  showVisibleMetrics?: boolean;
  hiddenPausedCount?: number;
  isDragging: boolean;
  offset: DragOffset;
  hoveredAccount: number | null;
  hasRightAccounts: boolean;
  hasTopAccounts: boolean;
  hasBottomAccounts: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
}

export function ProviderCard({
  providerData,
  providerColor,
  totalRequests,
  maxRequests,
  showVisibleMetrics = false,
  hiddenPausedCount = 0,
  isDragging,
  offset,
  hoveredAccount,
  hasRightAccounts,
  hasTopAccounts,
  hasBottomAccounts,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: ProviderCardProps) {
  const { t } = useTranslation();
  const { accounts } = providerData;
  const progressDenominator = Math.max(1, maxRequests * Math.max(1, accounts.length));

  return (
    <div
      data-provider-node
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={cn(
        'group relative w-full rounded-xl p-4 cursor-grab transition-shadow duration-200',
        'bg-muted/30 dark:bg-zinc-900/60 backdrop-blur-sm',
        'border-2 border-border/50 dark:border-white/[0.08]',
        !isDragging && 'animate-subtle-float animate-border-glow',
        'select-none touch-none',
        hoveredAccount !== null && 'scale-[1.02]',
        isDragging && 'cursor-grabbing shadow-2xl scale-105 z-50'
      )}
      style={
        {
          '--glow-color': `${providerColor}60`,
          borderColor: hoveredAccount !== null ? `${providerColor}80` : undefined,
          transform: `translate(${offset.x}px, ${offset.y}px)${isDragging ? ' scale(1.05)' : ''}`,
        } as React.CSSProperties
      }
    >
      <GripVertical className="absolute top-2 right-2 w-4 h-4 text-muted-foreground/40" />
      <div
        className="absolute inset-0 rounded-xl animate-glow-pulse pointer-events-none"
        style={{ '--glow-color': `${providerColor}30` } as React.CSSProperties}
      />

      {/* Connector Points */}
      <div
        className="absolute top-1/2 -left-1.5 w-3 h-3 rounded-full transform -translate-y-1/2"
        style={{
          backgroundColor: providerColor,
          boxShadow: `0 0 0 4px var(--background)`,
        }}
      />
      {hasRightAccounts && (
        <div
          className="absolute top-1/2 -right-1.5 w-3 h-3 rounded-full transform -translate-y-1/2"
          style={{
            backgroundColor: providerColor,
            boxShadow: `0 0 0 4px var(--background)`,
          }}
        />
      )}
      {hasTopAccounts && (
        <div
          className="absolute left-1/2 -top-1.5 w-3 h-3 rounded-full transform -translate-x-1/2"
          style={{
            backgroundColor: providerColor,
            boxShadow: `0 0 0 4px var(--background)`,
          }}
        />
      )}
      {hasBottomAccounts && (
        <div
          className="absolute left-1/2 -bottom-1.5 w-3 h-3 rounded-full transform -translate-x-1/2"
          style={{
            backgroundColor: providerColor,
            boxShadow: `0 0 0 4px var(--background)`,
          }}
        />
      )}

      <div className="flex items-center gap-3 mb-4 relative z-10">
        <div className="animate-icon-breathe">
          <ProviderIcon provider={providerData.provider} size={36} withBackground />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground tracking-tight">
            {providerData.displayName}
          </h3>
          <p className="text-[10px] text-muted-foreground font-medium uppercase">
            {t('flowViz.provider')}
          </p>
        </div>
      </div>

      <div className="space-y-2 relative z-10">
        <div className="flex justify-between items-center text-xs">
          <span className="text-muted-foreground">
            {showVisibleMetrics ? t('flowViz.visibleTotalRequests') : t('flowViz.totalRequests')}
          </span>
          <span className="text-foreground font-mono">{totalRequests.toLocaleString()}</span>
        </div>
        <div className="flex justify-between items-center text-xs">
          <span className="text-muted-foreground">
            {showVisibleMetrics ? t('flowViz.visibleAccounts') : t('flowViz.accounts')}
          </span>
          <span className="text-foreground font-mono">{accounts.length}</span>
        </div>
        <div className="w-full bg-muted dark:bg-zinc-800/50 h-1 rounded-full mt-2 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(100, (totalRequests / progressDenominator) * 100)}%`,
              backgroundColor: providerColor,
            }}
          />
        </div>
        {showVisibleMetrics && hiddenPausedCount > 0 && (
          <div className="text-[10px] text-muted-foreground">
            {t('flowViz.excludingPausedAccounts', { count: hiddenPausedCount })}
          </div>
        )}
      </div>
    </div>
  );
}
