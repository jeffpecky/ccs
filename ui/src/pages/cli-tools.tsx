/**
 * CLI Tools Page - Master-Detail Layout
 * Uses CLIProviderEditor (standalone copy of ProviderEditor for CLI tools)
 */

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Check, X, RefreshCw, Terminal } from 'lucide-react';
import { CLIProviderEditor } from '@/components/cliproxy/cli-provider-editor';
import { ProviderLogo } from '@/components/cliproxy/provider-logo';
import {
  useCliproxyAuth,
  useCliproxyCatalog,
} from '@/hooks/use-cliproxy';
import { buildUiCatalogs } from '@/lib/model-catalogs';
import { cn } from '@/lib/utils';

// ==================== Types ====================

interface CLITool {
  id: string;
  name: string;
  description: string;
  status: 'installed' | 'not-installed' | 'unknown';
}

// ==================== API Functions ====================

async function fetchTools(): Promise<{ tools: CLITool[] }> {
  const res = await fetch('/api/cli-tools');
  if (!res.ok) throw new Error('Failed to fetch tools');
  return res.json();
}

// ==================== CLI Tool Icons ====================

function CLIToolLogo({ toolId, size = 'md' }: { toolId: string; size?: 'sm' | 'md' | 'lg' }) {
  const providerMap: Record<string, string> = {
    'claude-code': 'claude',
    opencode: 'openai',
    codex: 'codex',
    'open-claw': 'openai',
    'claude-cowork': 'claude',
    'hermes-agent': 'openai',
    'factory-droid': 'openai',
    cursor: 'openai',
    cline: 'openai',
    'kilo-code': 'openai',
    roo: 'openai',
    continue: 'openai',
    'amp-cli': 'openai',
    'qwen-code': 'openai',
    'deepseek-tui': 'openai',
    jcode: 'openai',
    'grok-build': 'openai',
    'devin-cli': 'openai',
  };

  const provider = providerMap[toolId] || 'openai';

  return <ProviderLogo provider={provider} size={size} />;
}

// ==================== Sidebar Component ====================

function CLIToolSidebarItem({
  tool,
  isSelected,
  onSelect,
}: {
  tool: CLITool;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={cn(
        'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer text-left',
        isSelected
          ? 'bg-primary/10 border border-primary/20'
          : 'hover:bg-muted border border-transparent'
      )}
      onClick={onSelect}
    >
      <CLIToolLogo toolId={tool.id} size="md" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{tool.name}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {tool.status === 'installed' ? (
            <>
              <Check className="w-3 h-3 text-green-600" />
              <span className="text-xs text-green-600">Ready</span>
            </>
          ) : (
            <>
              <X className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Not installed</span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

// Empty state for right panel
function EmptyCLIToolState() {
  return (
    <div className="flex-1 flex items-center justify-center bg-muted/20">
      <div className="text-center max-w-md px-8">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-6">
          <Terminal className="w-8 h-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Select a CLI Tool</h2>
        <p className="text-muted-foreground mb-4">
          Choose a CLI tool from the left panel to configure its settings.
        </p>
      </div>
    </div>
  );
}

// ==================== Main Component ====================

export function CliToolsPage() {
  const queryClient = useQueryClient();
  const { data: authData } = useCliproxyAuth();
  const { data: catalogData } = useCliproxyCatalog();

  const [selectedToolId, setSelectedToolId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('cli-tools-selected');
    }
    return null;
  });

  // Fetch CLI tools
  const { data: toolsData, isLoading, isFetching } = useQuery({
    queryKey: ['cli-tools'],
    queryFn: fetchTools,
  });

  const tools = useMemo(() => toolsData?.tools || [], [toolsData?.tools]);
  const providers = useMemo(() => authData?.authStatus || [], [authData?.authStatus]);
  const catalogs = useMemo(() => buildUiCatalogs(catalogData?.catalogs), [catalogData?.catalogs]);
  const routingHints = catalogData?.routing ?? {};
  const isRemoteMode = authData?.source === 'remote';

  // Auto-select first tool if none selected
  const effectiveToolId = useMemo(() => {
    if (selectedToolId && tools.some((t) => t.id === selectedToolId)) {
      return selectedToolId;
    }
    if (tools.length > 0) {
      return tools[0].id;
    }
    return null;
  }, [selectedToolId, tools]);

  const effectiveTool = useMemo(() => tools.find((t) => t.id === effectiveToolId), [tools, effectiveToolId]);

  const handleSelectTool = (toolId: string) => {
    setSelectedToolId(toolId);
    localStorage.setItem('cli-tools-selected', toolId);
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['cli-tools'] });
    queryClient.invalidateQueries({ queryKey: ['cliproxy-auth'] });
    queryClient.invalidateQueries({ queryKey: ['cliproxy-catalog'] });
  };

  const installedCount = tools.filter((t) => t.status === 'installed').length;

  // Map CLI tool to a provider for the right panel editor
  const getProviderForTool = (toolId: string) => {
    const providerMap: Record<string, string> = {
      'claude-code': 'claude',
      opencode: 'openai',
      codex: 'openai',
      'open-claw': 'openai',
      'claude-cowork': 'claude',
      'hermes-agent': 'openai',
      'factory-droid': 'openai',
      cursor: 'openai',
      cline: 'openai',
      'kilo-code': 'openai',
      roo: 'openai',
      continue: 'openai',
      'amp-cli': 'openai',
      'qwen-code': 'openai',
      'deepseek-tui': 'openai',
      jcode: 'openai',
      'grok-build': 'openai',
      'devin-cli': 'openai',
    };
    return providerMap[toolId] || 'openai';
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      {/* Left Sidebar */}
      <div className="w-80 border-r flex flex-col bg-muted/30">
        {/* Header */}
        <div className="p-4 border-b bg-background">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Terminal className="w-5 h-5 text-primary" />
              <h1 className="font-semibold">CLI Tools</h1>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleRefresh}
              disabled={isFetching}
            >
              <RefreshCw className={cn('w-4 h-4', isFetching && 'animate-spin')} />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Configure CLI tools to connect to the proxy. Apply settings, then run your CLI manually.
          </p>
        </div>

        {/* Tools List */}
        <ScrollArea className="flex-1">
          <div className="p-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-3 py-2">
              CLI TOOLS
            </div>
            {isLoading ? (
              <div className="space-y-2 px-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-lg" />
                ))}
              </div>
            ) : (
              <div className="space-y-1">
                {tools.map((tool) => (
                  <CLIToolSidebarItem
                    key={tool.id}
                    tool={tool}
                    isSelected={effectiveToolId === tool.id}
                    onSelect={() => handleSelectTool(tool.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer Stats */}
        <div className="p-3 border-t bg-background text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>{tools.length} tools</span>
            <span className="flex items-center gap-1">
              <Check className="w-3 h-3 text-green-600" />
              {installedCount} installed
            </span>
          </div>
        </div>
      </div>

      {/* Right Panel - CLI Provider Editor */}
      <div className="flex-1 flex min-w-0 flex-col overflow-hidden bg-background">
        {effectiveTool ? (
          <CLIProviderEditor
            provider={getProviderForTool(effectiveTool.id)}
            toolId={effectiveTool.id}
            displayName={effectiveTool.name}
            authStatus={providers.find((p) => p.provider === getProviderForTool(effectiveTool.id)) || {
              provider: getProviderForTool(effectiveTool.id),
              displayName: effectiveTool.name,
              authenticated: effectiveTool.status === 'installed',
              lastAuth: null,
              tokenFiles: 0,
              accounts: [],
            }}
            catalog={catalogs[getProviderForTool(effectiveTool.id)] || {
              provider: getProviderForTool(effectiveTool.id),
              displayName: effectiveTool.name,
              defaultModel: '',
              models: [],
            }}
            routing={routingHints[getProviderForTool(effectiveTool.id)]}
            isRemoteMode={isRemoteMode}
          />
        ) : (
          <EmptyCLIToolState />
        )}
      </div>
    </div>
  );
}

export default CliToolsPage;
