/**
 * Copilot Status Card
 *
 * Displays GitHub Copilot integration status overview.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useCopilot } from '@/hooks/use-copilot';
import { CheckCircle2, XCircle, AlertTriangle, Loader2, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function CopilotStatusCard() {
  const { t } = useTranslation();
  const {
    status,
    statusLoading,
    startAuth,
    isAuthenticating,
    startDaemon,
    isStartingDaemon,
    stopDaemon,
    isStoppingDaemon,
    install,
    isInstalling,
  } = useCopilot();

  if (statusLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('copilotPage.status')}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  if (!status) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('copilotPage.status')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{t('copilotConfigForm.failedLoadStatus')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t('copilotPage.status')}
          {status.enabled ? (
            <Badge variant="default">{t('copilotPage.enabled')}</Badge>
          ) : (
            <Badge variant="secondary">{t('copilotPage.disabled')}</Badge>
          )}
        </CardTitle>
        <CardDescription>{t('copilotConfigForm.useWithClaudeCode')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Warning Banner */}
        <div className="flex items-start gap-2 rounded-md border border-yellow-500/20 bg-yellow-500/10 p-3">
          <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
          <p className="text-sm text-yellow-700 dark:text-yellow-300">
            {t('copilotPage.unofficialItem2')}
          </p>
        </div>

        {/* Status Grid */}
        <div className="grid gap-4 md:grid-cols-3">
          {/* Installed */}
          <div className="flex items-center gap-2">
            {status.installed ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : (
              <XCircle className="h-5 w-5 text-red-500" />
            )}
            <span className="text-sm">
              copilot-api {status.installed ? `v${status.version}` : t('copilotPage.missing')}
            </span>
          </div>

          {/* Authenticated */}
          <div className="flex items-center gap-2">
            {status.authenticated ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : (
              <XCircle className="h-5 w-5 text-red-500" />
            )}
            <span className="text-sm">
              {status.authenticated ? t('copilotPage.connected') : t('copilotPage.notConnected')}
            </span>
          </div>

          {/* Daemon */}
          <div className="flex items-center gap-2">
            {status.daemon_running ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : (
              <XCircle className="h-5 w-5 text-muted-foreground" />
            )}
            <span className="text-sm">
              {t('copilotPage.daemon')}{' '}
              {status.daemon_running ? t('copilotPage.running') : t('copilotPage.stopped')}
            </span>
          </div>
        </div>

        {/* Quick Info */}
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span>
            {t('copilotPage.port')}: {status.port}
          </span>
          <span>
            {t('providerEditor.modelMapping')}: {status.model}
          </span>
          <span>
            {/* TODO i18n: missing key for 'Auto-start' */}
            Auto-start: {status.auto_start ? t('copilotPage.yes') : t('copilotPage.no')}
          </span>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-2">
          {!status.installed && (
            <Button onClick={() => install(undefined)} disabled={isInstalling} size="sm">
              {isInstalling ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('copilotPage.installing')}
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  {t('copilotPage.installCopilotApi')}
                </>
              )}
            </Button>
          )}

          {!status.authenticated && (
            <Button
              onClick={() => startAuth()}
              disabled={isAuthenticating || !status.installed}
              size="sm"
            >
              {isAuthenticating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('copilotPage.authenticating')}
                </>
              ) : (
                t('copilotPage.authenticate')
              )}
            </Button>
          )}

          {status.daemon_running ? (
            <Button
              onClick={() => stopDaemon()}
              disabled={isStoppingDaemon}
              variant="outline"
              size="sm"
            >
              {isStoppingDaemon ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('copilotPage.stopping')}
                </>
              ) : (
                t('copilotPage.stop')
              )}
            </Button>
          ) : (
            <Button
              onClick={() => startDaemon()}
              disabled={isStartingDaemon || !status.authenticated}
              variant="outline"
              size="sm"
            >
              {isStartingDaemon ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('copilotPage.starting')}
                </>
              ) : (
                t('copilotPage.start')
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
