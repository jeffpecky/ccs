import { LogsShell } from '@/components/logs/logs-shell';
import { LogsPageSkeleton } from '@/components/logs/logs-page-skeleton';
import { useLogsWorkspace, useUpdateLogsConfig } from '@/hooks/use-logs';

/**
 * Logs route — calm, virtualized 3-pane shell.
 *
 * Implementation lives in `LogsShell` (composition + layout) and the
 * `logs/*` components (filters/list/detail/settings). This file is just the
 * route + initial-load gate.
 */
export function LogsPage() {
  const workspace = useLogsWorkspace();
  const updateConfig = useUpdateLogsConfig();

  if (workspace.isInitialLoading) {
    return <LogsPageSkeleton />;
  }

  if (!workspace.configQuery.data) {
    return null;
  }

  return <LogsShell workspace={workspace} updateConfig={updateConfig} />;
}
