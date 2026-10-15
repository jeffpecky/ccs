/**
 * Flexible Model Selector Component
 * Dropdown selector for Copilot models with plan badges
 */

import { Badge } from '@/components/ui/badge';
import { SearchableSelect } from '@/components/ui/searchable-select';
import type { FlexibleModelSelectorProps } from './types';
import { getPlanBadgeStyle, getMultiplierDisplay } from './utils';
import { useTranslation } from 'react-i18next';

export function FlexibleModelSelector({
  label,
  description,
  value,
  onChange,
  models,
  disabled,
}: FlexibleModelSelectorProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-1.5">
      <div>
        <label className="text-xs font-medium">{label}</label>
        {description && <p className="text-[10px] text-muted-foreground">{description}</p>}
      </div>
      <SearchableSelect
        value={value || undefined}
        onChange={onChange}
        disabled={disabled}
        placeholder={t('componentModelSelector.selectModel')}
        searchPlaceholder={t('searchableSelect.searchModels')}
        emptyText={t('searchableSelect.noResults')}
        triggerClassName="h-9"
        groups={[
          {
            key: 'models',
            label: t('componentModelSelector.availableModelsCount', { count: models.length }),
          },
        ]}
        options={models.map((model) => ({
          value: model.id,
          groupKey: 'models',
          searchText: `${model.name || model.id} ${model.id}`,
          keywords: [model.minPlan ?? '', model.preview ? 'preview' : ''],
          triggerContent: (
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-mono text-xs">{model.id}</span>
              {model.minPlan && (
                <Badge
                  variant="outline"
                  className={`text-[9px] px-1 py-0 h-4 ${getPlanBadgeStyle(model.minPlan)}`}
                >
                  {model.minPlan}
                </Badge>
              )}
            </div>
          ),
          itemContent: (
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-mono text-xs">{model.name || model.id}</span>
              {model.minPlan && (
                <Badge
                  variant="outline"
                  className={`text-[9px] px-1 py-0 h-4 ${getPlanBadgeStyle(model.minPlan)}`}
                >
                  {model.minPlan}
                </Badge>
              )}
              {model.multiplier !== undefined && (
                <span className="text-[9px] text-muted-foreground">
                  {getMultiplierDisplay(model.multiplier)}
                </span>
              )}
              {model.preview && (
                <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
                  {t('componentModelSelector.preview')}
                </Badge>
              )}
            </div>
          ),
        }))}
      />
    </div>
  );
}
