import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, Network, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface RelayEntry {
  id: string;
  name: string;
  platform: 'vercel' | 'cloudflare' | 'deno' | 'netlify';
  url: string;
  createdAt: string;
  testStatus?: 'ok' | 'fail' | 'untested';
  lastTestedAt?: string;
  lastError?: string | null;
}

interface RelayConfig {
  relays: RelayEntry[];
  activeId: string | null;
}

const PLATFORM_HINTS: Record<RelayEntry['platform'], string> = {
  vercel: 'Streaming-capable. Recommended for inference.',
  cloudflare: 'Streaming-capable. Recommended for inference.',
  deno: 'Streaming-capable. Requires an organization domain.',
  netlify: 'Buffered responses — not suitable for streaming/inference.',
};

const PLATFORM_LABELS: Record<RelayEntry['platform'], string> = {
  vercel: 'Vercel',
  cloudflare: 'Cloudflare',
  deno: 'Deno Deploy',
  netlify: 'Netlify',
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/relay${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function formatTestedAt(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

export function RelayPage() {
  const [config, setConfig] = useState<RelayConfig>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [platform, setPlatform] = useState<RelayEntry['platform']>('cloudflare');
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [accountId, setAccountId] = useState('');
  const [orgDomain, setOrgDomain] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setConfig(await request<RelayConfig>(''));
      setLoadError(null);
    } catch (error) {
      const message = (error as Error).message;
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const retry = () => {
    setLoading(true);
    void reload();
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  };

  const deploy = async () => {
    setDeploying(true);
    try {
      await request('/deploy', {
        method: 'POST',
        body: JSON.stringify({ platform, name, token, accountId, orgDomain }),
      });
      setToken('');
      setName('');
      setDialogOpen(false);
      toast.success('Relay deployed');
      await reload();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setDeploying(false);
    }
  };

  const testRelay = async (id: string) => {
    setBusyId(id);
    try {
      const result = await request<{
        ok: boolean;
        status: number;
        error?: string;
        elapsedMs: number;
      }>(`/${id}/test`, { method: 'POST' });
      if (result.ok) {
        toast.success(`Relay OK (${result.elapsedMs}ms)`);
      } else {
        toast.error(`Relay failed: ${result.error ?? `status ${result.status}`}`);
      }
      await reload();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const activate = async (id: string) => {
    setBusyId(id);
    try {
      await request(`/${id}/activate`, { method: 'POST' });
      toast.success('Relay activated — proxy config regenerated');
      await reload();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await request(`/${id}`, { method: 'DELETE' });
      toast.success('Relay removed');
      await reload();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-64 items-center justify-center gap-2 text-muted-foreground"
      >
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
        <span>Loading Relay</span>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-4 p-4 md:p-6">
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-8 text-center"
        >
          <p className="text-sm font-medium text-destructive">Unable to load relays</p>
          <p className="mt-1 text-xs text-muted-foreground">{loadError ?? 'The request failed.'}</p>
        </div>
        <div className="flex justify-center">
          <Button variant="outline" onClick={retry}>
            <RefreshCw className="mr-2 h-4 w-4" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  const busy = busyId !== null;
  const deployDisabled =
    deploying ||
    !token.trim() ||
    (platform === 'cloudflare' && !accountId.trim()) ||
    (platform === 'deno' && !orgDomain.trim());

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-6">
      <Card>
        <CardHeader>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <Network className="h-4 w-4" /> Edge egress
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Relay</h1>
          <CardDescription className="max-w-2xl text-sm">
            <span className="block">
              A relay deploys a small proxy worker on an edge platform. Provider requests are
              proxied through it, so outbound egress leaves from the worker's IP instead of yours —
              hiding your own IP address.
            </span>
            <span className="mt-1 block">
              Deleting the active relay turns relaying off and regenerates the proxy config; there
              is no separate deactivate.
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => void refresh()}
            disabled={busy || deploying || refreshing}
            aria-label="Refresh relays"
          >
            <RefreshCw className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')} /> Refresh
          </Button>
          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) setToken('');
            }}
          >
            <DialogTrigger asChild>
              <Button disabled={busy}>
                <Plus className="mr-2 h-4 w-4" /> Deploy relay
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Deploy relay</DialogTitle>
                <DialogDescription>
                  Deploy a proxy worker to an edge platform. The token is forwarded for deployment
                  only and is never stored.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  The deployed worker has no authentication — anyone with the relay URL can
                  forward requests through it. The relay platform can see request headers
                  (including auth tokens) and URL query strings. Only route traffic you would
                  trust that platform with.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="relay-platform">Platform</Label>
                  <Select
                    value={platform}
                    onValueChange={(value) => setPlatform(value as RelayEntry['platform'])}
                  >
                    <SelectTrigger
                      id="relay-platform"
                      aria-describedby="relay-platform-hint"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(PLATFORM_LABELS) as RelayEntry['platform'][]).map((value) => (
                        <SelectItem key={value} value={value}>
                          {PLATFORM_LABELS[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p id="relay-platform-hint" className="text-xs text-muted-foreground">
                    {PLATFORM_HINTS[platform]}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="relay-name">Name (optional)</Label>
                  <Input
                    id="relay-name"
                    placeholder="lowercase letters, numbers, hyphens"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    disabled={deploying}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="relay-token">API token (required)</Label>
                  <Input
                    id="relay-token"
                    type="password"
                    autoComplete="new-password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    disabled={deploying}
                  />
                </div>
                {platform === 'cloudflare' && (
                  <div className="space-y-2">
                    <Label htmlFor="relay-account-id">Account ID (required)</Label>
                    <Input
                      id="relay-account-id"
                      value={accountId}
                      onChange={(event) => setAccountId(event.target.value)}
                      disabled={deploying}
                    />
                  </div>
                )}
                {platform === 'deno' && (
                  <div className="space-y-2">
                    <Label htmlFor="relay-org-domain">Organization domain (required)</Label>
                    <Input
                      id="relay-org-domain"
                      value={orgDomain}
                      onChange={(event) => setOrgDomain(event.target.value)}
                      disabled={deploying}
                    />
                  </div>
                )}
                <Button
                  className="w-full"
                  onClick={() => void deploy()}
                  disabled={deployDisabled}
                >
                  {deploying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {deploying ? 'Deploying…' : 'Deploy'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      <div role="status" aria-live="polite" className="sr-only">
        {busy || deploying ? 'Working on relay action…' : 'Relay page ready'}
      </div>

      {config.relays.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-10 text-center">
          <p className="text-sm font-medium">No relays deployed yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Deploy an edge worker to start relaying provider traffic.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {config.relays.map((relay) => {
            const isActive = relay.id === config.activeId;
            const testedAt = formatTestedAt(relay.lastTestedAt);
            const statusVariant =
              relay.testStatus === 'ok'
                ? 'default'
                : relay.testStatus === 'fail'
                  ? 'destructive'
                  : 'secondary';
            const statusLabel =
              relay.testStatus === 'ok'
                ? 'OK'
                : relay.testStatus === 'fail'
                  ? 'Failed'
                  : 'Untested';
            return (
              <Card key={relay.id} className="gap-4">
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold">{relay.name}</h2>
                    <Badge variant="outline">{PLATFORM_LABELS[relay.platform]}</Badge>
                    {isActive && <Badge>Active</Badge>}
                    <Badge variant={statusVariant} className="ml-auto">
                      {statusLabel}
                    </Badge>
                  </div>
                  {/^https?:\/\//.test(relay.url) ? (
                    <a
                      href={relay.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block break-all text-sm text-primary underline-offset-4 hover:underline"
                    >
                      {relay.url} <ExternalLink className="inline h-3 w-3" />
                    </a>
                  ) : (
                    <span className="block break-all text-sm text-muted-foreground">
                      {relay.url}
                    </span>
                  )}
                  {relay.testStatus === 'fail' && relay.lastError && (
                    <p className="text-xs text-destructive">{relay.lastError}</p>
                  )}
                  {testedAt && (
                    <p className="text-xs text-muted-foreground">Last tested {testedAt}</p>
                  )}
                  {relay.platform === 'netlify' && (
                    <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      {PLATFORM_HINTS.netlify}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void testRelay(relay.id)}
                    >
                      {busyId === relay.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Test
                    </Button>
                    {!isActive && (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => void activate(relay.id)}
                      >
                        Activate
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      size="sm"
                      className="sm:ml-auto"
                      disabled={busy}
                      onClick={() => void remove(relay.id)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default RelayPage;
