/**
 * CLIProxy Control Panel Page
 *
 * Dedicated page for the CLIProxy management panel.
 */

import { ControlPanelEmbed } from '@/components/cliproxy/control-panel-embed';

export function CliproxyControlPanelPage() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <ControlPanelEmbed />
    </div>
  );
}
