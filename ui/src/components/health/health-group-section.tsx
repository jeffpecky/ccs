import { ChevronDown, Monitor, Settings, Users, Shield, Zap } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { HealthCheckItem } from './health-check-item';
import { type HealthGroup } from '@/hooks/use-health';
import { cn } from '@/lib/utils';
import { useState } from 'react';

const groupIcons: Record<string, typeof Monitor> = {
  Monitor,
  Settings,
  Users,
  Shield,
  Zap,
};

interface HealthGroupSectionProps {
  group: HealthGroup;
  defaultOpen?: boolean;
}

export function HealthGroupSection({ group, defaultOpen = true }: HealthGroupSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const Icon = groupIcons[group.icon] || Monitor;

  const passed = group.checks.filter((c) => c.status === 'ok').length;
  const total = group.checks.length;
  const hasErrors = group.checks.some((c) => c.status === 'error');
  const hasWarnings = group.checks.some((c) => c.status === 'warning');
  const percentage = Math.round((passed / total) * 100);

  // Determine status color
  const statusColor = hasErrors
    ? 'text-red-500'
    : hasWarnings
      ? 'text-yellow-500'
      : 'text-green-500';
  const progressColor = hasErrors ? 'bg-red-500' : hasWarnings ? 'bg-yellow-500' : 'bg-green-500';

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={cn(
          'rounded-lg border transition-all duration-200',
          hasErrors ? 'border-red-500/30' : hasWarnings ? 'border-yellow-500/30' : 'border-border'
        )}
      >
        {/* Group header */}
        <CollapsibleTrigger asChild>
          <button
            className={cn(
              'w-full flex items-center gap-3 p-3 text-left rounded-lg',
              'hover:bg-muted/50 transition-colors duration-150',
              isOpen && 'rounded-b-none border-b border-border/50'
            )}
          >
            {/* Group icon */}
            <div
              className={cn(
                'p-1.5 rounded-md',
                hasErrors
                  ? 'bg-red-500/10 text-red-500'
                  : hasWarnings
                    ? 'bg-yellow-500/10 text-yellow-500'
                    : 'bg-muted text-muted-foreground'
              )}
            >
              <Icon className="w-4 h-4" />
            </div>

            {/* Group name */}
            <span className="flex-1 text-sm font-semibold">{group.name}</span>

            {/* Progress indicator (collapsed view) */}
            {!isOpen && (
              <div className="flex items-center gap-2">
                <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn('h-full transition-all duration-500', progressColor)}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            )}

            {/* Count badge */}
            <span className={cn('font-mono text-xs font-semibold', statusColor)}>
              {passed}/{total}
            </span>

            {/* Chevron */}
            <ChevronDown
              className={cn(
                'w-4 h-4 text-muted-foreground transition-transform duration-200',
                isOpen && 'rotate-180'
              )}
            />
          </button>
        </CollapsibleTrigger>

        {/* Checks list */}
        <CollapsibleContent>
          <div className="p-2 space-y-0.5">
            {group.checks.map((check) => (
              <HealthCheckItem key={check.id} check={check} />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
