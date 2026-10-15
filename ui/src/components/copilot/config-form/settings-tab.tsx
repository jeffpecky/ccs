/**
 * Settings Tab Content
 * Enable toggle, port, account type, rate limiting, daemon settings
 */

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslation } from 'react-i18next';

interface SettingsTabProps {
  enabled: boolean;
  autoStart: boolean;
  port: number;
  accountType: 'individual' | 'business' | 'enterprise';
  rateLimit: string;
  waitOnLimit: boolean;
  onUpdateEnabled: (value: boolean) => void;
  onUpdateAutoStart: (value: boolean) => void;
  onUpdatePort: (value: number) => void;
  onUpdateAccountType: (value: 'individual' | 'business' | 'enterprise') => void;
  onUpdateRateLimit: (value: string) => void;
  onUpdateWaitOnLimit: (value: boolean) => void;
}

export function SettingsTab({
  enabled,
  autoStart,
  port,
  accountType,
  rateLimit,
  waitOnLimit,
  onUpdateEnabled,
  onUpdateAutoStart,
  onUpdatePort,
  onUpdateAccountType,
  onUpdateRateLimit,
  onUpdateWaitOnLimit,
}: SettingsTabProps) {
  const { t } = useTranslation();

  return (
    <TabsContent
      value="settings"
      className="flex-1 mt-0 border-0 p-0 data-[state=inactive]:hidden flex flex-col overflow-hidden"
    >
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Enable Toggle */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="enabled" className="text-sm font-medium">
                {t('copilotSettings.enableCopilot')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t('copilotSettings.enableCopilotDesc')}
              </p>
            </div>
            <Switch id="enabled" checked={enabled} onCheckedChange={onUpdateEnabled} />
          </div>

          {/* Basic Settings */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">{t('copilotSettings.basicSettings')}</h3>

            {/* Port */}
            <div className="space-y-2">
              <Label htmlFor="port" className="text-xs">
                {t('copilotPage.port')}
              </Label>
              <Input
                id="port"
                type="number"
                value={port}
                onChange={(e) => onUpdatePort(parseInt(e.target.value, 10))}
                min={1024}
                max={65535}
                className="max-w-[150px] h-8"
              />
            </div>

            {/* Account Type */}
            <div className="space-y-2">
              <Label htmlFor="account-type" className="text-xs">
                {t('copilotSettings.accountType')}
              </Label>
              <Select value={accountType} onValueChange={onUpdateAccountType}>
                <SelectTrigger id="account-type" className="max-w-[150px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="individual">
                    {t('copilotSettings.accountTypeIndividual')}
                  </SelectItem>
                  <SelectItem value="business">
                    {t('copilotSettings.accountTypeBusiness')}
                  </SelectItem>
                  <SelectItem value="enterprise">
                    {t('copilotSettings.accountTypeEnterprise')}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* Rate Limiting */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">{t('copilotSettings.rateLimiting')}</h3>

            <div className="space-y-2">
              <Label htmlFor="rate-limit" className="text-xs">
                {t('copilotSettings.rateLimitSeconds')}
              </Label>
              <Input
                id="rate-limit"
                type="number"
                value={rateLimit}
                onChange={(e) => onUpdateRateLimit(e.target.value)}
                placeholder={t('copilotSettings.noLimit')}
                min={0}
                className="max-w-[150px] h-8"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="wait-on-limit" className="text-xs">
                  {t('copilotSettings.waitOnRateLimit')}
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  {t('copilotSettings.waitOnRateLimitDesc')}
                </p>
              </div>
              <Switch
                id="wait-on-limit"
                checked={waitOnLimit}
                onCheckedChange={onUpdateWaitOnLimit}
              />
            </div>
          </div>

          <Separator />

          {/* Daemon Settings */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">{t('copilotSettings.daemonSettings')}</h3>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="auto-start" className="text-xs">
                  {t('copilotSettings.autoStartDaemon')}
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  {t('copilotSettings.autoStartDaemonDesc')}
                </p>
              </div>
              <Switch id="auto-start" checked={autoStart} onCheckedChange={onUpdateAutoStart} />
            </div>
          </div>
        </div>
      </ScrollArea>
    </TabsContent>
  );
}
