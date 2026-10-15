/**
 * Header Section
 * Top header with title, badge, last modified, and action buttons
 */

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface RawSettings {
  path: string;
  exists: boolean;
  mtime: number;
  settings?: Record<string, unknown>;
}

interface HeaderSectionProps {
  rawSettings: RawSettings | undefined;
  rawSettingsLoading: boolean;
  isUpdating: boolean;
  isSavingRawSettings: boolean;
  hasChanges: boolean;
  isRawJsonValid: boolean;
  onRefresh: () => void;
  onSave: () => void;
}

export function HeaderSection({
  rawSettings,
  rawSettingsLoading,
  isUpdating,
  isSavingRawSettings,
  hasChanges,
  isRawJsonValid,
  onRefresh,
  onSave,
}: HeaderSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="px-6 py-4 border-b bg-background flex items-center justify-between shrink-0">
      <div className="flex items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{t('copilotConfigForm.copilotConfiguration')}</h2>
            {rawSettings && (
              <Badge variant="outline" className="text-xs">
                copilot.settings.json
              </Badge>
            )}
          </div>
          {rawSettings && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {/* TODO i18n: missing key copilotConfigForm.lastModified */}
              Last modified: {/* TODO i18n: missing key copilotConfigForm.neverSaved */}
              {rawSettings.exists ? new Date(rawSettings.mtime).toLocaleString() : 'Never saved'}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={rawSettingsLoading}>
          <RefreshCw className={`w-4 h-4 ${rawSettingsLoading ? 'animate-spin' : ''}`} />
        </Button>
        <Button
          size="sm"
          onClick={onSave}
          disabled={isUpdating || isSavingRawSettings || !hasChanges || !isRawJsonValid}
        >
          {isUpdating || isSavingRawSettings ? (
            <>
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              {/* TODO i18n: missing key copilotConfigForm.saving */}
              Saving...
            </>
          ) : (
            <>
              <Save className="w-4 h-4 mr-1" />
              {/* TODO i18n: missing key copilotConfigForm.save */}
              Save
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
