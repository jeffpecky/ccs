/**
 * Relay deploy clients for Vercel, Cloudflare, Deno Deploy, and Netlify.
 *
 * Each client uploads the matching relay worker source from `./worker-sources`
 * through the platform's REST API and resolves with `{ url, name }` — the
 * public relay URL and the deployed project/site name. Persisting the result
 * (proxy-pool entries) is the caller's job; these clients only talk HTTP.
 *
 * Errors: platform HTTP failures throw `DeployError(message, upstreamStatus)`
 * so routes can surface the upstream status; network errors and poll timeouts
 * propagate as plain `Error`s for the route to map to 500s.
 *
 * Poll HTTP status: the Vercel and Netlify poll loops do not inspect HTTP
 * status (nor guard `res.json()`), matching upstream — a token that expires
 * mid-poll surfaces as a timeout error rather than an auth error; every flow
 * proves its token on its first API call before polling begins. Known debt:
 * no AbortSignal is threaded into the poll loops, so they are not
 * cancellable and a route-level timeout cannot stop an in-flight poll.
 */

import { CLOUDFLARE_RELAY_WORKER, DENO_RELAY_WORKER, VERCEL_RELAY_WORKER } from './worker-sources';
import {
  NETLIFY_API,
  NETLIFY_FUNCTION_NAME,
  buildIndexFile,
  buildRelayFunctionZip,
  buildRelayUrl,
  netlifyHeaders,
  pollDeployReady,
} from './netlify-zip';

export interface DeployInput {
  token: string;
  name?: string;
  accountId?: string;
  orgDomain?: string;
}

export interface DeployResult {
  url: string;
  name: string;
}

export class DeployError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'DeployError';
  }
}

function defaultName(): string {
  return `relay-${Date.now().toString(36)}`;
}

const VERCEL_API = 'https://api.vercel.com';
const DENO_V2_API = 'https://api.deno.com/v2';
const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

// ─── Vercel ────────────────────────────────────────────────────────────

interface VercelDeployment {
  id?: string;
  uid?: string;
  projectId?: string;
}

interface VercelDeploymentState {
  /** Known states: 'READY' | 'ERROR' | 'CANCELED' (upstream also uses QUEUED/BUILDING). */
  readyState?: 'READY' | 'ERROR' | 'CANCELED';
  url?: string;
}

interface VercelErrorBody {
  error?: { message?: string };
}

async function pollVercelDeployment(
  deploymentId: string,
  token: string,
  maxMs = 120000
): Promise<VercelDeploymentState> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const res = await fetch(`${VERCEL_API}/v13/deployments/${deploymentId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as VercelDeploymentState;
    if (data.readyState === 'READY') return data;
    if (data.readyState === 'ERROR' || data.readyState === 'CANCELED') {
      throw new Error(`Deployment failed: ${data.readyState}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('Deployment timed out');
}

export async function deployVercel(input: DeployInput): Promise<DeployResult> {
  const token = input.token.trim();
  const name = input.name?.trim() || defaultName();

  if (!token) {
    throw new DeployError('Vercel API token is required', 400);
  }

  const deployRes = await fetch(`${VERCEL_API}/v13/deployments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      files: [
        {
          file: 'api/relay.js',
          data: VERCEL_RELAY_WORKER,
        },
        {
          file: 'package.json',
          data: JSON.stringify({ name, version: '1.0.0' }),
        },
        {
          file: 'vercel.json',
          data: JSON.stringify({
            rewrites: [{ source: '/(.*)', destination: '/api/relay' }],
          }),
        },
      ],
      projectSettings: {
        framework: null,
      },
      target: 'production',
    }),
  });

  if (!deployRes.ok) {
    const err = (await deployRes.json().catch(() => ({}))) as VercelErrorBody;
    throw new DeployError(
      err.error?.message || 'Failed to create Vercel deployment',
      deployRes.status
    );
  }

  const deployment = (await deployRes.json()) as VercelDeployment;
  const deploymentId = deployment.id || deployment.uid || '';

  // Disable deployment protection (Vercel Authentication) — best-effort: the
  // deployment already exists, so a failed PATCH must not fail the deploy.
  const projectId = deployment.projectId || name;
  await fetch(`${VERCEL_API}/v9/projects/${projectId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ssoProtection: null }),
  }).catch(() => undefined);

  const ready = await pollVercelDeployment(deploymentId, token);
  return { url: `https://${ready.url}`, name };
}

// ─── Cloudflare ────────────────────────────────────────────────────────

interface CloudflareErrorBody {
  errors?: Array<{ message?: string }>;
}

interface CloudflareSubdomainBody {
  result?: { subdomain?: string | null };
}

export async function deployCloudflare(input: DeployInput): Promise<DeployResult> {
  const accountId = input.accountId?.trim();
  const token = input.token.trim();
  const name = input.name?.trim() || defaultName();

  if (!accountId || !token) {
    throw new DeployError('Cloudflare Account ID and API Token are required', 400);
  }

  // 1. Upload Worker Script (Cloudflare requires multipart/form-data).
  const workerScriptUrl = `${CLOUDFLARE_API}/accounts/${accountId}/workers/scripts/${name}`;
  const formData = new FormData();
  formData.append(
    'index.js',
    new Blob([CLOUDFLARE_RELAY_WORKER], { type: 'application/javascript+module' }),
    'index.js'
  );
  formData.append(
    'metadata',
    new Blob(
      [
        JSON.stringify({
          main_module: 'index.js',
          compatibility_date: '2024-03-20',
          observability: { enabled: true },
        }),
      ],
      { type: 'application/json' }
    ),
    'metadata.json'
  );

  const uploadRes = await fetch(workerScriptUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!uploadRes.ok) {
    const err = (await uploadRes.json().catch(() => ({}))) as CloudflareErrorBody;
    throw new DeployError(
      err.errors?.[0]?.message || 'Failed to upload Worker to Cloudflare',
      uploadRes.status
    );
  }

  // 2. Enable the workers.dev subdomain for the script — best-effort; the
  // script is already uploaded, so a failure here doesn't abort the deploy.
  const enableSubdomainRes = await fetch(`${workerScriptUrl}/subdomain`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ enabled: true }),
  });
  if (!enableSubdomainRes.ok) {
    // tolerated: continue to the subdomain lookup below
  }

  // 3. Read the account workers.dev subdomain to build the final URL.
  const subdomainRes = await fetch(`${CLOUDFLARE_API}/accounts/${accountId}/workers/subdomain`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  let deployUrl = '';
  if (subdomainRes.ok) {
    const subdomainData = (await subdomainRes.json()) as CloudflareSubdomainBody;
    if (subdomainData.result && subdomainData.result.subdomain) {
      deployUrl = `https://${name}.${subdomainData.result.subdomain}.workers.dev`;
    }
  }

  if (!deployUrl) {
    throw new DeployError(
      'Worker deployed but failed to retrieve workers.dev subdomain. Make sure you have setup a workers.dev subdomain in Cloudflare Dashboard.',
      400
    );
  }

  return { url: deployUrl, name };
}

// ─── Deno Deploy ───────────────────────────────────────────────────────

interface DenoApp {
  id: string;
}

interface DenoRevision {
  id: string;
  status: string;
}

interface DenoRevisionStatus {
  status: string;
}

async function deleteDenoAppBestEffort(appId: string, token: string): Promise<void> {
  await fetch(`${DENO_V2_API}/apps/${appId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => undefined);
}

async function pollDenoRevision(revision: DenoRevision, token: string): Promise<string> {
  let status = revision.status;
  let attempts = 0;
  const maxAttempts = 30; // 30 * 2s = 60s max
  while (status === 'queued' || status === 'building') {
    if (attempts >= maxAttempts) {
      throw new Error('Deploy timed out after 60 seconds');
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const statusRes = await fetch(`${DENO_V2_API}/revisions/${revision.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!statusRes.ok) break;
    const statusData = (await statusRes.json()) as DenoRevisionStatus;
    status = statusData.status;
    attempts++;
  }
  return status;
}

export async function deployDeno(input: DeployInput): Promise<DeployResult> {
  const token = input.token.trim();
  const orgDomain = input.orgDomain?.trim();
  const name = input.name?.trim() || defaultName();

  if (!orgDomain) {
    throw new DeployError('Organization domain is required', 400);
  }
  if (!token) {
    throw new DeployError('Deno Deploy API token is required', 400);
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const createAppRes = await fetch(`${DENO_V2_API}/apps`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      slug: name,
      labels: { 'custom.kind': 'ccs-relay' },
      config: {
        install: 'deno install',
        runtime: {
          type: 'dynamic',
          entrypoint: 'main.ts',
        },
      },
    }),
  });

  if (!createAppRes.ok) {
    const text = await createAppRes.text().catch(() => '');
    if (createAppRes.status === 409) {
      throw new DeployError(`App "${name}" already exists. Choose a different name.`, 409);
    }
    throw new DeployError(
      `Failed to create app (${createAppRes.status}): ${text}`,
      createAppRes.status
    );
  }

  const app = (await createAppRes.json()) as DenoApp;

  const deployRes = await fetch(`${DENO_V2_API}/apps/${app.id}/deploy`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      assets: {
        'main.ts': {
          kind: 'file',
          content: DENO_RELAY_WORKER,
          encoding: 'utf-8',
        },
      },
    }),
  });

  if (!deployRes.ok) {
    const text = await deployRes.text().catch(() => '');
    await deleteDenoAppBestEffort(app.id, token);
    throw new DeployError(`Deploy failed (${deployRes.status}): ${text}`, deployRes.status);
  }

  const revision = (await deployRes.json()) as DenoRevision;

  // Any poll exit other than `succeeded` — throw included — cleans up the app
  // exactly once before propagating (closes upstream's orphan-on-timeout gap).
  let status: string;
  try {
    status = await pollDenoRevision(revision, token);
  } catch (error) {
    await deleteDenoAppBestEffort(app.id, token);
    throw error;
  }
  if (status !== 'succeeded') {
    await deleteDenoAppBestEffort(app.id, token);
    throw new DeployError(`Deploy failed with status: ${status}`, 500);
  }

  const orgSlug = orgDomain.split('.')[0];
  return { url: `https://${name}.${orgSlug}.deno.net`, name };
}

// ─── Netlify ───────────────────────────────────────────────────────────

interface NetlifySite {
  id?: string;
  site_id?: string;
  ssl_url?: string;
  url?: string;
}

interface NetlifyDeploy {
  id?: string;
  required?: string[];
  required_functions?: string[];
}

interface NetlifyErrorBody {
  message?: string;
  error?: string;
}

function sanitizeSiteName(raw: string | undefined): string {
  const name = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!name) return defaultName();
  // Netlify site names become subdomains: lowercase alphanumerics + hyphens.
  const cleaned = name
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || defaultName();
}

async function readError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as NetlifyErrorBody;
  return data.message || data.error || fallback;
}

export async function deployNetlify(input: DeployInput): Promise<DeployResult> {
  const token = input.token.trim();
  const siteName = sanitizeSiteName(input.name);

  if (!token) {
    throw new DeployError('Netlify API token is required', 400);
  }

  const headers = {
    ...netlifyHeaders(token),
    'Content-Type': 'application/json',
  };

  // 1. Create site (name → <name>.netlify.app; random if taken → 422).
  const siteRes = await fetch(`${NETLIFY_API}/sites`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: siteName }),
  });

  if (!siteRes.ok) {
    const message = await readError(siteRes, 'Failed to create Netlify site');
    const status = siteRes.status === 422 ? 409 : siteRes.status;
    const hint =
      siteRes.status === 422 ? ` Site name "${siteName}" is taken — choose a different name.` : '';
    throw new DeployError(`${message}.${hint}`, status);
  }

  const site = (await siteRes.json()) as NetlifySite;
  const siteId = site.id || site.site_id;
  const siteUrl = site.ssl_url || site.url;
  if (!siteId || !siteUrl) {
    throw new DeployError('Netlify site created but no site URL returned', 502);
  }

  // 2. Digest deploy: index.html (SHA1) + relay function bundle (SHA256).
  const { zip, sha256 } = buildRelayFunctionZip();
  const { content: indexContent, sha1 } = buildIndexFile();

  const deployRes = await fetch(`${NETLIFY_API}/sites/${siteId}/deploys`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      files: { '/index.html': sha1 },
      functions: { [NETLIFY_FUNCTION_NAME]: sha256 },
    }),
  });

  if (!deployRes.ok) {
    throw new DeployError(
      await readError(deployRes, 'Failed to create Netlify deploy'),
      deployRes.status
    );
  }

  const deploy = (await deployRes.json()) as NetlifyDeploy;
  const deployId = deploy.id;
  if (!deployId) {
    throw new DeployError('Netlify deploy created but no deploy ID returned', 502);
  }

  // 3. Upload only what Netlify asks for (dedupe via `required` lists).
  const requiredFiles = new Set(deploy.required || []);
  const requiredFunctions = new Set(deploy.required_functions || []);

  if (requiredFiles.has(sha1)) {
    const fileRes = await fetch(`${NETLIFY_API}/deploys/${deployId}/files/index.html`, {
      method: 'PUT',
      headers: { ...netlifyHeaders(token), 'Content-Type': 'application/octet-stream' },
      body: Buffer.from(indexContent),
    });
    if (!fileRes.ok) {
      throw new DeployError(
        await readError(fileRes, 'Failed to upload site file to Netlify'),
        fileRes.status
      );
    }
  }

  if (requiredFunctions.has(sha256)) {
    const fnRes = await fetch(
      `${NETLIFY_API}/deploys/${deployId}/functions/${NETLIFY_FUNCTION_NAME}?runtime=js`,
      {
        method: 'PUT',
        headers: { ...netlifyHeaders(token), 'Content-Type': 'application/octet-stream' },
        body: zip,
      }
    );
    if (!fnRes.ok) {
      throw new DeployError(
        await readError(fnRes, 'Failed to upload relay function to Netlify'),
        fnRes.status
      );
    }
  }

  // 4. Poll until the deploy is live.
  await pollDeployReady(deployId, token);
  return { url: buildRelayUrl(siteUrl), name: siteName };
}
