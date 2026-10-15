/**
 * SummaryCard - Summary stats card with icon and value display
 */

import type React from 'react';

interface SummaryCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color?: string;
}

export function SummaryCard({ icon, label, value, color }: SummaryCardProps) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-card/50 dark:bg-zinc-900/50 border border-border/50 dark:border-white/[0.06]">
      <div
        className="w-8 h-8 rounded-md flex items-center justify-center"
        style={{
          backgroundColor: color ? `${color}15` : 'var(--muted)',
          color: color || 'var(--muted-foreground)',
        }}
      >
        {icon}
      </div>
      <div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
        <div
          className="text-lg font-semibold font-mono leading-tight"
          style={{ color: color || 'var(--foreground)' }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}
