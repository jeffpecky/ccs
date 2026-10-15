import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ExternalLink, Loader2, Network, Plus, RefreshCw, Shuffle, Trash2 } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
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

type RelayStrategy = 'none' | 'round-robin' | 'random';

const RELAY_STRATEGIES: readonly RelayStrategy[] = ['none', 'round-robin', 'random'];

const RELAY_STRATEGY_HINTS: Record<RelayStrategy, string> = {
  none: 'Only the active relay is used — the legacy single-relay behavior.',
  'round-robin':
    'Every healthy relay is used, starting at the next one for each request (failover tail follows).',
  random: 'Every healthy relay is used, starting at a random one for each request.',
};

interface RelayConfig {
  relays: RelayEntry[];
  activeId: string | null;
  strategy?: RelayStrategy;
  strict?: boolean;
  providerRelayIds?: Record<string, string>;
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

const TOKEN_LINK_CLASS = 'text-primary underline-offset-4 hover:underline';

interface PlatformGuide {
  infoTitle: string;
  infoDescription: string;
  infoBullets: string[];
  tokenSteps?: string[];
  tokenLabel: string;
  tokenPlaceholder: string;
  tokenHint: ReactNode;
  accountIdPlaceholder?: string;
  accountIdHint?: string;
  orgDomainPlaceholder?: string;
  orgDomainHint?: string;
  namePlaceholder: string;
  nameHint: string;
}

// Deploy-dialog guidance, adapted from 9Router's per-platform proxy-pool modals.
const PLATFORM_GUIDE: Record<RelayEntry['platform'], PlatformGuide> = {
  vercel: {
    infoTitle: 'What is Vercel Relay?',
    infoDescription:
      "Deploys an edge relay function to Vercel. All AI provider requests will be forwarded through Vercel's edge network, masking your real IP from providers.",
    infoBullets: [
      "Your IP is replaced by Vercel's dynamic edge IPs (hundreds of IPs across 20+ global regions)",
      "Vercel serves millions of apps — providers can't block Vercel IPs without affecting legitimate traffic",
      'Free tier: 100GB bandwidth/month, 500K edge invocations',
      'Deploy multiple relays on different accounts for more IP diversity',
    ],
    tokenLabel: 'Vercel API token',
    tokenPlaceholder: 'your-vercel-api-token',
    tokenHint: (
      <>
        Token is used once for deployment and not stored.{' '}
        <a
          href="https://vercel.com/account/tokens"
          target="_blank"
          rel="noreferrer"
          className={TOKEN_LINK_CLASS}
        >
          Get token →
        </a>
      </>
    ),
    namePlaceholder: 'my-relay',
    nameHint: 'Unique name for your Vercel project. Leave empty for auto-generated name.',
  },
  cloudflare: {
    infoTitle: 'What is Cloudflare Relay?',
    infoDescription:
      "Deploys a Cloudflare Worker as a proxy relay. All AI provider requests will be forwarded through Cloudflare's global edge network.",
    infoBullets: [
      'High performance global routing and IP masking via Cloudflare Workers',
      'Free tier: 100,000 requests per day',
      'Requires Cloudflare Account ID and a Workers API Token (Edit Workers permission)',
    ],
    tokenSteps: [
      'Go to My Profile → API Tokens → Create Token',
      'Scroll down to Custom Token and click Get started',
      'Under Permissions: Account | Workers Scripts | Edit',
      'Under Account Resources: Include | Account | Your Account Name',
      'Click Continue to summary → Create Token',
    ],
    tokenLabel: 'Cloudflare API token',
    tokenPlaceholder: 'your-cloudflare-api-token',
    tokenHint: (
      <>
        Requires "Workers Scripts: Edit" permission.{' '}
        <a
          href="https://dash.cloudflare.com/profile/api-tokens"
          target="_blank"
          rel="noreferrer"
          className={TOKEN_LINK_CLASS}
        >
          Get token →
        </a>
      </>
    ),
    accountIdPlaceholder: 'your-cloudflare-account-id',
    accountIdHint: 'Found on the right side of the Cloudflare dashboard overview page.',
    namePlaceholder: 'my-relay',
    nameHint: 'Unique name for your Cloudflare Worker. Leave empty for auto-generated name.',
  },
  deno: {
    infoTitle: 'What is Deno Relay?',
    infoDescription:
      "Deploys a relay worker to Deno Deploy's global edge network. All AI provider requests are forwarded through Deno's edge, masking your real IP.",
    infoBullets: [
      'Deno Deploy v2 runs on a high-performance global edge network',
      'Free tier: 1M requests & 100GiB outbound traffic per month',
      'No per-request CPU time limits (unlike Vercel/Cloudflare)',
      'Support up to 20 active apps & 50 custom domains',
      'Deploy multiple relays for maximum IP diversity',
    ],
    tokenSteps: [
      'Go to console.deno.com',
      'Select your Organization → Settings → Organization Tokens',
      'Create an Organization Token (prefix ddo_)',
    ],
    tokenLabel: 'Deno Deploy API token',
    tokenPlaceholder: 'ddo_xxxxxxxxxxxxxxxx',
    tokenHint: 'Token is used once for deployment, not stored. Found in Organization Settings.',
    orgDomainPlaceholder: 'your-org.deno.net',
    orgDomainHint:
      "Organization's default domain. Your relay URL will be in the format: https://my-relay.your-org.deno.net",
    namePlaceholder: 'my-relay',
    nameHint: 'Unique name for your Deno Deploy app. Leave empty for auto-generated name.',
  },
  netlify: {
    infoTitle: 'What is Netlify Relay?',
    infoDescription:
      "Deploys a serverless relay function to Netlify's global edge network. All AI provider requests are forwarded through Netlify's edge, masking your real IP.",
    infoBullets: [
      'Runs on Netlify Functions with a 60-second execution limit (buffered responses — not suitable for streaming/inference)',
      'Free tier: 125,000 function invocations and 100GB bandwidth per month',
      'Relay URL format: https://your-site.netlify.app/.netlify/functions/relay',
      'Deploy multiple relays on different accounts for more IP diversity',
    ],
    tokenSteps: [
      'Go to User Settings → Applications → Personal access tokens',
      'Select New access token and generate a token',
      "Copy the token — you won't see it again after leaving the page",
    ],
    tokenLabel: 'Netlify API token',
    tokenPlaceholder: 'nfp_xxxxxxxxxxxxxxxx',
    tokenHint: (
      <>
        Token is used once for deployment and not stored.{' '}
        <a
          href="https://app.netlify.com/user/applications#personal-access-tokens"
          target="_blank"
          rel="noreferrer"
          className={TOKEN_LINK_CLASS}
        >
          Get token →
        </a>
      </>
    ),
    namePlaceholder: 'netlify-relay',
    nameHint:
      'Unique site name (lowercase letters, numbers, hyphens). Your relay URL will be https://site-name.netlify.app/.netlify/functions/relay',
  },
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
  const [strategyDraft, setStrategyDraft] = useState<RelayStrategy>('none');
  const [strictDraft, setStrictDraft] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [testingAll, setTestingAll] = useState(false);

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

  // Keep the rotation form in sync with whatever the server returned; a fresh
  // load must discard an unsaved draft rather than replay it on next save.
  useEffect(() => {
    if (!config) return;
    setStrategyDraft(
      config.strategy && RELAY_STRATEGIES.includes(config.strategy) ? config.strategy : 'none'
    );
    setStrictDraft(config.strict ?? false);
  }, [config]);

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
      const result = await request<{
        relay: RelayEntry;
        activated: boolean;
        activationError?: string;
      }>('/deploy', {
        method: 'POST',
        body: JSON.stringify({ platform, name, token, accountId, orgDomain }),
      });
      setToken('');
      setName('');
      setDialogOpen(false);
      if (result.activated) {
        toast.success('Relay deployed and activated');
      } else {
        toast.warning(
          `Relay deployed, but activation failed: ${result.activationError ?? 'unknown error'}`
        );
      }
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

  const saveRotation = async () => {
    setSettingsSaving(true);
    try {
      await request<{ config: RelayConfig }>('', {
        method: 'PATCH',
        body: JSON.stringify({ strategy: strategyDraft, strict: strictDraft }),
      });
      toast.success('Rotation settings saved');
      await reload();
    } catch (error) {
      toast.error((error as Error).message);
      // The save failed: resync the draft so the form cannot drift from the
      // config the proxy actually runs with.
      await reload();
    } finally {
      setSettingsSaving(false);
    }
  };

  const testAll = async () => {
    setTestingAll(true);
    try {
      const result = await request<{
        results: Array<{ id: string; ok: boolean; error?: string; status: number }>;
        healthChanged?: boolean;
      }>('/test-all', { method: 'POST' });
      const healthy = result.results.filter((entry) => entry.ok).length;
      if (healthy === result.results.length) {
        toast.success(`All ${result.results.length} relays healthy`);
      } else {
        toast.warning(
          `${result.results.length - healthy} of ${result.results.length} relays failed their probe`
        );
      }
      await reload();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setTestingAll(false);
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
  const guide = PLATFORM_GUIDE[platform];
  const deployDisabled =
    deploying ||
    !token.trim() ||
    (platform === 'cloudflare' && !accountId.trim()) ||
    (platform === 'deno' && !orgDomain.trim());
  const activeRelay = config.activeId
    ? config.relays.find((relay) => relay.id === config.activeId)
    : undefined;
  const healthyRelays = config.relays.filter((relay) => relay.testStatus !== 'fail');
  // Mirrors resolveRelayCandidates: 'none' pins to the active relay whether or
  // not it was probed, rotation pools admit every relay not known-failed.
  const poolSize = strategyDraft === 'none' ? (activeRelay ? 1 : 0) : healthyRelays.length;
  const failClosed = strictDraft && poolSize === 0;

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
              Deploying a relay makes it the preferred relay — provider traffic routes through it
              right away. Deleting a relay drops it from the rotation pool and regenerates the proxy
              config.
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
            <DialogContent className="max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Deploy relay</DialogTitle>
                <DialogDescription>
                  Deploy a proxy worker to an edge platform. The relay is activated as soon as the
                  deploy finishes. The token is forwarded for deployment only and is never stored.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  The deployed worker has no authentication — anyone with the relay URL can forward
                  requests through it. The relay platform can see request headers (including auth
                  tokens) and URL query strings. Only route traffic you would trust that platform
                  with.
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
                <div className="space-y-2 rounded-md border bg-muted/40 p-3">
                  <p className="text-sm font-medium">{guide.infoTitle}</p>
                  <p className="text-xs text-muted-foreground">{guide.infoDescription}</p>
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                    {guide.infoBullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                  {guide.tokenSteps && (
                    <div className="mt-2 space-y-1 border-t pt-2">
                      <p className="text-xs font-medium">How to generate your API token:</p>
                      <ol className="list-decimal space-y-0.5 pl-4 text-xs text-muted-foreground">
                        {guide.tokenSteps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="relay-name">Name (optional)</Label>
                  <Input
                    id="relay-name"
                    placeholder={guide.namePlaceholder}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    disabled={deploying}
                  />
                  <p className="text-xs text-muted-foreground">{guide.nameHint}</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="relay-token">{guide.tokenLabel} (required)</Label>
                  <Input
                    id="relay-token"
                    type="password"
                    autoComplete="new-password"
                    placeholder={guide.tokenPlaceholder}
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    disabled={deploying}
                  />
                  <p className="text-xs text-muted-foreground">{guide.tokenHint}</p>
                </div>
                {platform === 'cloudflare' && (
                  <div className="space-y-2">
                    <Label htmlFor="relay-account-id">Account ID (required)</Label>
                    <Input
                      id="relay-account-id"
                      placeholder={guide.accountIdPlaceholder}
                      value={accountId}
                      onChange={(event) => setAccountId(event.target.value)}
                      disabled={deploying}
                    />
                    <p className="text-xs text-muted-foreground">{guide.accountIdHint}</p>
                  </div>
                )}
                {platform === 'deno' && (
                  <div className="space-y-2">
                    <Label htmlFor="relay-org-domain">Organization domain (required)</Label>
                    <Input
                      id="relay-org-domain"
                      placeholder={guide.orgDomainPlaceholder}
                      value={orgDomain}
                      onChange={(event) => setOrgDomain(event.target.value)}
                      disabled={deploying}
                    />
                    <p className="text-xs text-muted-foreground">{guide.orgDomainHint}</p>
                  </div>
                )}
                <Button className="w-full" onClick={() => void deploy()} disabled={deployDisabled}>
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

      <Card>
        <CardHeader>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <Shuffle className="h-4 w-4" /> Rotation
          </div>
          <h2 className="text-xl font-semibold tracking-tight">Rotation &amp; health</h2>
          <CardDescription className="max-w-2xl text-sm">
            A rotation strategy cycles outbound traffic across every healthy relay instead of
            pinning to one. Relays that fail a probe drop out of the pool until they pass again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="relay-strategy">Strategy</Label>
              <Select
                value={strategyDraft}
                onValueChange={(value) => setStrategyDraft(value as RelayStrategy)}
              >
                <SelectTrigger
                  id="relay-strategy"
                  aria-describedby="relay-strategy-hint"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None — active relay only</SelectItem>
                  <SelectItem value="round-robin">Round robin — rotate per request</SelectItem>
                  <SelectItem value="random">Random — pick per request</SelectItem>
                </SelectContent>
              </Select>
              <p id="relay-strategy-hint" className="text-xs text-muted-foreground">
                {RELAY_STRATEGY_HINTS[strategyDraft]}
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
              <div className="space-y-0.5">
                <Label htmlFor="relay-strict">Strict (fail closed)</Label>
                <p className="text-xs text-muted-foreground">
                  Error instead of quietly egressing from this machine when no relay is usable.
                </p>
              </div>
              <Switch
                id="relay-strict"
                checked={strictDraft}
                onCheckedChange={setStrictDraft}
                disabled={settingsSaving}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              Pool: {poolSize} relay{poolSize === 1 ? '' : 's'} ({healthyRelays.length} of{' '}
              {config.relays.length} healthy)
            </span>
            {Object.keys(config.providerRelayIds ?? {}).length > 0 && (
              <span>
                {Object.keys(config.providerRelayIds ?? {}).length} provider pin
                {Object.keys(config.providerRelayIds ?? {}).length === 1 ? '' : 's'} (config only)
              </span>
            )}
          </div>

          {failClosed && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              Strict is on but no relay would be used — outbound requests will fail until a relay is
              deployed or passes its probe.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void saveRotation()}
              disabled={settingsSaving || busy || deploying}
            >
              {settingsSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {settingsSaving ? 'Saving…' : 'Save rotation'}
            </Button>
            <Button
              variant="outline"
              onClick={() => void testAll()}
              disabled={testingAll || busy || deploying || config.relays.length === 0}
            >
              {testingAll ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Test all relays
            </Button>
          </div>
        </CardContent>
      </Card>

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
