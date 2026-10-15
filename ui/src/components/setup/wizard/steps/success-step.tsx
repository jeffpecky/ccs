/**
 * Success Step
 */

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Check } from 'lucide-react';
import type { SuccessStepProps } from '../types';
import { useTranslation } from 'react-i18next';

export function SuccessStep({ variantName, onClose }: SuccessStepProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4 text-center">
      <div className="flex justify-center">
        <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
          <Check className="w-8 h-8 text-green-600 dark:text-green-400" />
        </div>
      </div>
      <div>
        <div className="font-semibold text-lg">{t('setupWizard.successStep.title')}</div>
        <div className="text-sm text-muted-foreground">{t('setupWizard.successStep.subtitle')}</div>
      </div>
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="text-sm text-muted-foreground">{t('setupWizard.successStep.usage')}</div>
          <code className="block px-3 py-2 bg-muted rounded-md font-mono text-sm">
            ccs {variantName} "your prompt here"
          </code>
        </CardContent>
      </Card>
      <Button onClick={onClose} className="w-full">
        {t('setupWizard.successStep.done')}
      </Button>
    </div>
  );
}
