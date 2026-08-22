import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Activity,
  BrainCircuit,
  ExternalLink,
  Gauge,
  Hammer,
  Loader2,
  Play,
  RefreshCw,
  Square,
  TerminalSquare,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

interface TokenSaverConfig {
  enabled: boolean;
  rtk: boolean;
  caveman: { enabled: boolean; level: string };
  ponytail: { enabled: boolean; level: string };
  headroom: {
    enabled: boolean;
    url: string;
    mode: 'local' | 'external';
    timeout_ms: number;
    compress_user_messages: boolean;
    token_env: string;
    code_aware: boolean;
    kompress: boolean;
  };
  pxpipe: { enabled: boolean; min_chars: number; timeout_ms: number };
}

interface HeadroomStatus {
  installed: boolean;
  running: boolean;
  healthy: boolean;
  managed: boolean;
  local: boolean;
  port?: number;
}

interface HeadroomExtrasStatus {
  installed: boolean;
  version: string | null;
  extras: { code: boolean; ml: boolean };
}

function getHeadroomDashboardUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/dashboard`;
    return url.href;
  } catch {
    return null;
  }
}

const LEVELS = ['Lite', 'Full', 'Ultra'] as const;

function displayLevel(value: string): (typeof LEVELS)[number] {
  if (value === 'lite') return 'Lite';
  if (value === 'ultra') return 'Ultra';
  return 'Full';
}

function storedLevel(level: (typeof LEVELS)[number]): string {
  if (level === 'Lite') return 'lite';
  if (level === 'Ultra') return 'ultra';
  return 'full';
}

function LevelControl({
  name,
  value,
  disabled,
  onChange,
}: {
  name: 'Caveman' | 'Ponytail';
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const selected = displayLevel(value);
  return (
    <div
      role="group"
      aria-label={`${name} compression level`}
      className="grid grid-cols-3 rounded-md border bg-muted/30 p-0.5"
    >
      {LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          aria-pressed={selected === level}
          disabled={disabled}
          onClick={() => onChange(storedLevel(level))}
          className={cn(
            'rounded-sm px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45',
            selected === level
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {level}
        </button>
      ))}
    </div>
  );
}

function SaverRow({
  icon,
  title,
  name,
  description,
  checked,
  onCheckedChange,
  controls,
  disabled,
}: {
  icon: ReactNode;
  title: string;
  name: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  controls?: ReactNode;
  disabled: boolean;
}) {
  return (
    <section
      data-testid="token-saver-row"
      className="grid gap-4 border-b px-4 py-5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6"
    >
      <div className="flex min-w-0 gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="text-sm font-semibold">{title}</h2>
            <span className="text-xs text-muted-foreground">{name}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 pl-12 sm:pl-0">
        {controls}
        <Switch
          aria-label={name}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
        />
      </div>
    </section>
  );
}

export function TokenSaverPage() {
  const [config, setConfig] = useState<TokenSaverConfig>();
  const [status, setStatus] = useState<HeadroomStatus>();
  const [extrasStatus, setExtrasStatus] = useState<HeadroomExtrasStatus>({
    installed: false,
    version: null,
    extras: { code: false, ml: false },
  });
  const [installLog, setInstallLog] = useState('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installingExtras, setInstallingExtras] = useState<Set<string>>(new Set());
  const [uninstallingExtra, setUninstallingExtra] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const logPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const persistController = useRef<AbortController | null>(null);
  const refreshController = useRef<AbortController | null>(null);
  const refreshSequence = useRef(0);
  const persistSequence = useRef(0);

  const refresh = async (manual = false) => {
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    const sequence = ++refreshSequence.current;
    if (manual) setRefreshing(true);
    try {
      const [configResponse, statusResponse, extrasResponse] = await Promise.all([
        fetch('/api/headroom/config', { signal: controller.signal }),
        fetch('/api/headroom/status', {
          headers: { 'Cache-Control': 'no-store' },
          signal: controller.signal,
        }),
        fetch('/api/headroom/extras', {
          headers: { 'Cache-Control': 'no-store' },
          signal: controller.signal,
        }),
      ]);
      if (!configResponse.ok || !statusResponse.ok) throw new Error('Unable to load Token Saver.');
      if (sequence !== refreshSequence.current) return;
      setConfig(((await configResponse.json()) as { config: TokenSaverConfig }).config);
      if (sequence !== refreshSequence.current) return;
      setStatus((await statusResponse.json()) as HeadroomStatus);
      if (extrasResponse.ok) {
        setExtrasStatus((await extrasResponse.json()) as HeadroomExtrasStatus);
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      toast.error((error as Error).message);
    } finally {
      if (sequence === refreshSequence.current) {
        setLoading(false);
        if (manual) setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => {
      window.clearTimeout(timer);
      refreshController.current?.abort();
    };
  }, []);

  const configForSave = (current: TokenSaverConfig): TokenSaverConfig => ({
    ...current,
    enabled:
      current.rtk ||
      current.headroom.enabled ||
      current.caveman.enabled ||
      current.ponytail.enabled ||
      current.pxpipe.enabled,
  });

  const persist = useCallback(
    async (current: TokenSaverConfig) => {
      persistController.current?.abort();
      const controller = new AbortController();
      persistController.current = controller;
      const sequence = ++persistSequence.current;
      const response = await fetch('/api/headroom/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configForSave(current)),
        signal: controller.signal,
      });
      if (sequence !== persistSequence.current) return;
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Unable to save Token Saver settings.');
      }
    },
    []
  );

  const updateConfig = useCallback(
    (patch: Partial<TokenSaverConfig> | ((prev: TokenSaverConfig) => TokenSaverConfig)) => {
      setConfig((prev) => {
        if (!prev) return prev;
        const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
        void persist(next);
        return next;
      });
    },
    [persist]
  );

  const updateHeadroom = useCallback(
    (patch: Partial<TokenSaverConfig['headroom']>) => {
      updateConfig((prev) => ({ ...prev, headroom: { ...prev.headroom, ...patch } }));
    },
    [updateConfig]
  );

  const lifecycle = async (action: 'start' | 'stop' | 'restart') => {
    if (!config) return;
    setActing(true);
    try {
      await persist(config);
      const response = await fetch(`/api/headroom/${action}`, { method: 'POST' });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Unable to ${action} Headroom.`);
      await refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setActing(false);
    }
  };

  const installHeadroom = async (extras?: string[]) => {
    setInstalling(true);
    setInstallLog('');
    startLogPolling();
    try {
      const response = await fetch('/api/headroom/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extras }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; success?: boolean };
      if (!response.ok || !body.success) throw new Error(body.error ?? 'Installation failed.');
      toast.success('Headroom installed successfully.');
      await refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      stopLogPolling();
      setInstalling(false);
    }
  };

  const installExtra = async (extra: string) => {
    setInstallingExtras((prev) => new Set(prev).add(extra));
    if (logPollRef.current === null) startLogPolling();
    try {
      const response = await fetch('/api/headroom/extras/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extras: [extra] }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; success?: boolean; status?: string };
      if (!response.ok) throw new Error(body.error ?? `Failed to install ${extra}.`);
      // Install is async - poll until extras status changes
      if (body.status === 'installing') {
        await waitForExtraInstalled(extra);
      }
      toast.success(`[${extra}] installed successfully.`);
      await refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setInstallingExtras((prev) => {
        const next = new Set(prev);
        next.delete(extra);
        return next;
      });
      if (installingExtras.size <= 1) stopLogPolling();
    }
  };

  const waitForExtraInstalled = async (extra: string, maxAttempts = 60) => {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetch('/api/headroom/extras', { headers: { 'Cache-Control': 'no-store' } });
        const data = await res.json() as HeadroomExtrasStatus;
        if (data.extras[extra as keyof typeof data.extras]) return true;
      } catch { /* ignore */ }
    }
    return false;
  };

  const uninstallExtra = async (extra: string) => {
    setUninstallingExtra(extra);
    if (logPollRef.current === null) startLogPolling();
    try {
      const response = await fetch(`/api/headroom/extras/uninstall/${extra}`, {
        method: 'POST',
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; success?: boolean; status?: string };
      if (!response.ok) throw new Error(body.error ?? `Failed to uninstall ${extra}.`);
      // Uninstall is async - poll until extras status changes
      if (body.status === 'uninstalling') {
        await waitForExtraUninstalled(extra);
      }
      toast.success(`[${extra}] uninstalled successfully.`);
      await refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setUninstallingExtra(null);
      stopLogPolling();
    }
  };

  const waitForExtraUninstalled = async (extra: string, maxAttempts = 60) => {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetch('/api/headroom/extras', { headers: { 'Cache-Control': 'no-store' } });
        const data = await res.json() as HeadroomExtrasStatus;
        if (!data.extras[extra as keyof typeof data.extras]) return true;
      } catch { /* ignore */ }
    }
    return false;
  };

  const startLogPolling = useCallback(() => {
    if (logPollRef.current) clearInterval(logPollRef.current);
    const tick = async () => {
      try {
        const r = await fetch('/api/headroom/extras?log=1', {
          headers: { 'Cache-Control': 'no-store' },
        });
        const d = await r.json().catch(() => ({}));
        if (typeof d.log === 'string') setInstallLog(d.log);
      } catch {
        /* ignore transient poll errors */
      }
    };
    tick();
    logPollRef.current = setInterval(tick, 1500);
  }, []);

  const stopLogPolling = useCallback(() => {
    if (logPollRef.current) {
      clearInterval(logPollRef.current);
      logPollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopLogPolling(), [stopLogPolling]);

  if (loading || !config) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-64 items-center justify-center gap-2 text-muted-foreground"
      >
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
        <span>Loading Token Saver</span>
      </div>
    );
  }

  const mutating = acting || installing || refreshing;
  const dashboardUrl = getHeadroomDashboardUrl(config.headroom.url);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-6">
      <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <Gauge className="h-4 w-4" /> Request pipeline
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Token Saver</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Choose independent compression stages. Enabled stages run before model routing.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => void refresh(true)}
            aria-label="Refresh status"
            disabled={mutating}
          >
            <RefreshCw className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')} /> Refresh
          </Button>
        </div>
      </header>

      <div role="status" aria-live="polite" className="sr-only">
        {acting ? 'Updating Headroom process' : 'Token Saver ready'}
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        <CardContent className="p-0">
          <SaverRow
            icon={<TerminalSquare className="h-4 w-4" />}
            title="Compress tool output"
            name="RTK"
            description="Reduce git, grep, tree, and log output before it enters context."
            checked={config.rtk}
            disabled={mutating}
            onCheckedChange={(rtk) => updateConfig({ ...config, rtk })}
          />
          <SaverRow
            icon={<BrainCircuit className="h-4 w-4" />}
            title="Compress context"
            name="Headroom"
            description="Compress prompts through Headroom before routing to the model."
            checked={config.headroom.enabled}
            disabled={mutating}
            onCheckedChange={(enabled) => updateHeadroom({ enabled })}
            controls={
              <>
                <Badge variant={status?.healthy ? 'default' : 'secondary'}>
                  <Activity className="mr-1 h-3 w-3" />{' '}
                  {status?.healthy ? 'Healthy' : 'Offline'}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={mutating}
                  onClick={() => setSetupOpen(true)}
                >
                  {status?.running ? 'Manage' : 'Setup'}
                </Button>
              </>
            }
          />
          <SaverRow
            icon={<Hammer className="h-4 w-4" />}
            title="Compress LLM output"
            name="Caveman"
            description="Guide responses toward shorter output while preserving technical strings."
            checked={config.caveman.enabled}
            disabled={mutating}
            onCheckedChange={(enabled) =>
              updateConfig({ ...config, caveman: { ...config.caveman, enabled } })
            }
            controls={
              <LevelControl
                name="Caveman"
                value={config.caveman.level}
                disabled={!config.caveman.enabled || mutating}
                onChange={(level) =>
                  updateConfig({ ...config, caveman: { ...config.caveman, level } })
                }
              />
            }
          />
          <SaverRow
            icon={<Gauge className="h-4 w-4" />}
            title="Lazy senior dev"
            name="Ponytail"
            description="Bias implementation toward YAGNI, native tools, and minimal diffs."
            checked={config.ponytail.enabled}
            disabled={mutating}
            onCheckedChange={(enabled) =>
              updateConfig({ ...config, ponytail: { ...config.ponytail, enabled } })
            }
            controls={
              <LevelControl
                name="Ponytail"
                value={config.ponytail.level}
                disabled={!config.ponytail.enabled || mutating}
                onChange={(level) =>
                  updateConfig({ ...config, ponytail: { ...config.ponytail, level } })
                }
              />
            }
          />
        </CardContent>
      </Card>

      <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {status?.running ? 'Headroom' : 'Setup Headroom'}
            </DialogTitle>
            <DialogDescription>
              Configure compression and manage local Headroom process.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div
              role="status"
              aria-live="polite"
              className="flex items-center justify-between rounded-lg border bg-muted/20 px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium">Proxy status</p>
                <p className="text-xs text-muted-foreground">
                  {status?.managed
                    ? `Managed on port ${status.port}`
                    : config.headroom.mode === 'external'
                      ? 'External endpoint'
                      : status?.installed
                        ? 'Installed'
                        : 'Not installed'}
                </p>
              </div>
              <Badge variant={status?.healthy ? 'default' : 'secondary'}>
                <Activity className="mr-1 h-3 w-3" />{' '}
                {status?.healthy ? 'Healthy' : 'Offline'}
              </Badge>
            </div>

            <div className="space-y-2">
              <Label htmlFor="headroom-url">Headroom URL</Label>
              <Input
                id="headroom-url"
                aria-label="Headroom URL"
                value={config.headroom.url}
                onChange={(event) => updateHeadroom({ url: event.target.value })}
                disabled={mutating}
              />
            </div>

            {!status?.installed && (
              <div className="rounded-lg border bg-muted/20 px-4 py-3">
                <p className="mb-2 text-sm font-medium">Install Headroom</p>
                <p className="mb-3 text-xs text-muted-foreground">
                  Python &gt;= 3.10 is required. Click Install to install Headroom on the backend.
                </p>
                <Button
                  onClick={() => void installHeadroom()}
                  disabled={mutating}
                >
                  {installing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Install Headroom
                </Button>
              </div>
            )}

            {status?.installed && status?.running && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Compression extras {extrasStatus.version ? `· v${extrasStatus.version}` : ''}:
                </p>
                {[
                  {
                    id: 'code',
                    label: 'Code-aware compression',
                    description: 'tree-sitter AST compression for code responses',
                    installed: extrasStatus.extras.code,
                    active: config.headroom.code_aware,
                    toggle: (value: boolean) => updateHeadroom({ code_aware: value }),
                  },
                  {
                    id: 'ml',
                    label: 'Kompress ML',
                    description: 'Kompress-v2 HF model for prose/agentic traces (~+1GB)',
                    installed: extrasStatus.extras.ml,
                    active: config.headroom.kompress,
                    toggle: (value: boolean) => updateHeadroom({ kompress: value }),
                  },
                ].map((extra) => (
                  <div
                    key={extra.id}
                    className="flex items-center justify-between gap-4 rounded-lg border px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium">[{extra.id}]</p>
                      <p className="text-xs text-muted-foreground">{extra.description}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {extra.installed ? (
                        <>
                          <Switch
                            id={extra.id}
                            aria-label={extra.label}
                            checked={extra.active}
                            disabled={mutating}
                            onCheckedChange={extra.toggle}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            disabled={mutating || uninstallingExtra === extra.id}
                            onClick={() => void uninstallExtra(extra.id)}
                          >
                            {uninstallingExtra === extra.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              'Uninstall'
                            )}
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={mutating || installingExtras.has(extra.id)}
                          onClick={() => void installExtra(extra.id)}
                        >
                          {installingExtras.has(extra.id) ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : null}
                          Install
                        </Button>
                      )}
                    </div>
                  </div>
                ))}

                {/* Install log display */}
                {(installingExtras.size > 0 || uninstallingExtra) && installLog && (
                  <pre className="max-h-32 overflow-y-auto overflow-x-hidden rounded bg-muted/20 p-2 text-xs leading-tight text-muted-foreground whitespace-pre-wrap">
                    {installLog}
                  </pre>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t pt-4">
              {config.headroom.mode === 'local' && !status?.running && status?.installed && (
                <Button onClick={() => void lifecycle('start')} disabled={mutating}>
                  <Play className="mr-2 h-4 w-4" /> Start
                </Button>
              )}
              {status?.managed && (
                <Button
                  variant="outline"
                  onClick={() => void lifecycle('stop')}
                  disabled={mutating}
                >
                  <Square className="mr-2 h-4 w-4" /> Stop
                </Button>
              )}
              {status?.managed && (
                <Button
                  variant="outline"
                  onClick={() => void lifecycle('restart')}
                  disabled={mutating}
                >
                  <RefreshCw className="mr-2 h-4 w-4" /> Restart
                </Button>
              )}
              {dashboardUrl ? (
                <Button asChild variant="secondary" className="sm:ml-auto" disabled={!status?.running}>
                  <a href={dashboardUrl} target="_blank" rel="noreferrer" onClick={(e) => { if (!status?.running) e.preventDefault(); }}>
                    Open Headroom dashboard <ExternalLink className="ml-2 h-4 w-4" />
                  </a>
                </Button>
              ) : (
                <p role="alert" className="text-sm text-destructive sm:ml-auto">
                  Enter a valid HTTP or HTTPS Headroom URL.
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

