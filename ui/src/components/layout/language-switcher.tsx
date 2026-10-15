import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { normalizeLocale, persistLocale, SUPPORTED_LOCALES } from '@/lib/locales';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const currentLocale = normalizeLocale(i18n.resolvedLanguage ?? i18n.language ?? 'en');

  const handleLocaleChange = (nextLocale: string) => {
    const normalized = persistLocale(nextLocale);
    void i18n.changeLanguage(normalized);
  };

  return (
    <div className="flex items-center gap-2">
      <Globe className="h-4 w-4 text-muted-foreground" />
      <Select value={currentLocale} onValueChange={handleLocaleChange}>
        <SelectTrigger className="h-8 w-[150px]">
          <SelectValue placeholder={t('layout.languageSwitcher')} />
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_LOCALES.map((locale) => (
            <SelectItem key={locale} value={locale}>
              {t(`locale.${locale}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
