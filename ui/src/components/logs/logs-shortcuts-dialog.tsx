import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface LogsShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: ['j', '↓'], label: 'Next entry' },
  { keys: ['k', '↑'], label: 'Previous entry' },
  { keys: ['Enter'], label: 'Focus detail' },
  { keys: ['Esc'], label: 'Close detail (mobile)' },
  { keys: ['/'], label: 'Focus search' },
  { keys: ['Space'], label: 'Pause / resume tail' },
  { keys: ['?'], label: 'Show this help' },
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[11px] font-medium text-foreground">
      {children}
    </kbd>
  );
}

export function LogsShortcutsDialog({ open, onOpenChange }: LogsShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Logs surface keybindings.</DialogDescription>
        </DialogHeader>
        <ul className="mt-2 space-y-2">
          {SHORTCUTS.map((s) => (
            <li key={s.label} className="flex items-center justify-between text-sm">
              <span className="text-foreground/90">{s.label}</span>
              <span className="flex items-center gap-1">
                {s.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
