import { Badge } from '@/components/ui/badge';
import { ProviderLogo } from '@/components/cliproxy/provider-logo';
import { getAiProviderFamilyVisual } from '@/lib/provider-config';
import { cn } from '@/lib/utils';
import type {
  AiProviderFamilyId,
  AiProviderFamilyState,
} from '../../../../../src/cliproxy/ai-providers';
import { AlertCircle, Check, Circle } from 'lucide-react';

interface FamilyRailProps {
  families: AiProviderFamilyState[];
  selectedFamily: AiProviderFamilyId;
  onSelect: (family: AiProviderFamilyId) => void;
}

function getStatusState(status: AiProviderFamilyState['status']) {
  switch (status) {
    case 'ready':
      return {
        icon: Check,
        text: 'Ready', // TODO i18n: missing key
        className: 'text-green-600',
      };
    case 'partial':
      return {
        icon: AlertCircle,
        text: 'Needs attention', // TODO i18n: missing key
        className: 'text-amber-600',
      };
    default:
      return {
        icon: Circle,
        text: 'Not configured', // TODO i18n: missing key
        className: 'text-muted-foreground',
      };
  }
}

export function FamilyRail({ families, selectedFamily, onSelect }: FamilyRailProps) {
  return (
    <div className="space-y-1">
      {families.map((family) => {
        const isSelected = family.id === selectedFamily;
        const statusState = getStatusState(family.status);
        const StatusIcon = statusState.icon;

        return (
          <button
            key={family.id}
            type="button"
            onClick={() => onSelect(family.id)}
            className={cn(
              'w-full cursor-pointer rounded-lg border px-3 py-2.5 text-left transition-colors',
              isSelected
                ? 'border-primary/20 bg-primary/10'
                : 'border-transparent hover:bg-muted/70'
            )}
          >
            <div className="flex items-center gap-3">
              <ProviderLogo provider={getAiProviderFamilyVisual(family.id)} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{family.displayName}</span>
                  {family.entries.length > 0 && (
                    <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                      {family.entries.length}
                    </Badge>
                  )}
                </div>
                <div
                  className={cn('mt-0.5 flex items-center gap-1.5 text-xs', statusState.className)}
                >
                  <StatusIcon className="h-3 w-3" />
                  <span>{statusState.text}</span>
                </div>
              </div>
              <Badge variant="outline" className="h-5 px-1.5 text-[9px] uppercase tracking-wide">
                {family.authMode}
              </Badge>
            </div>
          </button>
        );
      })}
    </div>
  );
}
