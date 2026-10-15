import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getRequestedModelId } from '@/lib/provider-config';
import { cn } from '@/lib/utils';
import type {
  AiProviderEntryView,
  AiProviderFamilyState,
} from '../../../../../src/cliproxy/ai-providers';
import { Check, ChevronRight, Circle, KeyRound, Pencil, Trash2 } from 'lucide-react';

interface ProviderEntryCardProps {
  family: AiProviderFamilyState;
  entry: AiProviderEntryView;
  onEdit: () => void;
  onDelete: () => void;
  onSelect?: () => void;
  isSelected?: boolean;
  variant?: 'row' | 'detail';
}

function renderCountLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function renderSecretBadge(entry: AiProviderEntryView) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'border-transparent text-[10px]',
        entry.secretConfigured
          ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
          : 'bg-muted text-muted-foreground hover:bg-muted'
      )}
    >
      {/* TODO i18n: missing keys for 'Configured' / 'Missing secret' */}
      {entry.secretConfigured ? 'Configured' : 'Missing secret'}
    </Badge>
  );
}

export function ProviderEntryCard({
  family,
  entry,
  onEdit,
  onDelete,
  onSelect,
  isSelected = false,
  variant = 'detail',
}: ProviderEntryCardProps) {
  // i18n: most strings in this file lack keys. See TODO comments below.
  const hasAdvancedRouting = entry.prefix || entry.proxyUrl || entry.excludedModels.length > 0;

  if (variant === 'row') {
    return (
      <div
        role={onSelect ? 'button' : undefined}
        tabIndex={onSelect ? 0 : undefined}
        className={cn(
          'group rounded-xl border bg-background px-3 py-3 transition-colors',
          onSelect && 'cursor-pointer',
          isSelected
            ? 'border-primary/20 bg-primary/5 shadow-sm'
            : 'border-border/60 hover:bg-muted/40'
        )}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (!onSelect) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect();
          }
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'mt-0.5 flex h-8 w-8 items-center justify-center rounded-md border',
              entry.secretConfigured
                ? 'border-emerald-200 bg-emerald-50 text-emerald-600'
                : 'border-border bg-muted/60 text-muted-foreground'
            )}
          >
            <KeyRound className="h-4 w-4" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium">{entry.label}</span>
              {renderSecretBadge(entry)}
            </div>
            <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
              {entry.baseUrl || family.routePath}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                {renderCountLabel(entry.models.length, 'alias')}
              </Badge>
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                {renderCountLabel(entry.headers.length, 'header')}
              </Badge>
              {entry.excludedModels.length > 0 && (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  {renderCountLabel(entry.excludedModels.length, 'rule')}
                </Badge>
              )}
              {(entry.proxyUrl || entry.prefix) && (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  Routed
                </Badge>
              )}
            </div>
          </div>

          <div className="flex items-start gap-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 opacity-0 group-hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                onEdit();
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 opacity-0 group-hover:opacity-100 hover:text-destructive"
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            {onSelect ? (
              <div className="flex h-7 w-7 items-center justify-center text-muted-foreground">
                <ChevronRight
                  className={cn('h-4 w-4 transition-transform', isSelected && 'translate-x-0.5')}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{entry.label}</h3>
            {renderSecretBadge(entry)}
          </div>
          <p className="text-xs text-muted-foreground">
            Routed through <span className="font-mono">{family.routePath}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onEdit}>
            <Pencil className="mr-1 h-3.5 w-3.5" />
            Edit
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDelete}>
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Remove
          </Button>
        </div>
      </div>

      <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Secret</div>
          <div className="mt-1 flex items-center gap-2 text-sm">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <span>{entry.apiKeyMasked || entry.apiKeysMasked?.join(', ') || 'Not stored'}</span>
          </div>
        </div>
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Base URL</div>
          <div className="mt-1 break-all text-sm">
            {entry.baseUrl || 'Default runtime endpoint'}
          </div>
        </div>
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Aliases</div>
          <div className="mt-1 text-sm">{renderCountLabel(entry.models.length, 'mapping')}</div>
        </div>
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Headers</div>
          <div className="mt-1 text-sm">{renderCountLabel(entry.headers.length, 'header')}</div>
        </div>
      </div>

      {hasAdvancedRouting && (
        <div className="flex flex-wrap gap-2 px-5 pb-4 text-xs text-muted-foreground">
          {entry.prefix && <Badge variant="secondary">Prefix {entry.prefix}</Badge>}
          {entry.proxyUrl && <Badge variant="secondary">Proxy URL set</Badge>}
          {entry.excludedModels.length > 0 && (
            <Badge variant="secondary">
              {renderCountLabel(entry.excludedModels.length, 'excluded model')}
            </Badge>
          )}
        </div>
      )}

      {(entry.models.length > 0 || entry.headers.length > 0 || entry.excludedModels.length > 0) && (
        <div className="grid gap-4 border-t px-5 py-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Route metadata
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                {entry.secretConfigured ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground" />
                )}
                <span>
                  {entry.secretConfigured ? 'Secret stored in CLIProxy' : 'Secret missing'}
                </span>
              </div>
              <div className="text-muted-foreground">
                {entry.proxyUrl || entry.baseUrl || 'Default runtime endpoint'}
              </div>
            </div>
          </div>

          {entry.models.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Model aliases
              </div>
              <div className="space-y-1 text-sm">
                {entry.models.map((model) => (
                  <div
                    key={`${model.name}:${model.alias}`}
                    className="rounded-md border bg-muted/20 px-3 py-2"
                  >
                    <span className="font-medium">{getRequestedModelId(model)}</span>
                    {model.alias.trim() ? (
                      <>
                        <span className="mx-2 text-muted-foreground">→</span>
                        <span className="text-muted-foreground">{model.name}</span>
                      </>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {entry.headers.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Headers
              </div>
              <div className="space-y-1 text-sm">
                {entry.headers.map((header) => (
                  <div
                    key={`${header.key}:${header.value}`}
                    className="rounded-md border bg-muted/20 px-3 py-2"
                  >
                    <span className="font-medium">{header.key}</span>
                    <span className="mx-2 text-muted-foreground">:</span>
                    <span className="break-all text-muted-foreground">{header.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {entry.excludedModels.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Excluded models
              </div>
              <div className="flex flex-wrap gap-2">
                {entry.excludedModels.map((model) => (
                  <Badge key={model} variant="secondary">
                    {model}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
