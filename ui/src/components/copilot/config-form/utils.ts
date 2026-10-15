/**
 * Utility functions for Copilot Config Form
 */

import type { CopilotPlanTier } from './types';

/** Get badge style for plan tier */
export function getPlanBadgeStyle(plan?: CopilotPlanTier): string {
  switch (plan) {
    case 'free':
      return 'bg-green-100 text-green-700 border-green-200';
    case 'pro':
      return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'pro+':
      return 'bg-purple-100 text-purple-700 border-purple-200';
    case 'business':
      return 'bg-orange-100 text-orange-700 border-orange-200';
    case 'enterprise':
      return 'bg-red-100 text-red-700 border-red-200';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

/** Get multiplier display */
export function getMultiplierDisplay(multiplier?: number): string | null {
  if (multiplier === undefined || multiplier === null) return null;
  // TODO i18n: missing key for 'Free' multiplier label
  if (multiplier === 0) return 'Free';
  if (multiplier < 1) return `${multiplier}x`;
  if (multiplier === 1) return '1x';
  return `${multiplier}x`;
}
