/**
 * Provider Editor Header
 * Header bar with provider info, refresh and save buttons
 */

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Save, Loader2, RefreshCw, Globe, Network } from 'lucide-react';
import { ProviderLogo } from '../provider-logo';
import type { SettingsResponse } from './types';
import { useTranslation } from 'react-i18next';

interface ProviderEditorHeaderProps {
  provider: string;
  displayName: string;
  logoProvider?: string;
  data?: SettingsResponse;
  isLoading: boolean;
  hasChanges: boolean;
  isRawJsonValid: boolean;
  isSaving: boolean;
  isRemoteMode?: boolean;
  port?: number;
  onRefetch: () => void;
  onSave: () => void;
}

function formatSettingsPathBadgeLabel(pathValue: string): string {
  const normalized = pathValue.replace(/\\/g, '/');
  const cliproxySegment = '/cliproxy/providers/';
  const cliproxyIndex = normalized.lastIndexOf(cliproxySegment);
  if (cliproxyIndex !== -1) {
    return normalized.slice(cliproxyIndex + 1);
  }

  return normalized.replace(/^.*\//, '');
}

export function ProviderEditorHeader({
  displayName,
  logoProvider,
  provider,
  data,
  isLoading,
  hasChanges,
  isRawJsonValid,
  isSaving,
  isRemoteMode,
  port,
  onRefetch,
  onSave,
}: ProviderEditorHeaderProps) {
  const { t } = useTranslation();
  return (
    <div className="px-6 py-4 border-b bg-background flex items-center justify-between shrink-0">
      <div className="flex items-center gap-3">
        <ProviderLogo provider={logoProvider || provider} size="lg" />
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{displayName}</h2>
            {isRemoteMode && (
              <Badge
                variant="secondary"
                className="text-xs gap-1 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
              >
                <Globe className="w-3 h-3" />
                Remote
              </Badge>
            )}
            {port && (
              <Badge variant="outline" className="text-xs gap-1 font-mono">
                <Network className="w-3 h-3" />:{port}
              </Badge>
            )}
            {!isRemoteMode && data?.path && (
              <Badge variant="outline" className="text-xs">
                {formatSettingsPathBadgeLabel(data.path)}
              </Badge>
            )}
          </div>
          {isRemoteMode ? (
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
              {/* TODO i18n: missing key for remote traffic text */}
              Traffic auto-routed to remote server
            </p>
          ) : (
            data && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {t('providerEditor.lastModified')}: {new Date(data.mtime).toLocaleString()}
              </p>
            )
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onRefetch} disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>
        <Button size="sm" onClick={onSave} disabled={isSaving || !hasChanges || !isRawJsonValid}>
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-1" />
              Save
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
