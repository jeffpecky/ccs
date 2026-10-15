import { Badge } from '@/components/ui/badge';
import { CcsLogo } from '@/components/shared/ccs-logo';
import { useTranslation } from 'react-i18next';

interface HeroSectionProps {
  version?: string;
}

export function HeroSection({ version }: HeroSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-4">
      <CcsLogo size="lg" showText={false} />
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{t('heroSection.title')}</h1>
          {version && (
            <Badge variant="outline" className="font-mono text-xs">
              v{version}
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground text-sm mt-1">{t('heroSection.subtitle')}</p>
      </div>
    </div>
  );
}
