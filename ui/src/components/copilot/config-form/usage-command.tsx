/**
 * Usage Command Component
 * Displays a command with copy button
 */

import { CopyButton } from '@/components/ui/copy-button';

interface UsageCommandProps {
  label: string;
  command: string;
}

export function UsageCommand({ label, command }: UsageCommandProps) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <div className="mt-1 flex gap-2">
        <code className="flex-1 px-2 py-1.5 bg-muted rounded text-xs font-mono truncate">
          {command}
        </code>
        <CopyButton value={command} size="icon" className="h-6 w-6" />
      </div>
    </div>
  );
}
