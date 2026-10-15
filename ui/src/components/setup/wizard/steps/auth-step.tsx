/**
 * Authentication Step
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Copy, Check, RefreshCw, ArrowLeft, Terminal, ExternalLink, Loader2 } from 'lucide-react';
import type { AuthStepProps } from '../types';
import { useTranslation } from 'react-i18next';

export function AuthStep({
  selectedProvider,
  providers,
  authCommand,
  isRefreshing,
  isPending,
  onBack,
  onStartAuth,
  onRefresh,
}: AuthStepProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copyCommand = async (cmd: string) => {
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Primary: OAuth Button */}
      <div className="text-center space-y-3">
        <p className="text-sm text-muted-foreground">
          {t('setupWizard.authStep.authenticateWith', {
            provider: providers.find((p) => p.id === selectedProvider)?.name,
          })}
        </p>
        <Button onClick={onStartAuth} disabled={isPending} className="w-full gap-2" size="lg">
          {isPending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('setupWizard.authStep.authenticating')}
            </>
          ) : (
            <>
              <ExternalLink className="w-4 h-4" />
              {t('setupWizard.authStep.authenticateInBrowser')}
            </>
          )}
        </Button>
        {isPending && (
          <p className="text-xs text-muted-foreground">{t('setupWizard.authStep.completeOAuth')}</p>
        )}
      </div>

      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">
            {t('setupWizard.authStep.orUseTerminal')}
          </span>
        </div>
      </div>

      {/* Secondary: CLI Command */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Terminal className="w-4 h-4" />
            {t('setupWizard.authStep.runCommandHint')}
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 bg-muted rounded-md font-mono text-sm">
              {authCommand}
            </code>
            <Button variant="outline" size="icon" onClick={() => copyCommand(authCommand)}>
              {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack} disabled={isPending}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          {t('setupWizard.authStep.back')}
        </Button>
        <Button variant="outline" onClick={onRefresh} disabled={isRefreshing || isPending}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing
            ? t('setupWizard.authStep.checking')
            : t('setupWizard.authStep.refreshStatus')}
        </Button>
      </div>
    </div>
  );
}
