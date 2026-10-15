import { Shield, X } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useTranslation } from 'react-i18next';

export function LocalhostDisclaimer() {
  const [dismissed, setDismissed] = useState(false);
  const { authEnabled, authConfigured, isLocalAccess, loading } = useAuth();
  const { t } = useTranslation();

  const isRemoteReadonly = !isLocalAccess && !authEnabled;

  if ((dismissed && !isRemoteReadonly) || loading) return null;

  const wrapperClasses = isRemoteReadonly
    ? 'w-full border-t border-amber-200 bg-amber-50 px-4 py-2 text-amber-900 transition-colors duration-200 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200'
    : 'w-full border-t border-yellow-200 bg-yellow-50 px-4 py-2 text-yellow-800 transition-colors duration-200 dark:border-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-200';
  const dismissClasses = isRemoteReadonly
    ? 'text-amber-600 hover:bg-amber-100 hover:text-amber-800 dark:text-amber-400 dark:hover:bg-amber-800/30'
    : 'text-yellow-600 hover:bg-yellow-100 hover:text-yellow-800 dark:text-yellow-400 dark:hover:bg-yellow-800/30';
  const message = isRemoteReadonly ? (
    <>
      {authConfigured ? (
        <>
          <span className="hidden sm:inline">
            {t('localhostDisclaimer.remoteReadonlyAuthDisabledLong')}
          </span>
          <span className="sm:hidden">
            {t('localhostDisclaimer.remoteReadonlyAuthDisabledShort')}
          </span>
        </>
      ) : (
        <>
          <span className="hidden sm:inline">
            {t('localhostDisclaimer.remoteReadonlySetupLong')}
          </span>
          <span className="sm:hidden">{t('localhostDisclaimer.remoteReadonlySetupShort')}</span>
        </>
      )}
    </>
  ) : (
    <>
      <span className="hidden sm:inline">{t('localhostDisclaimer.localLong')}</span>
      <span className="sm:hidden">{t('localhostDisclaimer.localShort')}</span>
    </>
  );

  return (
    <div className={wrapperClasses}>
      <div className="flex items-center justify-center gap-4">
        <div className="flex items-center gap-2 text-sm">
          <Shield className="w-4 h-4 flex-shrink-0" />
          {message}
        </div>
        {!isRemoteReadonly ? (
          <button
            onClick={() => setDismissed(true)}
            className={`flex-shrink-0 rounded p-1 transition-colors ${dismissClasses}`}
            aria-label={t('localhostDisclaimer.dismiss')}
          >
            <X className="w-4 h-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
