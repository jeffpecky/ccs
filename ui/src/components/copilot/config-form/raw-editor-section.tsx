/**
 * Raw Editor Section
 * JSON editor panel for copilot settings
 */

import { Suspense } from 'react';
import { Loader2, X, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlobalEnvIndicator } from '@/components/shared/global-env-indicator';
import { CodeEditor } from '@/components/shared/lazy-code-editor';

interface RawEditorSectionProps {
  rawJsonContent: string;
  isRawJsonValid: boolean;
  rawJsonEdits: string | null;
  rawSettingsEnv: Record<string, string> | undefined;
  onChange: (value: string) => void;
  missingRequiredFields?: string[];
}

export function RawEditorSection({
  rawJsonContent,
  isRawJsonValid,
  rawJsonEdits,
  rawSettingsEnv,
  onChange,
  missingRequiredFields = [],
}: RawEditorSectionProps) {
  const { t } = useTranslation();
  const hasMissingFields = missingRequiredFields.length > 0;

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-full">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-muted-foreground">{t('providerEditor.loadingEditor')}</span>
        </div>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        {!isRawJsonValid && rawJsonEdits !== null && (
          <div className="mb-2 px-3 py-2 bg-destructive/10 text-destructive text-sm rounded-md flex items-center gap-2 mx-6 mt-4 shrink-0">
            <X className="w-4 h-4" />
            {/* TODO i18n: missing key for 'Invalid JSON syntax' */}
            Invalid JSON syntax
          </div>
        )}
        {isRawJsonValid && hasMissingFields && (
          <div className="mb-2 px-3 py-2 bg-warning/10 text-warning-foreground text-sm rounded-md flex items-start gap-2 mx-6 mt-4 shrink-0 border border-warning/20">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-500 shrink-0" />
            <div>
              <span className="font-medium text-amber-600 dark:text-amber-400">
                {/* TODO i18n: missing key for 'Missing required fields:' */}
                Missing required fields:
              </span>{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                {missingRequiredFields.join(', ')}
              </code>
              <p className="text-xs text-muted-foreground mt-1">
                {/* TODO i18n: missing key for 'These fields will use default values at runtime.' */}
                These fields will use default values at runtime.
              </p>
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-hidden px-6 pb-4 pt-4">
          <div className="h-full border rounded-md overflow-hidden bg-background">
            <CodeEditor
              value={rawJsonContent}
              onChange={onChange}
              language="json"
              minHeight="100%"
              heightMode="fill-parent"
            />
          </div>
        </div>
        {/* Global Env Indicator */}
        <div className="mx-6 mb-4">
          <div className="border rounded-md overflow-hidden">
            <GlobalEnvIndicator profileEnv={rawSettingsEnv} />
          </div>
        </div>
      </div>
    </Suspense>
  );
}
