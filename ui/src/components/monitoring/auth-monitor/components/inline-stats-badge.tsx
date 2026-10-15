/**
 * InlineStatsBadge - Inline success/failure badge for provider cards
 */

import { CheckCircle2, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface InlineStatsBadgeProps {
  success: number;
  failure: number;
}

export function InlineStatsBadge({ success, failure }: InlineStatsBadgeProps) {
  const { t } = useTranslation();
  if (success === 0 && failure === 0) {
    return (
      <span className="text-[9px] text-muted-foreground/50 font-mono">
        {t('authMonitorLive.noActivity')}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        <CheckCircle2 className="w-3 h-3 text-emerald-700 dark:text-emerald-500" />
        <span className="text-[10px] font-mono font-medium text-emerald-700 dark:text-emerald-500">
          {success.toLocaleString()}
        </span>
      </div>
      {failure > 0 && (
        <div className="flex items-center gap-0.5">
          <XCircle className="w-3 h-3 text-red-700 dark:text-red-500" />
          <span className="text-[10px] font-mono font-medium text-red-700 dark:text-red-500">
            {failure.toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );
}
