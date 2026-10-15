/**
 * Provider Info Tab
 * Displays provider information and quick usage commands
 */

import { Badge } from '@/components/ui/badge';
import { CopyButton } from '@/components/ui/copy-button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Info, Shield } from 'lucide-react';
import { UsageCommand } from './usage-command';
import type { SettingsResponse } from './types';
import type { AuthStatus, CliTarget } from '@/lib/api-client';
import { getProviderSection, isPlusExtraProvider } from '@/lib/provider-config';
import { useTranslation } from 'react-i18next';

interface ProviderInfoTabProps {
  provider: string;
  displayName: string;
  baseProvider?: string;
  defaultTarget?: CliTarget;
  data?: SettingsResponse;
  authStatus: AuthStatus;
  supportsModelConfig?: boolean;
}

export function ProviderInfoTab({
  provider,
  displayName,
  baseProvider,
  defaultTarget,
  data,
  authStatus,
  supportsModelConfig = false,
}: ProviderInfoTabProps) {
  const { t } = useTranslation();
  const resolvedTarget = defaultTarget || 'claude';
  const isDroidTarget = resolvedTarget === 'droid';
  const isCodexProvider = provider === 'codex';
  const sectionProvider = baseProvider || authStatus.provider || provider;
  const providerSection = getProviderSection(sectionProvider);
  const managementPrefix =
    resolvedTarget === 'claude' ? `ccs ${provider}` : `ccs ${provider} --target claude`;
  const changeModelCommand = `${managementPrefix} --config`;
  const addAccountCommand = `${managementPrefix} --auth --add`;
  const listAccountsCommand = `${managementPrefix} --accounts`;

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-6">
        {/* Provider Information */}
        <div>
          <h3 className="text-sm font-medium flex items-center gap-2 mb-3">
            <Info className="w-4 h-4" />
            {/* TODO i18n: missing key for "Provider Information" */}
            Provider Information
          </h3>
          <div className="space-y-3 bg-card rounded-lg border p-4 shadow-sm">
            <div className="grid grid-cols-[100px_1fr] gap-2 text-sm items-center">
              <span className="font-medium text-muted-foreground">
                {t('providerEditor.provider')}
              </span>
              <span className="font-mono">{displayName}</span>
            </div>
            {data && (
              <>
                <div className="grid grid-cols-[100px_1fr] gap-2 text-sm items-center">
                  <span className="font-medium text-muted-foreground">
                    {t('providerEditor.filePath')}
                  </span>
                  <div className="flex items-center gap-2 min-w-0">
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs break-all">
                      {data.path}
                    </code>
                    <CopyButton value={data.path} size="icon" className="h-5 w-5" />
                  </div>
                </div>
                <div className="grid grid-cols-[100px_1fr] gap-2 text-sm items-center">
                  <span className="font-medium text-muted-foreground">
                    {t('providerEditor.lastModified')}
                  </span>
                  <span className="text-xs">{new Date(data.mtime).toLocaleString()}</span>
                </div>
              </>
            )}
            <div className="grid grid-cols-[100px_1fr] gap-2 text-sm items-center">
              <span className="font-medium text-muted-foreground">
                {t('providerEditor.status')}
              </span>
              {authStatus.authenticated ? (
                <Badge
                  variant="outline"
                  className="w-fit text-green-600 border-green-200 bg-green-50"
                >
                  <Shield className="w-3 h-3 mr-1" />
                  Authenticated
                </Badge>
              ) : (
                <Badge variant="outline" className="w-fit text-muted-foreground">
                  Not connected
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-[100px_1fr] gap-2 text-sm items-center">
              <span className="font-medium text-muted-foreground">
                {t('providerEditor.defaultTarget')}
              </span>
              <span className="font-mono">{resolvedTarget}</span>
            </div>
            {providerSection && (
              <div className="grid grid-cols-[100px_1fr] gap-2 text-sm items-start">
                <span className="font-medium text-muted-foreground">
                  {t('providerConfig.trackLabel')}
                </span>
                <div className="space-y-1">
                  <span className="font-mono">{t(providerSection.labelKey)}</span>
                  <p className="text-xs text-muted-foreground">
                    {t(providerSection.hintKey)}
                    {isPlusExtraProvider(sectionProvider)
                      ? ` ${t('providerConfig.plusTrackNote')}`
                      : ''}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Quick Usage */}
        <div>
          <h3 className="text-sm font-medium mb-3">{t('providerEditor.quickUsage')}</h3>
          <div className="space-y-3 bg-card rounded-lg border p-4 shadow-sm">
            <UsageCommand label="Run with prompt" command={`ccs ${provider} "your prompt"`} />
            {isCodexProvider && (
              <>
                <UsageCommand
                  label="Run on native Codex (shortcut)"
                  command={`ccsxp "your prompt"`}
                />
                <UsageCommand
                  label="Run on native Codex (--target)"
                  command={`ccs ${provider} --target codex "your prompt"`}
                />
              </>
            )}
            <UsageCommand
              label={isDroidTarget ? 'Droid alias (explicit)' : 'Run on Droid'}
              command={`ccs-droid ${provider} "your prompt"`}
            />
            <UsageCommand
              label={isDroidTarget ? 'Override to Claude' : 'Run on Droid (--target)'}
              command={`ccs ${provider} --target ${isDroidTarget ? 'claude' : 'droid'} "your prompt"`}
            />
            {supportsModelConfig && (
              <UsageCommand
                label={
                  resolvedTarget === 'claude' ? 'Change model' : 'Change model (Claude target)'
                }
                command={changeModelCommand}
              />
            )}
            <UsageCommand
              label={resolvedTarget === 'claude' ? 'Add account' : 'Add account (Claude target)'}
              command={addAccountCommand}
            />
            <UsageCommand
              label={
                resolvedTarget === 'claude' ? 'List accounts' : 'List accounts (Claude target)'
              }
              command={listAccountsCommand}
            />
            {resolvedTarget !== 'claude' && (
              <p className="text-xs text-muted-foreground">
                Account and model-management flags stay on Claude target. Codex and Droid runtime
                launches reject those CLIProxy management commands.
              </p>
            )}
          </div>
        </div>
      </div>
    </ScrollArea>
  );
}
