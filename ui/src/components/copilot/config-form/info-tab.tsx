/**
 * Info Tab Content
 * Configuration info and quick usage commands
 */

import { ScrollArea } from '@/components/ui/scroll-area';
import { CopyButton } from '@/components/ui/copy-button';
import { Badge } from '@/components/ui/badge';
import { Info } from 'lucide-react';
import { TabsContent } from '@/components/ui/tabs';
import { useTranslation } from 'react-i18next';
import { UsageCommand } from './usage-command';

interface RawSettings {
  path: string;
  exists: boolean;
  mtime: number;
  settings?: Record<string, unknown>;
}

interface InfoTabProps {
  rawSettings: RawSettings | undefined;
}

export function InfoTab({ rawSettings }: InfoTabProps) {
  const { t } = useTranslation();
  return (
    <TabsContent value="info" className="h-full mt-0 border-0 p-0 data-[state=inactive]:hidden">
      <ScrollArea className="h-full">
        <div className="p-4 space-y-6">
          <div>
            <h3 className="text-sm font-medium flex items-center gap-2 mb-3">
              <Info className="w-4 h-4" />
              {/* TODO i18n: missing key for 'Configuration Info' */}
              Configuration Info
            </h3>
            <div className="space-y-3 bg-card rounded-lg border p-4 shadow-sm">
              <div className="grid grid-cols-[100px_1fr] gap-2 text-sm items-center">
                <span className="font-medium text-muted-foreground">
                  {t('copilotConfigForm.provider')}
                </span>
                <span className="font-mono">GitHub Copilot</span>
              </div>
              {rawSettings && (
                <>
                  <div className="grid grid-cols-[100px_1fr] gap-2 text-sm items-center">
                    <span className="font-medium text-muted-foreground">
                      {t('copilotConfigForm.filePath')}
                    </span>
                    <div className="flex items-center gap-2 min-w-0">
                      <code className="bg-muted px-1.5 py-0.5 rounded text-xs break-all">
                        {rawSettings.path}
                      </code>
                      <CopyButton value={rawSettings.path} size="icon" className="h-5 w-5" />
                    </div>
                  </div>
                  <div className="grid grid-cols-[100px_1fr] gap-2 text-sm items-center">
                    <span className="font-medium text-muted-foreground">
                      {t('copilotConfigForm.status')}
                    </span>
                    <Badge
                      variant="outline"
                      className={
                        rawSettings.exists
                          ? 'w-fit text-green-600 border-green-200 bg-green-50'
                          : 'w-fit text-muted-foreground'
                      }
                    >
                      {/* TODO i18n: missing key for 'File exists' / 'Using defaults' */}
                      {rawSettings.exists ? 'File exists' : 'Using defaults'}
                    </Badge>
                  </div>
                </>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium mb-3">{t('copilotConfigForm.quickUsage')}</h3>
            <div className="space-y-3 bg-card rounded-lg border p-4 shadow-sm">
              {/* TODO i18n: missing keys for usage command labels */}
              <UsageCommand label="Run with Copilot" command="ccs copilot" />
              <UsageCommand label="Authenticate" command="ccs copilot auth" />
              <UsageCommand label="Start daemon" command="ccs copilot --start" />
              <UsageCommand label="Stop daemon" command="ccs copilot --stop" />
            </div>
          </div>
        </div>
      </ScrollArea>
    </TabsContent>
  );
}
