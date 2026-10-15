import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export function useLocalRuntimeReadiness() {
  return useQuery({
    queryKey: ['profiles', 'local-runtime-readiness'],
    queryFn: () => api.profiles.getLocalRuntimeReadiness(),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}
