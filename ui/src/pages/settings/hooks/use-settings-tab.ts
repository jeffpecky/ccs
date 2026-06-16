/**
 * Settings Tab URL Sync Hook
 */

import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SettingsTab } from '../types';

export function useSettingsTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Normalize to lowercase for case-insensitive matching (fixes ?tab=Backups vs ?tab=backups)
  const tabParam = searchParams.get('tab')?.toLowerCase();
  const activeTab: SettingsTab =
    tabParam === 'globalenv'
      ? 'globalenv'
      : tabParam === 'proxy'
        ? 'proxy'
        : tabParam === 'auth'
          ? 'auth'
          : tabParam === 'thinking'
            ? 'thinking'
            : tabParam === 'backups'
              ? 'backups'
              : 'globalenv';

  const setActiveTab = useCallback(
    (tab: SettingsTab) => {
      setSearchParams({ tab }, { replace: true });
    },
    [setSearchParams]
  );

  return { activeTab, setActiveTab };
}
