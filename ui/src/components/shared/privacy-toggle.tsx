/**
 * Privacy Toggle Button
 * Toggles demo mode to blur personal information (emails, account IDs)
 */

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePrivacy } from '@/contexts/privacy-context';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

export function PrivacyToggle() {
  const { privacyMode, togglePrivacyMode } = usePrivacy();
  const { t } = useTranslation();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={togglePrivacyMode}
          className={cn(
            'h-8 w-8 transition-colors',
            privacyMode && 'text-amber-600 hover:text-amber-700 dark:text-amber-400'
          )}
        >
          {privacyMode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{privacyMode ? t('privacyToggle.modeOn') : t('privacyToggle.modeOff')}</p>
      </TooltipContent>
    </Tooltip>
  );
}
