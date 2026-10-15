import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, AlertTriangle, XCircle, Wrench } from 'lucide-react';
import { useFixHealth } from '@/hooks/use-health';
import { useTranslation } from 'react-i18next';

interface HealthCheck {
  id: string;
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  details?: string;
  fixable?: boolean;
}

const statusConfig = {
  ok: {
    icon: CheckCircle,
    color: 'text-green-600',
    bg: 'bg-green-50 dark:bg-green-900/20',
    border: 'border-green-200 dark:border-green-800',
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-yellow-500',
    bg: 'bg-yellow-50 dark:bg-yellow-900/20',
    border: 'border-yellow-200 dark:border-yellow-800',
  },
  error: {
    icon: XCircle,
    color: 'text-red-500',
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-200 dark:border-red-800',
  },
};

export function HealthCard({ check }: { check: HealthCheck }) {
  const fixMutation = useFixHealth();
  const { t } = useTranslation();
  const config = statusConfig[check.status];
  const Icon = config.icon;

  return (
    <Card className={`${config.bg} ${config.border} border`}>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Icon className={`w-5 h-5 ${config.color}`} />
            <span className="font-medium">{check.name}</span>
          </div>
          {check.fixable && check.status !== 'ok' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => fixMutation.mutate(check.id)}
              disabled={fixMutation.isPending}
            >
              <Wrench className="w-3 h-3 mr-1" />
              {t('health.fix')}
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-2">{check.message}</p>
        {check.details && (
          <p className="text-xs text-muted-foreground mt-1 font-mono truncate">{check.details}</p>
        )}
      </CardContent>
    </Card>
  );
}
