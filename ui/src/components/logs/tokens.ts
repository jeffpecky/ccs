import type { LogsLevel } from '@/lib/api-client';

/**
 * Calm-density design tokens for the logs surface.
 *
 * Strings only -- no runtime cost. Components import these instead of
 * duplicating Tailwind utilities. Color values use neutral red/amber/blue/zinc
 * scales tuned for AA contrast on `bg-background` in both light and dark
 * themes.
 */

export interface LevelToken {
  bg: string;
  fg: string;
  border: string;
  dot: string;
}

export const LEVEL_TOKENS: Record<LogsLevel, LevelToken> = {
  error: {
    bg: 'bg-red-500/10',
    fg: 'text-red-700 dark:text-red-300',
    border: 'border-red-500/30',
    dot: 'bg-red-500',
  },
  warn: {
    bg: 'bg-amber-500/10',
    fg: 'text-amber-800 dark:text-amber-200',
    border: 'border-amber-500/30',
    dot: 'bg-amber-500',
  },
  info: {
    bg: 'bg-sky-500/10',
    fg: 'text-sky-800 dark:text-sky-200',
    border: 'border-sky-500/30',
    dot: 'bg-sky-500',
  },
  debug: {
    bg: 'bg-zinc-500/10',
    fg: 'text-zinc-700 dark:text-zinc-300',
    border: 'border-zinc-500/30',
    dot: 'bg-zinc-500',
  },
};

export const ROW_DENSITY = {
  compact: 'h-8 text-[12px]',
  cozy: 'h-10 text-[13px]',
} as const;

export type RowDensity = keyof typeof ROW_DENSITY;

export const PANEL_CHROME = 'border-border bg-background';

export const PANEL_CHROME_RIGHT = 'border-r border-border bg-background';
export const PANEL_CHROME_LEFT = 'border-l border-border bg-background';

/** Mono numerics for timestamp / latency columns. */
export const MONO_NUMERIC = 'font-mono tabular-nums';

/** Subtle row hover/selected feedback. */
export const ROW_INTERACTIVE =
  'transition-colors hover:bg-muted/40 data-[selected=true]:bg-muted/60';

/** Calm focus ring used across logs interactive elements. */
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
