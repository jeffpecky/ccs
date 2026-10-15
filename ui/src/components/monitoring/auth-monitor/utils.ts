/**
 * Utility functions and constants for Auth Monitor
 */

/** Calculate success rate percentage */
export function getSuccessRate(success: number, failure: number): number {
  const total = success + failure;
  if (total === 0) return 100;
  return Math.round((success / total) * 100);
}

/** Strip common email domains for cleaner display */
export function cleanEmail(email: string): string {
  return email.replace(/@(gmail|yahoo|hotmail|outlook|icloud)\.com$/i, '');
}

// Vibrant colors for account segments - darker for light theme contrast
export const ACCOUNT_COLORS = [
  '#1e6091', // Deep Cerulean
  '#2d8a6e', // Deep Seaweed
  '#d4a012', // Dark Tuscan
  '#c92a2d', // Deep Strawberry
  '#c45a1a', // Deep Pumpkin
  '#6b9c4d', // Dark Willow
  '#3d5a73', // Deep Blue Slate
  '#cc7614', // Dark Carrot
  '#3a7371', // Deep Cyan
  '#7c5fc4', // Deep Purple
];
