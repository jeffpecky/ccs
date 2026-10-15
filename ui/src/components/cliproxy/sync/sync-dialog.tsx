/**
 * Sync Dialog Component
 * Dialog for managing sync configuration, preview, and execution
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Upload, CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useSyncPreview, useExecuteSync } from '@/hooks/use-cliproxy-sync';

interface SyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SyncDialog({ open, onOpenChange }: SyncDialogProps) {
  const { t } = useTranslation();
  const { data: preview, isLoading: previewLoading } = useSyncPreview();
  const { mutate: executeSync, isPending: isSyncing, isSuccess, reset } = useExecuteSync();

  const handleSync = () => {
    executeSync(undefined, {
      onSuccess: () => {
        // Keep dialog open to show success
      },
    });
  };

  const handleClose = () => {
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            {t('syncDialog.title')}
          </DialogTitle>
          <DialogDescription>{t('syncDialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          {previewLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : preview?.count === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>{t('syncDialog.noProfiles')}</p>
              <p className="text-sm mt-2">{t('syncDialog.createProfilesFirst')}</p>
            </div>
          ) : (
            <ScrollArea className="h-[300px] pr-4">
              <div className="space-y-3">
                {preview?.profiles.map((profile) => (
                  <div
                    key={profile.name}
                    className="flex items-center justify-between p-3 rounded-lg border bg-muted/30"
                  >
                    <div className="flex-1">
                      <div className="font-medium">{profile.name}</div>
                      {profile.modelName && (
                        <div className="text-xs text-muted-foreground truncate max-w-[300px]">
                          {t('syncDialog.modelLabel')} {profile.modelName}
                        </div>
                      )}
                      {profile.baseUrl && (
                        <div className="text-xs text-muted-foreground truncate max-w-[300px]">
                          {profile.baseUrl}
                        </div>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {t('syncDialog.ready')}
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          <div className="flex items-center justify-between mt-6 pt-4 border-t">
            <div className="text-sm text-muted-foreground">
              {t('syncDialog.profilesToSync', { count: preview?.count ?? 0 })}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose}>
                {t('syncDialog.cancel')}
              </Button>
              <Button
                onClick={handleSync}
                disabled={isSyncing || (preview?.count ?? 0) === 0}
                className={cn('gap-2', isSuccess && 'bg-green-600 hover:bg-green-700')}
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('syncDialog.syncing')}
                  </>
                ) : isSuccess ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    {t('syncDialog.synced')}
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    {t('syncDialog.syncNow')}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
