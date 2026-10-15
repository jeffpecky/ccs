/**
 * React Query hooks for profiles
 * Phase 03: REST API Routes & CRUD
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type CreateProfile,
  type UpdateProfile,
  type RegisterProfileOrphansRequest,
  type CopyProfileRequest,
  type ImportProfileRequest,
} from '@/lib/api-client';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

export function useProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: () => api.profiles.list(),
  });
}

export function useCreateProfile() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (data: CreateProfile) => api.profiles.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      toast.success(t('toasts.profileCreated'));
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({ name, data }: { name: string; data: UpdateProfile }) =>
      api.profiles.update(name, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      toast.success(t('toasts.profileUpdated'));
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

export function useDeleteProfile() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (name: string) => api.profiles.delete(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      toast.success(t('toasts.profileDeleted'));
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}

export function useDiscoverProfileOrphans() {
  return useMutation({
    mutationFn: () => api.profiles.discoverOrphans(),
  });
}

export function useRegisterProfileOrphans() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (data: RegisterProfileOrphansRequest) => api.profiles.registerOrphans(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      toast.success(t('toasts.orphanProfilesComplete'));
    },
  });
}

export function useCopyProfile() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: ({ name, data }: { name: string; data: CopyProfileRequest }) =>
      api.profiles.copy(name, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      toast.success(t('toasts.profileCopied'));
    },
  });
}

export function useExportProfile() {
  return useMutation({
    mutationFn: ({ name, includeSecrets }: { name: string; includeSecrets?: boolean }) =>
      api.profiles.export(name, includeSecrets ?? false),
  });
}

export function useImportProfile() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: (data: ImportProfileRequest) => api.profiles.import(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      toast.success(t('toasts.profileImported'));
    },
  });
}
