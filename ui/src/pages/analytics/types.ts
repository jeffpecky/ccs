/**
 * Analytics Page Types
 */

import type { DateRange } from 'react-day-picker';
import type { ModelUsage } from '@/hooks/use-usage';

export interface AnalyticsPageState {
  dateRange: DateRange | undefined;
  isRefreshing: boolean;
  selectedModel: ModelUsage | null;
  popoverPosition: { x: number; y: number } | null;
  viewMode: 'daily' | 'hourly';
}

export interface DatePreset {
  label: string;
  range: DateRange;
}
