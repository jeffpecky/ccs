import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { LogsConfig, UpdateLogsConfigPayload } from '@/lib/api-client';

function parseInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(0, parsed);
}

export interface LogsConfigCardProps {
  config: LogsConfig;
  onSave: (payload: UpdateLogsConfigPayload) => void;
  isPending: boolean;
}

/**
 * Logging policy form. Calm chrome, designed to live inside a `Sheet`.
 * Renamed semantically to "form" -- the export name remains `LogsConfigCard`
 * for consumer compatibility.
 */
export function LogsConfigCard({ config, onSave, isPending }: LogsConfigCardProps) {
  const [draft, setDraft] = useState(config);

  useEffect(() => {
    setDraft(config);
  }, [config]);

  const isDirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(config), [config, draft]);

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
      }}
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4 rounded border border-border bg-background px-3 py-2">
          <div className="space-y-0.5">
            <Label htmlFor="logs-enabled" className="text-sm font-medium">
              Enabled
            </Label>
            <p className="text-xs text-muted-foreground">Capture structured log entries.</p>
          </div>
          <Switch
            id="logs-enabled"
            checked={draft.enabled}
            onCheckedChange={(checked) => setDraft((c) => ({ ...c, enabled: checked }))}
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded border border-border bg-background px-3 py-2">
          <div className="space-y-0.5">
            <Label htmlFor="logs-redact" className="text-sm font-medium">
              Redact sensitive values
            </Label>
            <p className="text-xs text-muted-foreground">
              Hide payload values until explicitly revealed.
            </p>
          </div>
          <Switch
            id="logs-redact"
            checked={draft.redact}
            onCheckedChange={(checked) => setDraft((c) => ({ ...c, redact: checked }))}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="logs-config-level" className="text-sm font-medium">
          Minimum level
        </Label>
        <Select
          value={draft.level}
          onValueChange={(value) =>
            setDraft((c) => ({ ...c, level: value as LogsConfig['level'] }))
          }
        >
          <SelectTrigger id="logs-config-level" className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="error">Error only</SelectItem>
            <SelectItem value="warn">Warn and above</SelectItem>
            <SelectItem value="info">Info and above</SelectItem>
            <SelectItem value="debug">Full debug</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="logs-rotate-mb" className="text-sm font-medium">
            Rotation (MB)
          </Label>
          <Input
            id="logs-rotate-mb"
            type="number"
            min={1}
            value={draft.rotate_mb}
            onChange={(e) =>
              setDraft((c) => ({
                ...c,
                rotate_mb: parseInteger(e.target.value, c.rotate_mb),
              }))
            }
            className="h-9"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="logs-retain-days" className="text-sm font-medium">
            Retention (days)
          </Label>
          <Input
            id="logs-retain-days"
            type="number"
            min={1}
            value={draft.retain_days}
            onChange={(e) =>
              setDraft((c) => ({
                ...c,
                retain_days: parseInteger(e.target.value, c.retain_days),
              }))
            }
            className="h-9"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-border pt-3">
        <Button type="submit" disabled={!isDirty || isPending} size="sm" className="gap-1.5">
          <Save className="h-3.5 w-3.5" aria-hidden="true" />
          Save changes
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!isDirty || isPending}
          onClick={() => setDraft(config)}
          className="gap-1.5"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Reset
        </Button>
      </div>
    </form>
  );
}
