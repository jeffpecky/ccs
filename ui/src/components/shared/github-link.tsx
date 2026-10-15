/**
 * GitHub Link Button
 *
 * Links to CCS GitHub issues page for bug reports and feature requests.
 */

import { Github } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

const GITHUB_REPO_URL = 'https://github.com/kaitranntt/ccs/issues';

export function GitHubLink() {
  const { t } = useTranslation();

  return (
    <Button variant="ghost" size="icon" asChild title={t('githubLink.title')}>
      <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer">
        <Github className="w-4 h-4" />
      </a>
    </Button>
  );
}
