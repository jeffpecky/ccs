/**
 * Global Environment Variables Indicator
 *
 * Shows which env vars from global_env will be injected at runtime.
 * Displayed below the Raw Configuration (JSON) section in profile editors.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Settings2, ChevronDown, ChevronUp, ExternalLink, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

interface GlobalEnvConfig {
  enabled: boolean;
  env: Record<string, string>;
}

interface GlobalEnvIndicatorProps {
  /** Current profile's env vars (to show which are overridden) */
  profileEnv?: Record<string, string>;
}

export function GlobalEnvIndicator({ profileEnv = {} }: GlobalEnvIndicatorProps) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<GlobalEnvConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/global-env');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setConfig(data);
    } catch {
      setConfig(null);
    } finally {
      setLoading(false);
    }
  };

  // Don't render if loading or disabled or no vars
  if (loading) return null;
  if (!config?.enabled) return null;

  const envVars = config.env || {};
  const envKeys = Object.keys(envVars);
  if (envKeys.length === 0) return null;

  // Check which keys are already in profile (won't be overridden)
  const injectedKeys = envKeys.filter((key) => !(key in profileEnv));
  const overriddenKeys = envKeys.filter((key) => key in profileEnv);

  return (
    <div className="border-t bg-muted/20">
      {/* Header - clickable to expand */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2 flex items-center gap-2 hover:bg-muted/30 transition-colors"
      >
        <Info className="w-4 h-4 text-blue-500" />
        <span className="text-xs text-muted-foreground flex-1 text-left">
          {t('globalEnvIndicator.injectedCount', { count: injectedKeys.length })}
          {overriddenKeys.length > 0 && (
            <span className="text-amber-600 dark:text-amber-400 ml-1">
              {t('globalEnvIndicator.overriddenCount', { count: overriddenKeys.length })}
            </span>
          )}
        </span>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {/* Injected vars */}
          {injectedKeys.length > 0 && (
            <div className="space-y-1">
              {injectedKeys.map((key) => (
                <div
                  key={key}
                  className="flex items-center gap-2 text-xs font-mono bg-green-500/10 text-green-700 dark:text-green-400 px-2 py-1 rounded"
                >
                  <span className="text-green-500">+</span>
                  <span className="truncate">
                    {key}={envVars[key]}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Overridden vars (profile takes precedence) */}
          {overriddenKeys.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {t('globalEnvIndicator.skippedLabel')}
              </p>
              {overriddenKeys.map((key) => (
                <div
                  key={key}
                  className="flex items-center gap-2 text-xs font-mono bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-1 rounded"
                >
                  <span className="text-amber-500">~</span>
                  <span className="truncate">{key}</span>
                </div>
              ))}
            </div>
          )}

          {/* Link to settings */}
          <div className="pt-2 border-t border-border/50">
            <Button variant="ghost" size="sm" asChild className="h-7 text-xs gap-1.5 -ml-2">
              <Link to="/settings?tab=globalenv">
                <Settings2 className="w-3.5 h-3.5" />
                {t('globalEnvIndicator.configureInSettings')}
                <ExternalLink className="w-3 h-3 opacity-50" />
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
