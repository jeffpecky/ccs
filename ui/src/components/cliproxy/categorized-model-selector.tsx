/**
 * Categorized Model Selector
 * Groups models by provider (owned_by) with model counts
 */

import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Cpu } from 'lucide-react';
import type { CliproxyModelsResponse } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

/** Provider display configuration */
const CATEGORY_CONFIG: Record<string, { key: string; color: string }> = {
  google: { key: 'google', color: 'text-blue-600' },
  openai: { key: 'openai', color: 'text-green-600' },
  anthropic: { key: 'anthropic', color: 'text-orange-600' },
  antigravity: { key: 'antigravity', color: 'text-purple-600' },
  other: { key: 'other', color: 'text-gray-600' },
};

/** Get display name for category */
function getCategoryDisplay(category: string) {
  return (
    CATEGORY_CONFIG[category.toLowerCase()] || {
      key: 'other',
      color: 'text-gray-600',
    }
  );
}

interface CategorizedModelSelectorProps {
  /** Models data from API */
  modelsData: CliproxyModelsResponse | undefined;
  /** Whether data is loading */
  isLoading?: boolean;
  /** Currently selected model */
  value: string | undefined;
  /** Callback when model changes */
  onChange: (model: string) => void;
  /** Whether the selector is disabled */
  disabled?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Custom width class */
  className?: string;
}

export function CategorizedModelSelector({
  modelsData,
  isLoading,
  value,
  onChange,
  disabled,
  placeholder,
  className,
}: CategorizedModelSelectorProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('categorizedModelSelector.selectModel');

  // Sort categories by model count (descending)
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
    return <Skeleton className={cn('h-9 w-[280px]', className)} />;
  }

  if (!modelsData || modelsData.totalCount === 0) {
    return (
      <div className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
        <Cpu className="w-4 h-4" />
        <span>{t('categorizedModelSelector.noModelsAvailable')}</span>
      </div>
    );
  }

  return (
    <SearchableSelect
      value={value || undefined}
      onChange={onChange}
      disabled={disabled}
      placeholder={resolvedPlaceholder}
      searchPlaceholder={t('searchableSelect.searchModels')}
      emptyText={t('searchableSelect.noResults')}
      className={cn('w-[320px]', className)}
      groups={sortedCategories.map(({ category, display, models }) => ({
        key: category,
        label: (
          <div className="flex items-center justify-between">
            <span className={cn('font-semibold', display.color)}>
              {t(`cliproxyModelCategory.${display.key}`)}
            </span>
            <Badge variant="secondary" className="text-[10px] h-4 px-1.5 ml-2">
              {models.length}
            </Badge>
          </div>
        ),
      }))}
      options={sortedCategories.flatMap(({ category, models }) =>
        models.map((model) => ({
          value: model.id,
          groupKey: category,
          searchText: model.id,
          keywords: [category],
          itemContent: <span className="truncate">{model.id}</span>,
        }))
      )}
    />
  );
}

/** Compact variant for inline usage */
export function CategorizedModelSelectorCompact({
  modelsData,
  isLoading,
  value,
  onChange,
  disabled,
}: Omit<CategorizedModelSelectorProps, 'placeholder' | 'className'>) {
  const { t } = useTranslation();

  return (
    <CategorizedModelSelector
      modelsData={modelsData}
      isLoading={isLoading}
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder={t('categorizedModelSelector.modelPlaceholder')}
      className="w-[200px]"
    />
  );
}
