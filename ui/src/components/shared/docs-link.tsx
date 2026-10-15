/**
 * Docs Link Button
 *
 * Links to CCS documentation site for guides and reference.
 */

import { BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

const DOCS_URL = 'https://docs.ccs.kaitran.ca';

export function DocsLink() {
  const { t } = useTranslation();

  return (
    <Button variant="ghost" size="icon" asChild title={t('docsLink.title')}>
      <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
        <BookOpen className="w-4 h-4" />
      </a>
    </Button>
  );
}
