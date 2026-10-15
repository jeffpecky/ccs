/**
 * Diff Dialog Component
 * Shows before/after comparison before saving config
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTranslation } from 'react-i18next';

interface DiffDialogProps {
  open: boolean;
  onClose: () => void;
  original: string;
  modified: string;
  onConfirmSave: () => void;
  isSaving: boolean;
}

export function DiffDialog({
  open,
  onClose,
  original,
  modified,
  onConfirmSave,
  isSaving,
}: DiffDialogProps) {
  const { t } = useTranslation();
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');

  // Simple line-by-line diff
  const renderDiff = () => {
    const maxLines = Math.max(originalLines.length, modifiedLines.length);
    const rows = [];

    for (let i = 0; i < maxLines; i++) {
      const origLine = originalLines[i] ?? '';
      const modLine = modifiedLines[i] ?? '';
      const isChanged = origLine !== modLine;

      rows.push(
        <div key={i} className={`flex text-xs font-mono ${isChanged ? 'bg-amber-500/10' : ''}`}>
          <div className="w-8 text-right pr-2 text-muted-foreground/50 border-r">{i + 1}</div>
          <div className="flex-1 grid grid-cols-2">
            <div className={`px-2 ${isChanged ? 'bg-red-500/10 line-through' : ''}`}>
              {origLine}
            </div>
            <div className={`px-2 border-l ${isChanged ? 'bg-green-500/10' : ''}`}>{modLine}</div>
          </div>
        </div>
      );
    }

    return rows;
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>{t('cliproxyConfig.reviewChanges')}</DialogTitle>
        </DialogHeader>

        <div className="border rounded-lg overflow-hidden">
          <div className="grid grid-cols-2 text-xs font-medium bg-muted p-2 border-b">
            <div className="text-red-600">{t('cliproxyConfig.original')}</div>
            <div className="text-green-600 border-l pl-2">{t('cliproxyConfig.modified')}</div>
          </div>
          <ScrollArea className="h-[400px]">
            <div className="divide-y">{renderDiff()}</div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {/* TODO i18n: missing key for "Cancel" in diff context */}
            Cancel
          </Button>
          <Button onClick={onConfirmSave} disabled={isSaving}>
            {isSaving
              ? /* TODO i18n: missing key */ 'Saving...'
              : /* TODO i18n: missing key */ 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
