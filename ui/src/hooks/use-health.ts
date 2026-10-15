import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface HealthCheck {
  id: string;
  name: string;
  status: 'ok' | 'warning' | 'error' | 'info';
  message: string;
  details?: string;
  fix?: string;
  fixable?: boolean;
}

interface HealthGroup {
  id: string;
  name: string;
  icon: string;
  checks: HealthCheck[];
}

interface HealthReport {
  timestamp: number;
  version: string;
  groups: HealthGroup[];
  checks: HealthCheck[];
  summary: {
    total: number;
    passed: number;
    warnings: number;
    errors: number;
    info: number;
  };
}

export type { HealthCheck, HealthGroup, HealthReport };

export function useHealth() {
  return useQuery<HealthReport>({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch('/api/health');
      return res.json();
    },
    refetchInterval: 30000, // Auto-refresh every 30s
  });
}

export function useFixHealth() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (checkId: string) => {
      const res = await fetch(`/api/health/fix/${checkId}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      return data;
    },
    onSuccess: (data: { message: string }) => {
      queryClient.invalidateQueries({ queryKey: ['health'] });
      toast.success(data.message);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });
}
