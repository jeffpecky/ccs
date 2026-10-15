import { type HealthGroup } from '@/hooks/use-health';
import { HealthCheckItem } from './health-check-item';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronRight, ShieldCheck, Info } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface HealthAuditSectionProps {
  groups: HealthGroup[];
}

export function HealthAuditSection({ groups }: HealthAuditSectionProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 px-1">
        <h2 className="text-sm font-bold tracking-widest uppercase text-muted-foreground/60">
          {t('health.environmentAudit')}
        </h2>
        <div className="h-px flex-1 bg-border/40" />
        <ShieldCheck className="w-4 h-4 text-emerald-500/60" />
      </div>

      <div className="space-y-4">
        {groups.map((group) => (
          <AuditGroup key={group.id} group={group} />
        ))}
      </div>
    </div>
  );
}

function AuditGroup({ group }: { group: HealthGroup }) {
  const [isOpen, setIsOpen] = useState(false);
  const issuesCount = group.checks.filter(
    (c) => c.status === 'error' || c.status === 'warning'
  ).length;
  const hasIssues = issuesCount > 0;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="group/audit">
      <div
        className={cn(
          'rounded-2xl border transition-all duration-300',
          isOpen ? 'bg-muted/30 border-border/60' : 'bg-background hover:border-border/60'
        )}
      >
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center gap-4 px-5 py-4 text-left">
            <div
              className={cn(
                'flex items-center justify-center w-8 h-8 rounded-full transition-colors',
                hasIssues ? 'bg-rose-500/10 text-rose-500' : 'bg-muted text-muted-foreground'
              )}
            >
              {hasIssues ? <Info className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
            </div>

            <div className="flex-1">
              <h3 className="text-sm font-bold tracking-tight">{group.name}</h3>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-mono">
                {group.checks.length} Checks
              </p>
            </div>

            {hasIssues && (
              <div className="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-500 text-[10px] font-bold font-mono">
                {issuesCount}
              </div>
            )}

            <ChevronRight
              className={cn(
                'w-4 h-4 text-muted-foreground transition-transform duration-300',
                isOpen && 'rotate-90'
              )}
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-5 pb-5 space-y-1">
            {group.checks.map((check) => (
              <HealthCheckItem key={check.id} check={check} />
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
