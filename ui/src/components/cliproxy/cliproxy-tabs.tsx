/**
 * CLIProxy Tabs Component
 * Tab navigation wrapper for Overview, Config, and Logs tabs
 */

import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LayoutDashboard, FileCode, ScrollText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type CliproxyTabValue = 'overview' | 'config' | 'logs';

interface CliproxyTabsProps {
  activeTab: CliproxyTabValue;
  onTabChange: (tab: CliproxyTabValue) => void;
  children: {
    overview: ReactNode;
    config: ReactNode;
    logs: ReactNode;
  };
}

const TAB_CONFIG = [
  { value: 'overview' as const, labelKey: 'cliproxyTabs.overview', icon: LayoutDashboard },
  { value: 'config' as const, labelKey: 'Config', icon: FileCode },
  { value: 'logs' as const, labelKey: 'Logs', icon: ScrollText },
];

export function CliproxyTabs({ activeTab, onTabChange, children }: CliproxyTabsProps) {
  const { t } = useTranslation();
  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => onTabChange(v as CliproxyTabValue)}
      className="w-full"
    >
      <TabsList className="grid w-full grid-cols-3 max-w-md">
        {TAB_CONFIG.map(({ value, labelKey, icon: Icon }) => (
          <TabsTrigger key={value} value={value} className="gap-2">
            <Icon className="w-4 h-4" />
            <span className="hidden sm:inline">{t(labelKey)}</span>
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="overview" className="mt-6">
        {children.overview}
      </TabsContent>
      <TabsContent value="config" className="mt-6">
        {children.config}
      </TabsContent>
      <TabsContent value="logs" className="mt-6">
        {children.logs}
      </TabsContent>
    </Tabs>
  );
}
