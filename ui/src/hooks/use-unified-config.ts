/**
 * React Query hooks for unified config
 * Phase 05: Dashboard Updates
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

/**
 * Get current config format and migration status
 */
export function useConfigFormat() {
  return useQuery({
    queryKey: ['config-format'],
    queryFn: () => api.config.format(),
  });
}

/**
 * Get unified config (only available when format is 'yaml')
 */
export function useUnifiedConfig() {
  return useQuery({
    queryKey: ['unified-config'],
    queryFn: () => api.config.get(),
    enabled: false, // Only fetch when explicitly enabled
  });
}

/**
 * Update unified config
 */
export function useUpdateConfig() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (config: Record<string, unknown>) => api.config.update(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unified-config'] });
      queryClient.invalidateQueries({ queryKey: ['config-format'] });
      toast.success(t('toasts.unifiedConfigUpdated'));
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

/**
 * Run migration from JSON to YAML format
 */
export function useMigration() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (dryRun: boolean) => api.config.migrate(dryRun),
    onSuccess: (result, dryRun) => {
      if (dryRun) {
        toast.info(t('toasts.migrationPreviewComplete'));
      } else if (result.success) {
        queryClient.invalidateQueries({ queryKey: ['config-format'] });
        queryClient.invalidateQueries({ queryKey: ['unified-config'] });
        queryClient.invalidateQueries({ queryKey: ['profiles'] });
        queryClient.invalidateQueries({ queryKey: ['accounts'] });
        toast.success(t('toasts.migrationComplete'));
      } else {
        toast.error(result.error ?? t('toasts.migrationFailed'));
      }
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

/**
 * Rollback migration to JSON format
 */
export function useRollback() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (backupPath: string) => api.config.rollback(backupPath),
    onSuccess: (result) => {
      if (result.success) {
        queryClient.invalidateQueries({ queryKey: ['config-format'] });
        queryClient.invalidateQueries({ queryKey: ['unified-config'] });
        queryClient.invalidateQueries({ queryKey: ['profiles'] });
        queryClient.invalidateQueries({ queryKey: ['accounts'] });
        toast.success(t('toasts.rollbackComplete'));
      } else {
        toast.error(t('toasts.rollbackFailed'));
      }
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}
