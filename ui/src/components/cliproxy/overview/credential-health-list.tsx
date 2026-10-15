/**
 * Credential Health List Component
 * Auth status indicators for CLIProxy Overview tab
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertCircle, XCircle, MinusCircle, RefreshCw, Clock } from 'lucide-react';
import { useCliproxyAuth } from '@/hooks/use-cliproxy';
import { useCliproxyStats } from '@/hooks/use-cliproxy-stats';
import { getAccountStats } from '@/lib/cliproxy-account-stats';
import { cn } from '@/lib/utils';
import { usePrivacy, PRIVACY_BLUR_CLASS } from '@/contexts/privacy-context';
import { useTranslation } from 'react-i18next';

type CredentialStatus = 'ready' | 'warning' | 'error' | 'disabled';

interface CredentialRowProps {
  name: string;
  provider: string;
  status: CredentialStatus;
  statusMessage: string;
  email?: string;
  lastUsedAt?: string;
  onRefresh?: () => void;
  privacyMode?: boolean;
}

function CredentialRow({
  name,
  provider,
  status,
  statusMessage,
  email,
  lastUsedAt,
  onRefresh,
  privacyMode,
}: CredentialRowProps) {
  const { t } = useTranslation();

  const statusConfig = {
    ready: {
      icon: CheckCircle2,
      color: 'text-green-600 dark:text-green-400',
      bg: 'bg-green-500/10',
    },
    warning: {
      icon: AlertCircle,
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-500/10',
    },
    error: {
      icon: XCircle,
      color: 'text-red-600 dark:text-red-400',
      bg: 'bg-red-500/10',
    },
    disabled: {
      icon: MinusCircle,
      color: 'text-muted-foreground',
      bg: 'bg-muted',
    },
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  const formatLastUsed = (date?: string) => {
    if (!date) return t('credentialHealth.neverUsed');
    try {
      const lastUsed = new Date(date);
      const now = new Date();
      const diff = now.getTime() - lastUsed.getTime();
      if (diff < 0) return t('credentialHealth.justNow');
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);
      if (days > 0) return t('credentialHealth.daysAgo', { count: days });
      if (hours > 0) return t('credentialHealth.hoursAgo', { count: hours });
      if (minutes > 0) return t('credentialHealth.minutesAgo', { count: minutes });
      return t('credentialHealth.justNow');
    } catch {
      return t('credentialHealth.unknown');
    }
  };

  return (
    <div className="flex items-center justify-between p-3 border-b last:border-0">
      <div className="flex items-center gap-3">
        <div className={cn('p-2 rounded-full', config.bg)}>
          <Icon className={cn('w-4 h-4', config.color)} />
        </div>
        <div>
          <div className={cn('font-medium text-sm', privacyMode && PRIVACY_BLUR_CLASS)}>
            {email ?? name}
          </div>
          <div className="text-xs text-muted-foreground capitalize">{provider}</div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="text-right">
          <Badge
            variant={
              status === 'ready' ? 'outline' : status === 'warning' ? 'secondary' : 'destructive'
            }
            className="text-xs"
          >
            {statusMessage}
          </Badge>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5 justify-end">
            <Clock className="w-3 h-3" />
            {formatLastUsed(lastUsedAt)}
          </div>
        </div>
        {status === 'warning' && onRefresh && (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onRefresh}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function CredentialHealthSkeleton() {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('credentialHealth.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function CredentialHealthList() {
  const { t } = useTranslation();
  const { data: authData, isLoading } = useCliproxyAuth();
  const { data: stats } = useCliproxyStats(true);
  const { privacyMode } = usePrivacy();

  if (isLoading) {
    return <CredentialHealthSkeleton />;
  }

  // Flatten accounts from all providers with runtime lastUsedAt
  const credentials =
    authData?.authStatus.flatMap((status) =>
      (status.accounts ?? []).map((account) => {
        const runtimeLastUsed = getAccountStats(stats, account)?.lastUsedAt;
        return {
          name: account.id,
          provider: status.provider,
          status: (account as { status?: CredentialStatus }).status ?? 'ready',
          statusMessage:
            (account as { statusMessage?: string }).statusMessage ?? t('credentialHealth.ready'),
          email: account.email,
          lastUsedAt: runtimeLastUsed || account.lastUsedAt,
        };
      })
    ) ?? [];

  if (credentials.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('credentialHealth.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            {t('credentialHealth.noCredentialsConfigured')}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('credentialHealth.title')}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {credentials.map((cred, i) => (
          <CredentialRow
            key={`${cred.provider}-${cred.name}-${i}`}
            {...cred}
            privacyMode={privacyMode}
          />
        ))}
      </CardContent>
    </Card>
  );
}
