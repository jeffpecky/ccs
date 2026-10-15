/**
 * Model Preferences Grid Component
 * Displays all available models categorized by provider source
 */

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Cpu, AlertCircle } from 'lucide-react';
import { useCliproxyModels, useCliproxyUpdateCheck } from '@/hooks/use-cliproxy';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

/** Category display configuration */
const CATEGORY_CONFIG: Record<string, { key: string; color: string; bgColor: string }> = {
  google: { key: 'google', color: 'text-blue-600', bgColor: 'bg-blue-50' },
  openai: { key: 'openai', color: 'text-green-600', bgColor: 'bg-green-50' },
  anthropic: { key: 'anthropic', color: 'text-orange-600', bgColor: 'bg-orange-50' },
  antigravity: { key: 'antigravity', color: 'text-purple-600', bgColor: 'bg-purple-50' },
  other: { key: 'other', color: 'text-gray-600', bgColor: 'bg-gray-50' },
};

function getCategoryDisplay(category: string) {
  const normalized = category.toLowerCase();
  const configured = CATEGORY_CONFIG[normalized];
  return (
    configured || {
      key: 'other',
      color: 'text-gray-600',
      bgColor: 'bg-gray-50',
    }
  );
}

function ModelPreferencesSkeleton({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyModelsState({
  title,
  noModels,
  hint,
}: {
  title: string;
  noModels: string;
  hint: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
            <AlertCircle className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground mb-1">{noModels}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function ModelPreferencesGrid() {
  const { t } = useTranslation();
  const { data: modelsData, isLoading, isError } = useCliproxyModels();
  const { data: updateCheck } = useCliproxyUpdateCheck();
  const backendLabel = updateCheck?.backendLabel ?? 'CLIProxy';

  // Sort categories by model count
  const sortedCategories = useMemo(() => {
    if (!modelsData?.byCategory) return [];
    return Object.entries(modelsData.byCategory)
      .sort(([, a], [, b]) => b.length - a.length)
      .map(([category, models]) => ({
        category,
        display: getCategoryDisplay(category),
        models,
      }));
  }, [modelsData]);

  if (isLoading) {
    return <ModelPreferencesSkeleton title={t('cliproxyOverviewComponents.availableModels')} />;
  }

  if (isError || !modelsData || modelsData.totalCount === 0) {
    return (
      <EmptyModelsState
        title={t('cliproxyOverviewComponents.availableModels')}
        noModels={t('cliproxyOverviewComponents.noModelsAvailable')}
        hint={t('cliproxyOverviewComponents.startSessionHint')}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Cpu className="w-4 h-4" />
          {t('cliproxyOverviewComponents.availableModels')}
          <Badge variant="secondary" className="text-xs">
            {t('cliproxyOverviewComponents.totalCount', { count: modelsData.totalCount })}
          </Badge>
        </CardTitle>
        <CardDescription>
          {t('cliproxyOverviewComponents.availableThroughGroupedByProvider', { backendLabel })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedCategories.map(({ category, display, models }) => (
            <div
              key={category}
              className={cn('p-4 rounded-lg border', display.bgColor, 'border-transparent')}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className={cn('font-medium text-sm', display.color)}>
                  {t(`cliproxyModelCategory.${display.key}`)}
                </h3>
                <Badge variant="outline" className="text-xs">
                  {models.length}
                </Badge>
              </div>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {models.slice(0, 5).map((model) => (
                  <div
                    key={model.id}
                    className="text-xs text-muted-foreground truncate"
                    title={model.id}
                  >
                    {model.id}
                  </div>
                ))}
                {models.length > 5 && (
                  <div className="text-xs text-muted-foreground italic">
                    {t('cliproxyOverviewComponents.moreCount', { count: models.length - 5 })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
