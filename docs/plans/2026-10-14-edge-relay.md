# Edge Relay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port 9Router's edge relay to CCS + CLIProxyAPIPlus: deploy open-forwarder workers to Vercel/Cloudflare/Deno/Netlify from the CCS dashboard, and route outbound traffic (proxy inference + CCS's own calls) through the active relay behind one global toggle.

**Architecture:** CCS owns everything dashboard-side (worker sources, deploy clients, storage in unified config, `/api/relay/*` routes, UI, a `relayFetch` wrapper for CCS egress) and writes `relay-url` into the generated CLIProxyAPIPlus `config.yaml` on activation. CLIProxyAPIPlus gains a `relay-url` config field and a `proxyutil.WrapRelay` RoundTripper applied at its four client factories. Protocol is 9Router's 2-header spec (`x-relay-target` + `x-relay-path`) — relays are interchangeable with 9Router-deployed ones.

**Tech Stack:** TypeScript/Bun (Express routes, unified config, React/Vite UI), Go (CLIProxyAPIPlus), platform REST APIs (Vercel deployments, Cloudflare workers multipart, Deno Deploy v2 apps, Netlify digest deploys).

**Design doc:** `docs/plans/2026-10-14-edge-relay-design.md` (commit `891391c8`).

---

## Context facts the implementer must know

- **Two repos:** CCS at `C:\Users\sysadmin\Documents\test\ccs`; CLIProxyAPIPlus at `C:\Users\sysadmin\Documents\test\CLIProxyAPIPlus` (separate git repo — commit there separately).
- **Reference implementation (source of truth for the port):** `C:\Users\sysadmin\Documents\test\9router`. Worker sources are embedded strings in its deploy routes; Netlify helpers in `src/lib/network/netlifyRelay.js`. Verify each file still exists before copying (`grep` for the constant names below).
- **Tests:** `bun test ./<path>` (the `./` prefix is required). New CCS tests go under `tests/unit/relay/`, `tests/unit/web-server/`, `tests/unit/config/`, `src/cliproxy/config/__tests__/`.
- **Repo files are CRLF.** Bun/node one-liners that split on `\n` and compare exact lines will fail against CRLF — prefer the edit tool or PowerShell `Select-String`.
- **Never touch the running stack** (bar PID 15236, server PID 19360, CLIProxy PID 304). No task here regenerates the live proxy config or swaps the live binary. Live verification is a manual, user-opted step noted at the end.
- **Commits:** conventional style (`feat:`, `test:`, `docs:`), one per task, CCS repo unless the task says CLIProxyAPIPlus.
- `src/` has zero existing `relay` identifiers — no collisions (verified).

---

## Part A — CCS

### Task 1: Relay config schema (6-file wiring checklist)

The unified config has a **whitelist** pipeline: a new top-level section must be wired in all of these or it is silently dropped. Model on `thinking` (`src/config/schemas/thinking.ts`).

**Files:**
- Create: `src/config/schemas/relay.ts`
- Modify: `src/config/schemas/index.ts` (re-export, near thinking at L57–59)
- Modify: `src/config/schemas/unified-config.ts` (interface field near `dashboard_auth`, L76–77; optional entry in `createEmptyUnifiedConfig` near L131–132)
- Modify: `src/config/loader/defaults-merger.ts` (merge branch; thinking precedent L302–315, `browser` last at L326)
- Modify: `src/config/loader/yaml-serializer.ts` (dump block; thinking precedent L218–239)
- Modify: `src/config/loader/config-getters.ts` (getter; `getThinkingConfig` precedent L90–114) — also re-export from `src/config/unified-config-loader.ts` getters block (L92–102) and `src/config/config-loader-facade.ts` (L23–43)
- Test: `tests/unit/config/relay-config.test.ts`

**Step 1: Write the failing test**

```ts
// tests/unit/config/relay-config.test.ts
import { describe, expect, it } from 'bun:test';
import { DEFAULT_RELAY_CONFIG, isRelayConfig, type RelayConfig } from '../../../src/config/schemas/relay';
import { getRelayConfig } from '../../../src/config/loader/config-getters';
import { loadOrCreateUnifiedConfig } from '../../../src/config/unified-config-loader';
import { generateYamlWithComments } from '../../../src/config/loader/yaml-serializer';

describe('relay config schema', () => {
  it('provides defaults and a type guard', () => {
    expect(DEFAULT_RELAY_CONFIG).toEqual({ relays: [], activeId: null });
    expect(isRelayConfig({ relays: [], activeId: null })).toBe(true);
    expect(isRelayConfig({ relays: [] })).toBe(false);
    expect(isRelayConfig('nope')).toBe(false);
  });

  it('getRelayConfig falls back to defaults when section absent', () => {
    const config = loadOrCreateUnifiedConfig();
    delete (config as Record<string, unknown>).relay;
    expect(getRelayConfig()).toEqual(DEFAULT_RELAY_CONFIG);
  });

  it('round-trips a relay entry through yaml serialization', () => {
    const config = loadOrCreateUnifiedConfig();
    const relay: RelayConfig = {
      relays: [{ id: 'r1', name: 'my-relay', platform: 'cloudflare', url:https://my.workers.dev', createdAt: '2026-10-14T00:00:00.000Z', testStatus: 'untested' }],
      activeId: 'r1',
    };
    (config as Record<string, unknown>).relay = relay;
    const yaml = generateYamlWithComments(config);
    expect(yaml).toContain('relay');
    expect(yaml).toContain('https://my.workers.dev');
    expect(yaml).toContain('r1');
  });
});
```

**Step 2: Run to verify it fails**

Run: `bun test ./tests/unit/config/relay-config.test.ts`
Expected: FAIL — module `src/config/schemas/relay` not found.

**Step 3: Implement**

```ts
// src/config/schemas/relay.ts
export type RelayPlatform = 'vercel' | 'cloudflare' | 'deno' | 'netlify';

export interface RelayEntry {
  id: string;
  name: string;
  platform: RelayPlatform;
  url: string;
  createdAt: string;
  testStatus?: 'ok' | 'fail' | 'untested';
  lastTestedAt?: string;
  lastError?: string | null;
}

export interface RelayConfig {
  relays: RelayEntry[];
  activeId: string | null;
}

export const DEFAULT_RELAY_CONFIG: RelayConfig = { relays: [], activeId: null };

export function isRelayConfig(value: unknown): value is RelayConfig {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<RelayConfig>;
  return Array.isArray(candidate.relays)
    && (candidate.activeId === null || typeof candidate.activeId === 'string');
}
```

Then wire the five other files following the `thinking` precedent exactly:
- `schemas/index.ts`: `export { DEFAULT_RELAY_CONFIG, isRelayConfig } from './relay'; export type { RelayConfig, RelayEntry, RelayPlatform } from './relay';`
- `unified-config.ts`: add `relay?: RelayConfig;` to `UnifiedConfig` and `(config as Record<string, unknown>).relay = undefined;`-style optional entry (or simply omit from `createEmptyUnifiedConfig` — optional sections like `browser` include a default; include `relay: undefined` the same way `browser` is handled).
- `defaults-merger.ts`: add merge branch:
  ```ts
  if (partial.relay !== undefined && isRelayConfig(partial.relay)) {
    merged.relay = {
      relays: partial.relay.relays,
      activeId: partial.relay.activeId ?? null,
    };
  }
  ```
- `yaml-serializer.ts`: add block (whitelist — skipping this silently drops the section on save):
  ```ts
  if (config.relay) {
    yaml += '\n# Edge relay (deployed workers) and the active relay for outbound traffic.\n';
    yaml += yaml.dump({ relay: { relays: config.relay.relays, activeId: config.relay.activeId } });
    yaml += '\n';
  }
  ```
- `config-getters.ts`: `getRelayConfig(): RelayConfig` reading `loadOrCreateUnifiedConfig().relay ?? DEFAULT_RELAY_CONFIG`; re-export from `unified-config-loader.ts` and `config-loader-facade.ts` getter exports.

**Step 4: Run test to verify it passes**

Run: `bun test ./tests/unit/config/relay-config.test.ts`
Expected: PASS (3 tests). Also run `bun test ./tests/unit/unified-config.test.ts` — no regressions.

**Step 5: Commit**

```bash
git add src/config/schemas/relay.ts src/config/schemas/index.ts src/config/schemas/unified-config.ts src/config/loader/defaults-merger.ts src/config/loader/yaml-serializer.ts src/config/loader/config-getters.ts src/config/unified-config-loader.ts src/config/config-loader-facade.ts tests/unit/config/relay-config.test.ts
git commit -m "feat: relay config schema + unified-config wiring"
```

---

### Task 2: Worker sources module

Verbatim port of the four embedded worker sources, with two deliberate deviations: (1) the Vercel worker gains the try/catch→502 the 9Router original lacks (uniform behavior per design), (2) no product branding from 9Router.

**Files:**
- Create: `src/relay/worker-sources.ts`
- Test: `tests/unit/relay/worker-sources.test.ts`

**Step 1: Write the failing test (protocol tests — real handlers, stubbed upstream)**

Worker modules are ESM strings; import them via temp files (deterministic in Bun; `data:` URLs also work but temp files are safest on Windows).

```ts
// tests/unit/relay/worker-sources.test.ts
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CLOUDFLARE_RELAY_WORKER, DENO_RELAY_WORKER, NETLIFY_RELAY_FUNCTION, VERCEL_RELAY_WORKER,
} from '../../../src/relay/worker-sources';

let fetchSpy: ReturnType<typeof spyOn>;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'relay-worker-'));
  fetchSpy = spyOn(globalThis, 'fetch');
});
afterEach(() => { fetchSpy.mockRestore(); });

async function importEsm(source: string, file: string) {
  const path = join(dir, file);
  writeFileSync(path, source, 'utf8');
  return import(pathToFileURL(path).href);
}

function upstream(overrides: Partial<ResponseInit> = {}) {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'content-type': 'application/json' }, ...overrides,
  });
}

const request = (headers: Record<string, string>, method = 'GET') =>
  new Request('https://relay.example.com/anything', { method, headers });

describe('vercel relay worker', () => {
  it('400s without x-relay-target', async () => {
    const mod = await importEsm(VERCEL_RELAY_WORKER, 'vercel.mjs');
    const res = await mod.default(request({}));
    expect(res.status).toBe(400);
  });

  it('composes target+path, strips relay headers, passes response through', async () => {
    const mod = await importEsm(VERCEL_RELAY_WORKER, 'vercel.mjs');
    fetchSpy.mockImplementation(async () => upstream());
    const res = await mod.default(request({
      'x-relay-target': 'https://api.anthropic.com/',
      'x-relay-path': '/v1/messages?beta=true',
      authorization: 'Bearer abc',
    }));
    expect(res.status).toBe(200);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages?beta=true');
    expect(init.headers['x-relay-target']).toBeUndefined();
    expect(init.headers['x-relay-path']).toBeUndefined();
    expect(init.headers['host']).toBeUndefined();
    expect(init.headers.authorization).toBe('Bearer abc');
  });

  it('returns 502 when upstream throws', async () => {
    const mod = await importEsm(VERCEL_RELAY_WORKER, 'vercel.mjs');
    fetchSpy.mockImplementation(async () => { throw new Error('boom'); });
    const res = await mod.default(request({ 'x-relay-target': 'https://api.anthropic.com' }));
    expect(res.status).toBe(502);
  });
});

describe('cloudflare relay worker', () => {
  it('forwards POST bodies and returns 400/502 correctly', async () => {
    const mod = await importEsm(CLOUDFLARE_RELAY_WORKER, 'cf.mjs');
    fetchSpy.mockImplementation(async () => upstream());
    const body = JSON.stringify({ hello: 'world' });
    const res = await mod.default.fetch(request({
      'x-relay-target': 'https://api.openai.com', 'x-relay-path': '/v1/chat/completions',
    }, 'POST').clone() as unknown as Request & { body: ReadableStream }, {}, {});
    // Cloudflare handler receives a Request; replace with a body-capable one:
    const req = new Request('https://relay.example.com', {
      method: 'POST',
      headers: { 'x-relay-target': 'https://api.openai.com', 'x-relay-path': '/v1/chat/completions' },
      body,
    });
    const res2 = await mod.default.fetch(req, {}, {});
    expect(res2.status).toBe(200);
    const [, init] = fetchSpy.mock.calls.at(-1)!;
    expect(init.headers.get?.('x-relay-target') ?? init.headers['x-relay-target']).toBeFalsy();
    void res;
  });

  it('400s without target', async () => {
    const mod = await importEsm(CLOUDFLARE_RELAY_WORKER, 'cf.mjs');
    const res = await mod.default.fetch(request({}), {}, {});
    expect(res.status).toBe(400);
  });
});

describe('deno relay worker', () => {
  it('captures the Deno.serve handler and relays', async () => {
    const captured: Array<(req: Request) => Promise<Response>> = [];
    (globalThis as Record<string, unknown>).Deno = { serve: (fn: never) => captured.push(fn) };
    try {
      await importEsm(DENO_RELAY_WORKER, 'deno.mjs');
    } finally {
      delete (globalThis as Record<string, unknown>).Deno;
    }
    expect(captured.length).toBe(1);
    fetchSpy.mockImplementation(async () => upstream());
    const res = await captured[0](request({ 'x-relay-target': 'https://generativelanguage.googleapis.com' }));
    expect(res.status).toBe(200);
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://generativelanguage.googleapis.com/');
  });
});

describe('netlify relay function', () => {
  const load = () => {
    // eslint-disable-next-line no-new-func
    const exportsRecord: Record<string, unknown> = {};
    new Function('exports', NETLIFY_RELAY_FUNCTION)(exportsRecord);
    return exportsRecord.handler as (event: unknown) => Promise<{ statusCode: number; body: string; isBase64Encoded?: boolean }>;
  };

  it('400s without target, buffers text responses, handles base64 bodies', async () => {
    const handler = load();
    expect((await handler({ headers: {} })).statusCode).toBe(400);
    fetchSpy.mockImplementation(async () => upstream());
    const res = await handler({
      headers: { 'X-Relay-Target': 'https://api.anthropic.com', 'X-Relay-Path': '/v1/messages', Host: 'relay.example.com' },
      httpMethod: 'POST',
      body: '{"x":1}',
      isBase64Encoded: false,
    });
    expect(res.statusCode).toBe(200);
    expect(res.isBase64Encoded).toBeFalsy();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-relay-target']).toBeUndefined();
    expect(init.headers['X-Relay-Target']).toBeUndefined();
    expect(init.headers['host']).toBeUndefined();
  });
});
```

Note: the CF test's first constructed request is discarded boilerplate — implementer should simplify to only the `req`/`res2` version.

**Step 2: Run to verify it fails**

Run: `bun test ./tests/unit/relay/worker-sources.test.ts`
Expected: FAIL — `src/relay/worker-sources` not found.

**Step 3: Implement — copy verbatim from 9Router, with the two deviations**

Copy each constant from these exact sources (verify by grep before copying):
- `VERCEL_RELAY_WORKER` ← `9router/src/app/api/proxy-pools/vercel-deploy/route.js` L8–41 (`RELAY_FUNCTION_CODE`). **Deviation:** wrap the `fetch` + response construction in `try { ... } catch (error) { return 502 JSON }` like the Cloudflare worker does. Keep `export const config = { runtime: "edge" };` and the default-export handler. Preserve the escaped `\\/` in the regex exactly as in the source template literal.
- `CLOUDFLARE_RELAY_WORKER` ← `9router/.../cloudflare-deploy/route.js` L5–47 (`RELAY_WORKER_CODE`). Verbatim.
- `DENO_RELAY_WORKER` ← `9router/.../deno-deploy/route.js` L6–45. Verbatim.
- `NETLIFY_RELAY_FUNCTION` ← `9router/src/lib/network/netlifyRelay.js` L29–93. Verbatim except the title text if it mentions 9Router (this constant contains no branding — check; `NETLIFY_INDEX_HTML` L94–97 does — brand it "CCS Relay").

```ts
// src/relay/worker-sources.ts
// Edge relay worker sources, ported from 9Router (MIT-compatible protocol:
// x-relay-target + x-relay-path). These strings are uploaded verbatim to the
// platform APIs by src/relay/deploy.ts.
export const VERCEL_RELAY_WORKER = `...`;
export const CLOUDFLARE_RELAY_WORKER = `...`;
export const DENO_RELAY_WORKER = `...`;
export const NETLIFY_RELAY_FUNCTION = `...`;
export const NETLIFY_INDEX_HTML = `...`; // "CCS Relay" branding
```

**Step 4: Run test to verify it passes**

Run: `bun test ./tests/unit/relay/worker-sources.test.ts`
Expected: PASS. If the CF body-forwarding test fights the `duplex: 'half'` stream in Bun's Request, use `new Request(url, { method, headers, body })` without duplex — the worker forwards `request.body` which Bun provides for string bodies.

**Step 5: Commit**

```bash
git add src/relay/worker-sources.ts tests/unit/relay/worker-sources.test.ts
git commit -m "feat: relay worker sources (vercel/cloudflare/deno/netlify) + protocol tests"
```

---

### Task 3: Netlify stored-zip builder

**Files:**
- Create: `src/relay/netlify-zip.ts`
- Test: `tests/unit/relay/netlify-zip.test.ts`

**Step 1: Write the failing test (known CRC32/sha vectors)**

```ts
// tests/unit/relay/netlify-zip.test.ts
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { buildRelayFunctionZip, buildStoredZip, crc32, NETLIFY_FUNCTION_NAME } from '../../../src/relay/netlify-zip';

describe('netlify zip builder', () => {
  it('crc32 matches the standard check vector', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });

  it('builds a valid stored zip with local + central headers', () => {
    const zip = buildStoredZip([{ name: 'relay.js', data: 'exports.handler = 1;' }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50); // local file header signature
    expect(zip.readUInt16LE(8)).toBe(0);          // method: stored
    // End-of-central-directory is the final 22 bytes for a single entry.
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  });

  it('relay function zip hashes to its sha256 and contains the function file', () => {
    const { zip, sha256 } = buildRelayFunctionZip();
    expect(sha256).toBe(createHash('sha256').update(zip).digest('hex'));
    expect(zip.includes(Buffer.from(`${NETLIFY_FUNCTION_NAME}.js`))).toBe(true);
  });
});
```

**Step 2: Run to verify it fails**

Run: `bun test ./tests/unit/relay/netlify-zip.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement — port from `9router/src/lib/network/netlifyRelay.js`**

Copy `CRC_TABLE`/`crc32` (L109–125), `buildStoredZip` (L127–173), `sha1Hex`/`sha256Hex` (L98–104 via `node:crypto`), `buildRelayFunctionZip` (L176–180), `buildIndexFile` (L182–185), `buildRelayUrl` (L187–189), `netlifyHeaders` (L191–196 — User-Agent `'CCS'` not `'9Router'`), `pollDeployReady` (L198–212), constants `NETLIFY_API`, `NETLIFY_FUNCTION_NAME`, `NETLIFY_FUNCTION_PATH` (L18–20). Use the `NETLIFY_RELAY_FUNCTION`/`NETLIFY_INDEX_HTML` constants from `worker-sources.ts` (import them — do not duplicate). TS: `Buffer` everywhere; keep the DataView little-endian writes identical.

**Step 4: Run test to verify it passes**

Run: `bun test ./tests/unit/relay/netlify-zip.test.ts` — PASS.

**Step 5: Commit**

```bash
git add src/relay/netlify-zip.ts tests/unit/relay/netlify-zip.test.ts
git commit -m "feat: netlify stored-zip + digest deploy helpers for relay"
```

---

### Task 4: Deploy clients

**Files:**
- Create: `src/relay/deploy.ts`
- Test: `tests/unit/relay/deploy.test.ts`

**Step 1: Write the failing tests (mocked HTTP — endpoints, auth, payload, error mapping)**

Use `tests/mocks/mock-fetch.ts` (`mockFetch(handlers)` / `restoreFetch()`).

```ts
// tests/unit/relay/deploy.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mockFetch, restoreFetch } from '../../mocks/mock-fetch';
import { DeployError, deployCloudflare, deployDeno, deployNetlify, deployVercel } from '../../../src/relay/deploy';

beforeEach(() => { mockFetch([]); });
afterEach(() => { restoreFetch(); });

describe('deployVercel', () => {
  it('creates deployment, disables protection, polls to READY', async () => {
    mockFetch([
      { url: 'https://api.vercel.com/v13/deployments', method: 'POST', response: { status: 200, body: { id: 'dpl_1', projectId: 'prj_1' } } },
      { url: 'https://api.vercel.com/v9/projects/prj_1', method: 'PATCH', response: { status: 200, body: {} } },
      { url: 'https://api.vercel.com/v13/deployments/dpl_1', method: 'GET', response: { status: 200, body: { readyState: 'READY', url: 'relay-abc.vercel.app' } } },
    ]);
    const result = await deployVercel({ token: 'vt', name: 'relay-abc' });
    expect(result).toEqual({ url: 'https://relay-abc.vercel.app', name: 'relay-abc' });
  });

  it('maps upstream error message to DeployError with status', async () => {
    mockFetch([
      { url: 'https://api.vercel.com/v13/deployments', method: 'POST', response: { status: 403, body: { error: { message: 'Token revoked' } } } },
    ]);
    await expect(deployVercel({ token: 'bad' })).rejects.toThrow(new DeployError('Token revoked', 403));
  });

  it('requires a token', async () => {
    await expect(deployVercel({ token: '' })).rejects.toThrow(/token/i);
  });
});

describe('deployCloudflare', () => {
  it('uploads script multipart, enables subdomain, builds workers.dev URL', async () => {
    mockFetch([
      { url: 'https://api.cloudflare.com/client/v4/accounts/acc1/workers/scripts/myrelay', method: 'PUT', response: { status: 200, body: {} } },
      { url: 'https://api.cloudflare.com/client/v4/accounts/acc1/workers/scripts/myrelay/subdomain', method: 'POST', response: { status: 200, body: {} } },
      { url: 'https://api.cloudflare.com/client/v4/accounts/acc1/workers/subdomain', method: 'GET', response: { status: 200, body: { result: { subdomain: 'user.workers' } } } },
    ]);
    const result = await deployCloudflare({ token: 'cf-token', accountId: 'acc1', name: 'myrelay' });
    expect(result.url).toBe('https://myrelay.user.workers.dev');
  });

  it('requires account id', async () => {
    await expect(deployCloudflare({ token: 't', accountId: '' })).rejects.toThrow(/account/i);
  });
});

describe('deployDeno', () => {
  it('creates app, deploys, polls revision, builds deno.dev URL; 409 on name conflict', async () => {
    mockFetch([
      { url: 'https://api.deno.com/v2/apps', method: 'POST', response: { status: 200, body: { id: 'app_1' } } },
      { url: 'https://api.deno.com/v2/apps/app_1/deploy', method: 'POST', response: { status: 200, body: { id: 'rev_1', status: 'succeeded' } } },
    ]);
    const result = await deployDeno({ token: 'dt', orgDomain: 'myorg.deno.dev', name: 'myrelay' });
    expect(result.url).toBe('https://myrelay.myorg.deno.net');

    mockFetch([
      { url: 'https://api.deno.com/v2/apps', method: 'POST', response: { status: 409, body: {} } },
    ]);
    await expect(deployDeno({ token: 'dt', orgDomain: 'myorg.deno.dev', name: 'taken' })).rejects.toThrow(/already exists/);
  });

  it('requires org domain and token', async () => {
    await expect(deployDeno({ token: '', orgDomain: 'x.deno.dev' })).rejects.toThrow(/token/i);
    await expect(deployDeno({ token: 't', orgDomain: '' })).rejects.toThrow(/domain/i);
  });
});

describe('deployNetlify', () => {
  it('creates site, digest-deploys required files, builds functions URL', async () => {
    mockFetch([
      { url: 'https://api.netlify.com/api/v1/sites', method: 'POST', response: { status: 200, body: { id: 'site_1', ssl_url: 'https://myrelay.netlify.app' } } },
      { url: 'https://api.netlify.com/api/v1/sites/site_1/deploys', method: 'POST', response: { status: 201, body: { id: 'dp_1', required: ['aabb'], required_functions: ['ccdd'] } } },
      { url: 'https://api.netlify.com/api/v1/deploys/dp_1/files/index.html', method: 'PUT', response: { status: 200, body: {} } },
      { url: 'https://api.netlify.com/api/v1/deploys/dp_1/functions/relay?runtime=js', method: 'PUT', response: { status: 200, body: {} } },
      { url: 'https://api.netlify.com/api/v1/deploys/dp_1', method: 'GET', response: { status: 200, body: { state: 'ready' } } },
    ]);
    const result = await deployNetlify({ token: 'nt', name: 'My Relay!' });
    expect(result.url).toBe('https://myrelay.netlify.app/.netlify/functions/relay');
  });

  it('maps name-taken (422) to 409', async () => {
    mockFetch([
      { url: 'https://api.netlify.com/api/v1/sites', method: 'POST', response: { status: 422, body: { message: 'Name is taken' } } },
    ]);
    await expect(deployNetlify({ token: 'nt', name: 'taken' })).rejects.toThrow(new DeployError(expect.stringContaining('taken') as unknown as string, 409));
  });
});
```

(If `mock-fetch.ts` handler shape differs — open it first and adapt the fixtures; it supports `mockFetch(handlers)` + `restoreFetch()` via `spyOn(globalThis, 'fetch')`.)

**Step 2: Run to verify it fails**

Run: `bun test ./tests/unit/relay/deploy.test.ts` — FAIL, module not found.

**Step 3: Implement**

```ts
// src/relay/deploy.ts
import { buildRelayFunctionZip, buildIndexFile, buildRelayUrl, NETLIFY_API, NETLIFY_FUNCTION_NAME, netlifyHeaders, pollDeployReady } from './netlify-zip';
import { CLOUDFLARE_RELAY_WORKER, DENO_RELAY_WORKER, VERCEL_RELAY_WORKER } from './worker-sources';

export interface DeployInput { token: string; name?: string; accountId?: string; orgDomain?: string }
export interface DeployResult { url: string; name: string }
export class DeployError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'DeployError'; }
}

const defaultName = () => `relay-${Date.now().toString(36)}`;

export async function deployVercel(input: DeployInput): Promise<DeployResult> { /* port vercel-deploy/route.js L43–126:
  pollDeployment helper; POST /v13/deployments with files api/relay.js=VERCEL_RELAY_WORKER,
  package.json, vercel.json rewrites; projectSettings {framework:null}; target production;
  PATCH /v9/projects/{id} {ssoProtection:null}; poll → https://{ready.url}.
  Non-ok → throw DeployError(err.error?.message ?? fallback, status); missing token → DeployError(400). */ }

export async function deployCloudflare(input: DeployInput): Promise<DeployResult> { /* port cloudflare-deploy/route.js L61–128:
  PUT workers/scripts/{name} with FormData (index.js Blob module + metadata blob),
  POST .../subdomain {enabled:true} (tolerate failure), GET workers/subdomain →
  https://{name}.{sub}.workers.dev; missing subdomain → DeployError(400, explicit message). */ }

export async function deployDeno(input: DeployInput): Promise<DeployResult> { /* port deno-deploy/route.js L62–158:
  POST /v2/apps {slug, labels:{'custom.kind':'ccs-relay'}, config:{install:'deno install', runtime:{type:'dynamic', entrypoint:'main.ts'}}};
  409 → DeployError('App "..." already exists...', 409); POST apps/{id}/deploy assets main.ts;
  DELETE app on deploy/poll failure; poll revisions 2s×30; url https://{name}.{orgSlug}.deno.net. */ }

export async function deployNetlify(input: DeployInput): Promise<DeployResult> { /* port netlify-deploy/route.js L13–129:
  sanitizeSiteName (lowercase, [^a-z0-9-]→-, collapse hyphens, fallback defaultName);
  POST /sites; 422 → DeployError(message + name-taken hint, 409);
  digest deploy: files {'/index.html': sha1}, functions {relay: sha256};
  PUT only what required/required_functions lists ask for (index.html octet-stream,
  functions/relay?runtime=js octet-stream zip body); pollDeployReady; buildRelayUrl. */ }
```

Port each flow functionally 1:1 (endpoints, headers, poll intervals, cleanup DELETEs, error message mapping). All fetches use global `fetch` (mockable). Replace `createProxyPool` persistence with returning `{url, name}` — storage is the route's job.

**Step 4: Run test to verify it passes**

Run: `bun test ./tests/unit/relay/deploy.test.ts` — PASS.

**Step 5: Commit**

```bash
git add src/relay/deploy.ts tests/unit/relay/deploy.test.ts
git commit -m "feat: relay deploy clients for vercel/cloudflare/deno/netlify"
```

---

### Task 5: Relay service (storage + test probe) and API routes

**Files:**
- Create: `src/relay/relay-service.ts`
- Create: `src/web-server/routes/relay-routes.ts`
- Modify: `src/web-server/routes/index.ts` (import near L44; mount `apiRoutes.use('/relay', relayRoutes);` just before the miscRoutes catch-all at L157)
- Test: `tests/unit/web-server/relay-routes.test.ts`

**Step 1: Write the failing route tests (express + fakes on port 0 — model exactly on `tests/unit/web-server/headroom-routes.test.ts` L48–91)**

```ts
// tests/unit/web-server/relay-routes.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createRelayRouter, type RelayRouterDeps } from '../../../src/web-server/routes/relay-routes';
import { DEFAULT_RELAY_CONFIG } from '../../../src/config/schemas/relay';

let server: ReturnType<ReturnType<typeof express>['listen']>;
let base: string;
let deps: RelayRouterDeps;
let saved: unknown[];
let regenerated: number;

beforeEach(async () => {
  saved = []; regenerated = 0;
  deps = {
    enforceAccess: () => true,
    getRelayConfig: () => structuredClone(DEFAULT_RELAY_CONFIG),
    saveRelayConfig: (next) => { saved.push(next); },
    regenerateConfig: () => { regenerated += 1; },
    deployRelay: async () => ({ url: 'https://r.example.com', name: 'r' }),
    testRelay: async () => ({ ok: true, status: 200, elapsedMs: 5 }),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/relay', createRelayRouter(deps));
  await new Promise<void>((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/relay`;
});
afterEach(async () => { await new Promise((resolve) => server.close(resolve)); });

describe('relay routes', () => {
  it('GET / lists relays + activeId', async () => {
    const res = await fetch(base);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ relays: [], activeId: null });
  });

  it('POST /deploy validates platform + credentials, persists relay WITHOUT token', async () => {
    const bad = await fetch(`${base}/deploy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: 'nope', token: 't' }) });
    expect(bad.status).toBe(400);
    const noToken = await fetch(`${base}/deploy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: 'vercel', token: '' }) });
    expect(noToken.status).toBe(400);
    const ok = await fetch(`${base}/deploy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: 'vercel', token: 'SECRET', name: 'myrelay' }) });
    expect(ok.status).toBe(201);
    const { relay } = await ok.json() as { relay: Record<string, unknown> };
    expect(relay.url).toBe('https://r.example.com');
    expect(relay.platform).toBe('vercel');
    expect(relay.testStatus).toBe('untested');
    expect(JSON.stringify(saved)).not.toContain('SECRET');
  });

  it('POST /:id/test updates status fields via saveRelayConfig', async () => {
    deps.getRelayConfig = () => ({ relays: [{ id: 'r1', name: 'n', platform: 'vercel', url: 'https://u', createdAt: 'x' }], activeId: null });
    deps.testRelay = async () => ({ ok: false, status: 502, error: 'upstream boom', elapsedMs: 9 });
    const res = await fetch(`${base}/r1/test`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(false);
    const last = saved.at(-1) as { relays: Array<{ testStatus: string; lastError: string }> };
    expect(last.relays[0].testStatus).toBe('fail');
    expect(last.relays[0].lastError).toContain('upstream boom');
  });

  it('404s test/activate/delete for unknown id', async () => {
    for (const path of ['nope/test', 'nope/activate']) {
      const res = await fetch(`${base}/${path}`, { method: 'POST' });
      expect(res.status).toBe(404);
    }
    const del = await fetch(`${base}/nope`, { method: 'DELETE' });
    expect(del.status).toBe(404);
  });

  it('activate sets activeId, saves BEFORE regenerating; failure reverts', async () => {
    deps.getRelayConfig = () => ({ relays: [{ id: 'r1', name: 'n', platform: 'vercel', url: 'https://u', createdAt: 'x' }], activeId: null });
    const res = await fetch(`${base}/r1/activate`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(regenerated).toBe(1);
    const last = saved.at(-1) as { activeId: string };
    expect(last.activeId).toBe('r1');

    deps.regenerateConfig = () => { throw new Error('disk full'); };
    saved = [];
    const fail = await fetch(`${base}/r1/activate`, { method: 'POST' });
    expect(fail.status).toBe(500);
    // Reverted to previous config as the final save:
    const reverted = saved.at(-1) as { activeId: string | null };
    expect(reverted.activeId).toBeNull();
  });

  it('DELETE of active relay clears activeId and regenerates', async () => {
    deps.getRelayConfig = () => ({ relays: [{ id: 'r1', name: 'n', platform: 'vercel', url: 'https://u', createdAt: 'x' }], activeId: 'r1' });
    const res = await fetch(`${base}/r1`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(regenerated).toBe(1);
    const last = saved.at(-1) as { relays: unknown[]; activeId: string | null };
    expect(last.relays).toEqual([]);
    expect(last.activeId).toBeNull();
  });

  it('rejects deploy for cloudflare without accountId and deno without orgDomain', async () => {
    const cf = await fetch(`${base}/deploy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: 'cloudflare', token: 't' }) });
    expect(cf.status).toBe(400);
    const deno = await fetch(`${base}/deploy`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: 'deno', token: 't' }) });
    expect(deno.status).toBe(400);
  });
});
```

**Step 2: Run to verify it fails**

Run: `bun test ./tests/unit/web-server/relay-routes.test.ts` — FAIL, module not found.

**Step 3: Implement service + router**

```ts
// src/relay/relay-service.ts
import { randomUUID } from 'node:crypto';
import { getCachedConfig, mutateConfig } from '../config/config-loader-facade';
import { DEFAULT_RELAY_CONFIG, type RelayConfig, type RelayEntry, type RelayPlatform } from '../config/schemas/relay';

export function getRelayConfig(): RelayConfig {
  return getCachedConfig().relay ?? DEFAULT_RELAY_CONFIG;
}

export function saveRelayConfig(next: RelayConfig): void {
  mutateConfig((config) => { config.relay = next; });
}

/** URL of the active relay, or null. Used by the config generator + relayFetch. */
export function getActiveRelayUrl(): string | null {
  const { relays, activeId } = getRelayConfig();
  if (!activeId) return null;
  return relays.find((relay) => relay.id === activeId)?.url ?? null;
}

export function createRelayEntry(platform: RelayPlatform, name: string, url: string): RelayEntry {
  return { id: randomUUID(), name, platform, url, createdAt: new Date().toISOString(), testStatus: 'untested' };
}

/** 9Router-style probe: forward to httpbin through the relay, 10s deadline. */
export async function testRelay(url: string, timeoutMs = 10000): Promise<{ ok: boolean; status: number; error?: string; elapsedMs: number }> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'x-relay-target': 'https://httpbin.org', 'x-relay-path': '/get' },
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    const message = (error as Error).name === 'AbortError' ? 'Relay test timed out' : (error as Error).message;
    return { ok: false, status: 500, error: message, elapsedMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}
```

```ts
// src/web-server/routes/relay-routes.ts
import { Router, type Request, type Response } from 'express';
import { requireLocalAccessWhenAuthDisabled } from '../middleware/auth-middleware';
import { resolveLifecyclePort } from '../../cliproxy/config/port-manager';
import { regenerateConfigWithRollback } from '../../cliproxy/config/generator';
import {
  createRelayEntry, getRelayConfig, saveRelayConfig, testRelay,
} from '../../relay/relay-service';
import { deployCloudflare, deployDeno, deployNetlify, deployVercel, DeployError, type DeployInput } from '../../relay/deploy';
import type { RelayConfig, RelayPlatform } from '../../config/schemas/relay';

const PLATFORMS: Record<RelayPlatform, (input: DeployInput) => Promise<{ url: string; name: string }>> = {
  vercel: deployVercel, cloudflare: deployCloudflare, deno: deployDeno, netlify: deployNetlify,
};

// Serialize config-file regenerations (same pattern as headroom-routes.ts).
let configQueue: Promise<unknown> = Promise.resolve();
function serializeConfigTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const run = configQueue.then(fn, fn);
  configQueue = run.catch(() => undefined);
  return run;
}

export interface RelayRouterDeps {
  enforceAccess(req: Request, res: Response): boolean;
  getRelayConfig(): RelayConfig;
  saveRelayConfig(next: RelayConfig): void | Promise<void>;
  regenerateConfig(): void | Promise<void>;
  deployRelay(input: DeployInput & { platform: RelayPlatform }): Promise<{ url: string; name: string }>;
  testRelay(url: string): Promise<{ ok: boolean; status: number; error?: string; elapsedMs: number }>;
}

const defaultDeps: RelayRouterDeps = {
  enforceAccess: (req, res) => requireLocalAccessWhenAuthDisabled(
    req, res, 'Relay controls require localhost access when dashboard auth is disabled.',
  ),
  getRelayConfig,
  saveRelayConfig,
  regenerateConfig: () => { regenerateConfigWithRollback(resolveLifecyclePort()); },
  deployRelay: ({ platform, ...input }) => PLATFORMS[platform](input),
  testRelay,
};

export function createRelayRouter(deps: RelayRouterDeps = defaultDeps): Router {
  const router = Router();
  const proxy = (method: keyof RelayRouterDeps) => deps[method];

  router.use((req, res, next) => { if (deps.enforceAccess(req, res)) next(); });

  router.get('/', (_req, res) => { res.json(deps.getRelayConfig()); });

  router.post('/deploy', async (req, res) => {
    const { platform, token, name, accountId, orgDomain } = (req.body ?? {}) as Record<string, string>;
    if (!platform || !(platform in PLATFORMS)) { res.status(400).json({ error: 'platform must be vercel, cloudflare, deno, or netlify.' }); return; }
    if (!token?.trim()) { res.status(400).json({ error: `${platform} API token is required` }); return; }
    if (platform === 'cloudflare' && !accountId?.trim()) { res.status(400).json({ error: 'Cloudflare Account ID and API Token are required' }); return; }
    if (platform === 'deno' && !orgDomain?.trim()) { res.status(400).json({ error: 'Organization domain is required' }); return; }
    try {
      const result = await proxy('deployRelay')({ platform: platform as RelayPlatform, token: token.trim(), name: name?.trim() || undefined, accountId, orgDomain });
      const entry = createRelayEntry(platform as RelayPlatform, result.name, result.url);
      const current = deps.getRelayConfig();
      await deps.saveRelayConfig({ ...current, relays: [...current.relays, entry] });
      res.status(201).json({ relay: entry });
    } catch (error) {
      if (error instanceof DeployError) { res.status(error.status).json({ error: error.message }); return; }
      res.status(500).json({ error: (error as Error).message || 'Deploy failed' });
    }
  });

  router.post('/:id/test', async (req, res) => {
    const current = deps.getRelayConfig();
    const relay = current.relays.find((r) => r.id === req.params.id);
    if (!relay) { res.status(404).json({ error: 'Relay not found' }); return; }
    const result = await proxy('testRelay')(relay.url);
    const now = new Date().toISOString();
    await deps.saveRelayConfig({
      ...current,
      relays: current.relays.map((r) => r.id === relay.id
        ? { ...r, testStatus: result.ok ? 'ok' : 'fail', lastTestedAt: now, lastError: result.ok ? null : (result.error ?? `Relay test failed with status ${result.status}`) }
        : r),
    });
    res.json({ ...result, testedAt: now });
  });

  const setActive = (id: string | null) => serializeConfigTransaction(async () => {
    const previous = deps.getRelayConfig();
    const next: RelayConfig = { ...previous, activeId: id };
    await deps.saveRelayConfig(next);
    try { await proxy('regenerateConfig')(); }
    catch (error) {
      await deps.saveRelayConfig(previous);
      throw error;
    }
    return next;
  });

  router.post('/:id/activate', async (req, res) => {
    if (!deps.getRelayConfig().relays.some((r) => r.id === req.params.id)) { res.status(404).json({ error: 'Relay not found' }); return; }
    try { res.json({ success: true, relay: await setActive(req.params.id) }); }
    catch (error) { res.status(500).json({ error: `Failed to activate relay: ${(error as Error).message}` }); }
  });

  router.delete('/:id', async (req, res) => {
    const previous = deps.getRelayConfig();
    if (!previous.relays.some((r) => r.id === req.params.id)) { res.status(404).json({ error: 'Relay not found' }); return; }
    try {
      const next = await setActive(previous.activeId === req.params.id ? null : previous.activeId)
        .catch((error) => { throw error; });
      void next;
    } catch { /* fall through to plain removal below */ }
    const current = deps.getRelayConfig();
    const remaining = { ...current, relays: current.relays.filter((r) => r.id !== req.params.id), activeId: current.activeId === req.params.id ? null : current.activeId };
    await deps.saveRelayConfig(remaining);
    res.json({ success: true, relay: remaining });
  });

  return router;
}

export default createRelayRouter();
```

The DELETE route above is deliberately fiddly — simplify during implementation: deleting the **active** relay should reuse `setActive(null)` + removal in one transaction; deleting an inactive relay just saves the filtered list (no regeneration). Keep the test semantics: active-delete → `regenerated === 1` and final saved config has empty relays + null activeId.

Mount in `src/web-server/routes/index.ts`: `import relayRoutes from './relay-routes';` and `apiRoutes.use('/relay', relayRoutes);` before the miscRoutes catch-all (L157). **Step 4: Run tests**

Run: `bun test ./tests/unit/web-server/relay-routes.test.ts` — PASS. Then sanity: `bun test ./tests/unit/web-server/headroom-routes.test.ts` — no regression.

**Step 5: Commit**

```bash
git add src/relay/relay-service.ts src/web-server/routes/relay-routes.ts src/web-server/routes/index.ts tests/unit/web-server/relay-routes.test.ts
git commit -m "feat: /api/relay routes (list/deploy/test/activate/delete) + service"
```

---

### Task 6: Config generator emits `relay-url`

**Files:**
- Modify: `src/cliproxy/config/generator.ts` (bump `CLIPROXY_CONFIG_VERSION` 22 → 23 at L55 with comment; add `generateRelayBlock()`; emit in the Server Settings block near the token-saver emission at L817–821)
- Test: `src/cliproxy/config/__tests__/relay-generator.test.ts`

**Step 1: Write the failing test — mirror the temp-dir/CCS_HOME harness of `src/cliproxy/config/__tests__/token-saver-generator.test.ts` (L77–150). Open that file first and copy its setup exactly.**

```ts
// src/cliproxy/config/__tests__/relay-generator.test.ts
// (harness copied from token-saver-generator.test.ts: temp CCS_HOME,
//  mutateUnifiedConfig to set relay, regenerateConfig(8317, {configPath, authDir}))
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mutateConfig } from '../../config/config-loader-facade';
import { regenerateConfig } from '../generator';

describe('relay-url generation', () => {
  it('emits relay-url: <active relay url> when a relay is active', () => {
    mutateConfig((config) => {
      config.relay = { relays: [{ id: 'r1', name: 'n', platform: 'cloudflare', url: 'https://my.workers.dev', createdAt: 'x' }], activeId: 'r1' };
    });
    const path = regenerateConfig(8317, { configPath: TEMP_CONFIG_PATH, authDir: TEMP_AUTH_DIR });
    expect(readFileSync(path, 'utf8')).toContain('relay-url: "https://my.workers.dev"');
  });

  it('emits relay-url: \'\' when no relay is active', () => {
    mutateConfig((config) => { config.relay = { relays: [], activeId: null }; });
    const path = regenerateConfig(8317, { configPath: TEMP_CONFIG_PATH, authDir: TEMP_AUTH_DIR });
    expect(readFileSync(path, 'utf8')).toMatch(/relay-url: ''/);
  });
});
```

**Step 2: Run to verify it fails**

Run: `bun test ./src/cliproxy/config/__tests__/relay-generator.test.ts` — FAIL (no `relay-url` in output).

**Step 3: Implement**

```ts
function generateRelayBlock(): string {
  // Active relay URL flows from the dashboard toggle into the proxy config.
  // CLIProxyAPIPlus hot-reloads this key via its fsnotify watcher.
  const { relays, activeId } = loadOrCreateUnifiedConfig().relay ?? { relays: [], activeId: null };
  const url = activeId ? relays.find((relay) => relay.id === activeId)?.url ?? '' : '';
  return `# Edge relay egress URL (managed by the CCS dashboard; empty = direct).
relay-url: ${quoteYamlString(url)}`;
}
```

Emit `${generateRelayBlock()}` in `generateUnifiedConfigContent` right after the token-saver block (L817–821). Bump `CLIPROXY_CONFIG_VERSION` to `23`. **Check for tests asserting version 22:** `Select-String -Path (Get-ChildItem -Recurse src,tests -Include *.ts,*.js -File | % FullName) -Pattern 'CLIPROXY_CONFIG_VERSION|= 22'` — update any stale assertion with a comment.

**Step 4: Run tests**

Run: `bun test ./src/cliproxy/config/__tests__/relay-generator.test.ts` — PASS.
Run: `bun test ./src/cliproxy/config/__tests__/token-saver-generator.test.ts` — no regression.
Run: `bun test ./src/cliproxy/config/__tests__/config-generator.test.js` — no regression.

**Step 5: Commit**

```bash
git add src/cliproxy/config/generator.ts src/cliproxy/config/__tests__/relay-generator.test.ts
git commit -m "feat: emit relay-url in cliproxy config.yaml from active relay (v23)"
```

---

### Task 7: `relayFetch` for CCS egress + call-site swaps

**Files:**
- Create: `src/relay/relay-fetch.ts`
- Modify: `src/cliproxy/quota/quota-fetcher-claude.ts` (direct provider fetch at ~L145 / `fetchClaudeQuotaWithToken` ~L282 — **only** the native-login path that calls `CLAUDE_OAUTH_USAGE_URL` directly, not the management-API path)
- Modify: `src/cliproxy/quota/codex-reset-credits.ts` (default `fetcher: FetchLike = fetch` L51–55 → default `relayFetch`)
- Modify: `src/cliproxy/ai-providers/service.ts` (`testAiProviderConnection` fetch ~L422, `fetchAiProviderModels` fetch ~L544)
- Modify: `src/api/services/openrouter-catalog.ts` (~L64)
- Test: `tests/unit/relay/relay-fetch.test.ts`

**Do NOT swap** calls built from `buildProxyUrl(...)` (loopback/remote-management traffic — the Go relay covers provider egress there), Ollama readiness probes (loopback), or binary downloader (GitHub, has its own proxy handling).

**Step 1: Write the failing test**

```ts
// tests/unit/relay/relay-fetch.test.ts
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { relayFetch } from '../../../src/relay/relay-fetch';
import { mutateConfig } from '../../../src/config/config-loader-facade';

let fetchSpy: ReturnType<typeof spyOn>;
beforeEach(() => { fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}')); });
afterEach(() => { fetchSpy.mockRestore(); mutateConfig((c) => { c.relay = { relays: [], activeId: null }; }); });

describe('relayFetch', () => {
  it('passes through when no relay is active', async () => {
    await relayFetch('https://api.anthropic.com/v1/messages', { method: 'POST', body: '{}' });
    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
  });

  it('rewrites external https through the active relay with both headers', async () => {
    mutateConfig((c) => {
      c.relay = { relays: [{ id: 'r1', name: 'n', platform: 'vercel', url: 'https://relay.vercel.app', createdAt: 'x' }], activeId: 'r1' };
    });
    await relayFetch('https://api.anthropic.com/v1/messages?beta=true', {
      method: 'POST', headers: { authorization: 'Bearer abc' }, body: '{}',
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://relay.vercel.app/v1/messages?beta=true');
    expect(init.headers.get('x-relay-target')).toBe('https://api.anthropic.com');
    expect(init.headers.get('x-relay-path')).toBe('/v1/messages?beta=true');
    expect(init.headers.get('authorization')).toBe('Bearer abc');
  });

  it('never relays loopback or non-https targets', async () => {
    mutateConfig((c) => {
      c.relay = { relays: [{ id: 'r1', name: 'n', platform: 'vercel', url: 'https://relay.vercel.app', createdAt: 'x' }], activeId: 'r1' };
    });
    await relayFetch('http://127.0.0.1:8317/v0/management/api-call', { method: 'POST' });
    await relayFetch('http://localhost:11434/api/tags');
    expect(fetchSpy.mock.calls[0][0]).toBe('http://127.0.0.1:8317/v0/management/api-call');
    expect(fetchSpy.mock.calls[1][0]).toBe('http://localhost:11434/api/tags');
    expect(fetchSpy.mock.calls[0][1]?.headers?.get('x-relay-target') ?? null).toBeNull();
  });
});
```

**Step 2: Run to verify it fails**

Run: `bun test ./tests/unit/relay/relay-fetch.test.ts` — FAIL, module not found.

**Step 3: Implement**

```ts
// src/relay/relay-fetch.ts
import { getActiveRelayUrl } from './relay-service';

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '::1' || hostname.startsWith('127.') || hostname.startsWith('[::1');
}

/**
 * fetch() wrapper for CCS-originated external calls. When a relay is active in
 * the dashboard, https calls to non-loopback hosts are forwarded through the
 * relay worker (x-relay-target + x-relay-path protocol). Everything else —
 * loopback, plain http, no active relay — is a plain fetch.
 */
export async function relayFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const relayUrl = getActiveRelayUrl();
  const target = new URL(typeof input === 'string' ? input : input.toString());
  if (!relayUrl || target.protocol !== 'https:' || isLoopback(target.hostname)) {
    return fetch(input, init);
  }
  const relay = new URL(relayUrl);
  if (relay.host === target.host) {
    return fetch(input, init);
  }
  const headers = new Headers(init?.headers);
  headers.set('x-relay-target', target.origin);
  headers.set('x-relay-path', target.pathname + target.search);
  return fetch(`${relay.origin}${target.pathname}${target.search}`, { ...init, headers });
}
```

Swap call sites: in each of the four files, `import { relayFetch } from '<rel>/relay/relay-fetch';` and replace **only** the direct provider-`fetch(` calls listed above with `relayFetch(`. Leave every `buildProxyUrl`/management call untouched. (Open each file first; line numbers drift — identify by the URL constants: `CLAUDE_OAUTH_USAGE_URL`, provider `/models` endpoints, openrouter catalog URL, and the codex-reset-credits default parameter.)

**Step 4: Run tests**

Run: `bun test ./tests/unit/relay/relay-fetch.test.ts` — PASS.
Run per-file sweeps of the four modified files' existing tests (find them via `Select-String` / glob for their `__tests__` entries): e.g. `bun test ./src/cliproxy/quota/__tests__/quota-fetcher-claude.test.ts` (and whatever exists for the others) — no regressions.

**Step 5: Commit**

```bash
git add src/relay/relay-fetch.ts src/cliproxy/quota/quota-fetcher-claude.ts src/cliproxy/quota/codex-reset-credits.ts src/cliproxy/ai-providers/service.ts src/api/services/openrouter-catalog.ts tests/unit/relay/relay-fetch.test.ts
git commit -m "feat: relayFetch wrapper + apply to CCS external egress sites"
```

---

### Task 8: Dashboard UI (Relay page)

Model on `ui/src/pages/token-saver.tsx` (plain fetch + sonner toast + shadcn primitives). Verification = `cd ui && bun run build` (typecheck via vite/tsc) — no new vitest for v1, matching token-saver.

**Files:**
- Create: `ui/src/pages/relay.tsx` (export `RelayPage`)
- Modify: `ui/src/App.tsx` (lazy import near L41; route inside the `<Layout>` group near `/token-saver` at L163–170)
- Modify: `ui/src/components/layout/app-sidebar.tsx` (general group near `/token-saver` at ~L70: `{ path: '/relay', icon: Network, label: 'Relay' }` — import `Network` from lucide-react)

**Step 1: Implement `ui/src/pages/relay.tsx`**

Structure (complete behavior; keep it compact — target ~220 lines):

```tsx
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface RelayEntry {
  id: string; name: string; platform: 'vercel' | 'cloudflare' | 'deno' | 'netlify'; url: string;
  createdAt: string; testStatus?: 'ok' | 'fail' | 'untested'; lastTestedAt?: string; lastError?: string | null;
}
interface RelayConfig { relays: RelayEntry[]; activeId: string | null }

const PLATFORM_HINTS: Record<RelayEntry['platform'], string> = {
  vercel: 'Streaming-capable. Recommended for inference.',
  cloudflare: 'Streaming-capable. Recommended for inference.',
  deno: 'Streaming-capable. Requires an organization domain.',
  netlify: 'Buffered responses — not suitable for streaming/inference.',
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/relay${path}`, {
    headers: { 'content-type': 'application/json' }, ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  return body as T;
}

export function RelayPage() {
  const [config, setConfig] = useState<RelayConfig | null>(null);
  const [platform, setPlatform] = useState<'vercel' | 'cloudflare' | 'deno' | 'netlify'>('cloudflare');
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [accountId, setAccountId] = useState('');
  const [orgDomain, setOrgDomain] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try { setConfig(await request<RelayConfig>('')); }
    catch (error) { toast.error((error as Error).message); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const deploy = async () => {
    setDeploying(true);
    try {
      await request('/deploy', { method: 'POST', body: JSON.stringify({ platform, name, token, accountId, orgDomain }) });
      toast.success(`Relay deployed${name ? `: ${name}` : ''}`);
      setToken(''); setName(''); setOpen(false);
      await reload();
    } catch (error) { toast.error((error as Error).message); }
    finally { setDeploying(false); }
  };
  const testRelay = async (id: string) => {
    setBusyId(id);
    try {
      const result = await request<{ ok: boolean; error?: string | null; elapsedMs: number }>(`/${id}/test`, { method: 'POST' });
      (result.ok ? toast.success : toast.error)(result.ok ? `Relay OK (${result.elapsedMs}ms)` : `Relay failed: ${result.error}`);
      await reload();
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusyId(null); }
  };
  const activate = async (id: string) => {
    setBusyId(id);
    try {
      await request(`/${id}/activate`, { method: 'POST' });
      toast.success('Relay activated — proxy config regenerated');
      await reload();
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusyId(null); }
  };
  const deactivate = async () => { /* POST-style clear: DELETE of active is not it — add a dedicated call:
    reuse activate with a sentinel? No: add POST /api/relay/:id/deactivate in Task 5 if desired; for v1,
    deleting the active relay deactivates. Simplest UI: only Activate action; active shows badge. */ };
  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await request(`/${id}`, { method: 'DELETE' });
      toast.success('Relay removed');
      await reload();
    } catch (error) { toast.error((error as Error).message); }
    finally { setBusyId(null); }
  };

  // Render: header Card explaining the feature; Deploy dialog (platform Select with
  // PLATFORM_HINTS description, name Input, token Input type=password, accountId Input
  // when cloudflare, orgDomain Input when deno, submit disabled while deploying);
  // list of relay Cards: name + platform Badge + active Badge ("Active") when id === activeId,
  // url link, testStatus Badge (ok/fail/untested), lastError text, buttons Test / Activate / Delete;
  // Netlify entries additionally render PLATFORM_HINTS.netlify as a warning line.
  return (/* JSX */);
}

export default RelayPage;
```

Implement the JSX fully during execution (Card per relay, actions wired to the handlers above). Keep the `deactivate` stub out of the final file — omit the function entirely for v1 (deactivate-by-delete is acceptable; note it in the page description).

**Step 2: Wire routes**

- `App.tsx`: `const RelayPage = lazy(() => import('@/pages/relay').then((m) => ({ default: m.RelayPage })));` + `<Route path="/relay" element={<Suspense fallback={<PageLoader />}><RelayPage /></Suspense>} />` inside the Layout group (copy the token-saver route block exactly).
- `app-sidebar.tsx`: add the nav item after token-saver in the general group.

**Step 3: Verify**

Run: `cd ui && bun run build` — succeeds (tsc + vite). Open the page in the dev dashboard if running; otherwise visual check deferred to deployment.

**Step 4: Commit**

```bash
git add ui/src/pages/relay.tsx ui/src/App.tsx ui/src/components/layout/app-sidebar.tsx
git commit -m "feat: dashboard Relay page (deploy/test/activate/delete)"
```

---

### Task 9: CCS verification sweep

**Step 1:** Full build + typecheck:

Run: `npm run build` — exit 0. `npm run typecheck` — exit 0 (if present in scripts).

**Step 2:** Per-file test sweep of everything new/modified (fresh process per file = authoritative):

```powershell
$files = @(
  'tests/unit/config/relay-config.test.ts',
  'tests/unit/relay/worker-sources.test.ts',
  'tests/unit/relay/netlify-zip.test.ts',
  'tests/unit/relay/deploy.test.ts',
  'tests/unit/relay/relay-fetch.test.ts',
  'tests/unit/web-server/relay-routes.test.ts',
  'src/cliproxy/config/__tests__/relay-generator.test.ts',
  'src/cliproxy/config/__tests__/token-saver-generator.test.ts',
  'src/cliproxy/config/__tests__/config-generator.test.js'
)
foreach ($f in $files) { bun test "./$f"; if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: $f"; } }
```

Expected: all green.

**Step 3: Commit** (only if any sweep-driven fixes were needed):

```bash
git add -A; git commit -m "test: relay sweep fixes"
```

---

## Part B — CLIProxyAPIPlus (separate repo)

### Task 10: `relay-url` config field

**Files:**
- Modify: `internal/config/sdk_config.go` (beside `ProxyURL`, L13)
- Modify: `config.example.yaml` (after `proxy-url` docs, L183–185)
- Modify: `internal/watcher/diff/config_diff.go` (beside the proxy-url entry, L85–87)
- Test: `internal/watcher/diff/config_diff_test.go` (add case) + a yaml-parse assertion (extend an existing config test or add `internal/config/relay_url_test.go`)

**Step 1: Write failing tests**

```go
// internal/config/relay_url_test.go
package config

import "testing"

func TestRelayURLYAMLParse(t *testing.T) {
	cfg, err := ParseConfigBytes([]byte("relay-url: https://relay.example.workers.dev\n"))
	if err != nil { t.Fatalf("parse: %v", err) }
	if cfg.RelayURL != "https://relay.example.workers.dev" { t.Fatalf("got %q", cfg.RelayURL) }
}
```

In `config_diff_test.go`, add a case mirroring the proxy-url diff tests (L576–598): changing `relay-url` yields a diff entry `relay-url: ... -> ...`.

**Step 2: Run to verify failure**

Run: `go test ./internal/config -run TestRelayURLYAMLParse` — FAIL (unknown field silently ignored by yaml → empty string).
Run: `go test ./internal/watcher/diff` — new case FAIL.

**Step 3: Implement**

```go
// internal/config/sdk_config.go — beside ProxyURL:
// RelayURL optionally forwards outbound HTTPS requests through an edge relay
// worker (x-relay-target/x-relay-path protocol). Empty disables the relay.
RelayURL string `yaml:"relay-url" json:"relay-url"`
```

```go
// internal/watcher/diff/config_diff.go — beside the ProxyURL entry:
if oldCfg.RelayURL != newCfg.RelayURL {
    changes = append(changes, fmt.Sprintf("relay-url: %s -> %s", formatProxyURL(oldCfg.RelayURL), formatProxyURL(newCfg.RelayURL)))
}
```

`config.example.yaml` after L185:

```yaml
# Edge relay URL. When set, outbound HTTPS requests (providers) are forwarded
# through the relay worker at this URL using x-relay-target/x-relay-path headers.
# Managed by the CCS dashboard; leave empty for direct egress.
relay-url: ""
```

**Step 4: Run to verify passing**

Run: `gofmt -w .` then `go test ./internal/config ./internal/watcher/diff` — PASS.

**Step 5: Commit (in CLIProxyAPIPlus repo)**

```bash
git -C C:\Users\sysadmin\Documents\test\CLIProxyAPIPlus add internal/config/sdk_config.go internal/config/relay_url_test.go internal/watcher/diff/config_diff.go internal/watcher/diff/config_diff_test.go config.example.yaml
git -C C:\Users\sysadmin\Documents\test\CLIProxyAPIPlus commit -m "feat: relay-url config field + diff entry"
```

---

### Task 11: `proxyutil.WrapRelay` RoundTripper

**Files:**
- Create: `sdk/proxyutil/relay.go`
- Test: `sdk/proxyutil/relay_test.go`

**Step 1: Write the failing test (model on `sdk/proxyutil/proxy_test.go`, which uses `httptest.NewTLSServer`)**

```go
// sdk/proxyutil/relay_test.go
package proxyutil

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWrapRelayRewritesHTTPSAndInjectsHeaders(t *testing.T) {
	var got *http.Request
	var body []byte
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r
		body, _ = io.ReadAll(r.Body)
		w.WriteHeader(201)
		_, _ = w.Write([]byte("streamed"))
	}))
	defer upstream.Close()

	relayed := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		target := r.Header.Get("x-relay-target")
		path := r.Header.Get("x-relay-path")
		req, _ := http.NewRequest(r.Method, target+path, r.Body)
		req.Header = r.Header.Clone()
		req.Header.Del("x-relay-target")
		req.Header.Del("x-relay-path")
		req.Host = ""
		resp, err := upstream.Client().Transport.RoundTrip(req)
		if err != nil { w.WriteHeader(502); return }
		defer resp.Body.Close()
		for k, v := range resp.Header { w.Header()[k] = v }
		w.WriteHeader(resp.StatusCode)
		buf, _ := io.ReadAll(resp.Body)
		_, _ = w.Write(buf)
	}))
	defer relayed.Close()

	client := &http.Client{Transport: WrapRelay(upstream.Client().Transport, relayed.URL)}
	resp, err := client.Post("https://api.anthropic.com/v1/messages", "application/json", strings.NewReader(`{"x":1}`))
	if err != nil { t.Fatalf("request: %v", err) }
	defer resp.Body.Close()
	if resp.StatusCode != 201 { t.Fatalf("status %d", resp.StatusCode) }
	if got == nil { t.Fatal("upstream never reached") }
	if got.Header.Get("x-relay-target") != "" || got.Header.Get("x-relay-path") != "" {
		t.Fatalf("relay headers leaked upstream: %v", got.Header)
	}
	if string(body) != `{"x":1}` { t.Fatalf("body = %q", body) }
}

func TestWrapRelayBypassesLoopbackAndNonHTTPS(t *testing.T) {
	for _, target := range []string{"http://127.0.0.1:8317/v1", "http://localhost:11434/x", "http://example.com/x", "https://[::1]:8443/x"} {
		var hit bool
		srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hit = true }))
		defer srv.Close()
		client := &http.Client{Transport: WrapRelay(srv.Client().Transport, srv.URL)}
		client.Transport.(*relayRoundTripper).base = http.DefaultTransport // direct base for bypass cases
		req, _ := http.NewRequest(http.MethodGet, target, nil)
		if _, err := http.DefaultClient.Do(req); err == nil {
			// plain http to example.com may succeed or fail; only assert no relay involvement:
			_ = hit
		}
		if hit { t.Fatalf("relay server reached for %s", target) }
	}
}

func TestWrapRelayDisabledAndInvalid(t *testing.T) {
	base := http.DefaultTransport
	if WrapRelay(base, "") != base { t.Fatal("empty relay-url must return base unchanged") }
	rt := WrapRelay(base, "not a url")
	if rt != base { t.Fatal("invalid relay-url must fall back to base") }
}
```

(Implementer: tighten the bypass test — assert via a recording RoundTripper that the request URL was passed through untouched, rather than the loose `http.DefaultClient.Do` above. The intent: loopback hosts, `http://` scheme targets, and `[::1]` are never rewritten.)

**Step 2: Run to verify failure**

Run: `go test ./sdk/proxyutil -run TestWrapRelay` — FAIL (no WrapRelay).

**Step 3: Implement**

```go
// sdk/proxyutil/relay.go
package proxyutil

import (
	"net"
	"net/http"
	"net/url"
	"strings"
)

type relayRoundTripper struct {
	base  http.RoundTripper
	relay *url.URL
}

// WrapRelay rewrites external HTTPS requests through an edge relay worker
// using the x-relay-target/x-relay-path two-header protocol. Loopback hosts,
// non-HTTPS schemes, and requests already aimed at the relay pass through
// unchanged. An empty or invalid relayURL returns base untouched.
func WrapRelay(base http.RoundTripper, relayURL string) http.RoundTripper {
	raw := strings.TrimSpace(relayURL)
	if raw == "" {
		return base
	}
	relay, err := url.Parse(raw)
	if err != nil || (relay.Scheme != "http" && relay.Scheme != "https") || relay.Host == "" {
		return base
	}
	if base == nil {
		base = http.DefaultTransport
	}
	return &relayRoundTripper{base: base, relay: relay}
}

func (r *relayRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	if !r.shouldRelay(req.URL) {
		return r.base.RoundTrip(req)
	}
	clone := req.Clone(req.Context())
	clone.Header.Set("x-relay-target", req.URL.Scheme+"://"+req.URL.Host)
	clone.Header.Set("x-relay-path", req.URL.RequestURI())
	clone.URL.Scheme = r.relay.Scheme
	clone.URL.Host = r.relay.Host
	clone.Host = r.relay.Host
	return r.base.RoundTrip(clone)
}

func (r *relayRoundTripper) shouldRelay(target *url.URL) bool {
	if target.Scheme != "https" || target.Host == "" {
		return false
	}
	if target.Host == r.relay.Host {
		return false
	}
	host := target.Hostname()
	if host == "localhost" || host == "::1" {
		return false
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return false
	}
	return true
}
```

Note: `RequestURI()` includes `?query`. The relay worker composes `target + path` server-side; the request's own path is irrelevant to the worker but kept for proxy/logging sanity.

**Step 4: Run to verify passing**

Run: `gofmt -w .` then `go test ./sdk/proxyutil` — PASS (existing 921 lines of proxy tests still green).

**Step 5: Commit**

```bash
git -C C:\Users\sysadmin\Documents\test\CLIProxyAPIPlus add sdk/proxyutil/relay.go sdk/proxyutil/relay_test.go
git -C C:\Users\sysadmin\Documents\test\CLIProxyAPIPlus commit -m "feat: proxyutil.WrapRelay roundtripper (x-relay-target protocol)"
```

---

### Task 12: Wire WrapRelay into the client factories

The four factories + two special cases from the exploration. Every wiring site guards on `cfg != nil && cfg.RelayURL != ""` so zero-relay behavior is byte-identical.

**Files (all in CLIProxyAPIPlus):**
- Modify: `internal/runtime/executor/helps/proxy_helpers.go` (`NewProxyAwareHTTPClient` — wrap on every return path; **cache key must include relay**)
- Modify: `internal/runtime/executor/helps/utls_client.go` (`NewUtlsHTTPClient` — wrap the outer fallback roundtripper)
- Modify: `internal/util/proxy.go` (`SetProxy` — wrap even when transport is nil)
- Modify: `sdk/cliproxy/rtprovider.go` (+ its constructor call sites — plumb relay URL)
- Modify: `internal/runtime/executor/antigravity_executor.go` (`newAntigravityHTTPClient`, L439–456)
- Modify: `internal/runtime/executor/kiro_executor.go` (`newKiroHTTPClientWithPooling`, L247–318 — include relay in pool key)
- Test: extend `internal/runtime/executor/helps/proxy_helpers_test.go`

**Step 1: Write failing test in `helps/proxy_helpers_test.go`** (model on `TestNewProxyAwareHTTPClientRequestProxyOverridesAuthAndGlobal`):

```go
func TestNewProxyAwareHTTPClientWrapsRelay(t *testing.T) {
	cfg := &config.Config{}
	cfg.RelayURL = "https://relay.example.workers.dev"
	client := NewProxyAwareHTTPClient(context.Background(), cfg, nil, 0)
	rt := client.Transport
	rr, ok := rt.(*proxyutil.RelayRoundTripper) // see note below
	if !ok { t.Fatalf("transport %T is not relay-wrapped", rt) }
}

func TestNewProxyAwareHTTPClientRelayCacheKeySeparation(t *testing.T) {
	plain := NewProxyAwareHTTPClient(context.Background(), &config.Config{}, nil, 0)
	cfg := &config.Config{}
	cfg.RelayURL = "https://relay.example.workers.dev"
	relayed := NewProxyAwareHTTPClient(context.Background(), cfg, nil, 0)
	if plain.Transport == relayed.Transport { t.Fatal("relay and non-relay clients share transport") }
}
```

**Export note:** `relayRoundTripper` is unexported; either (a) add `func IsRelayRoundTripper(rt http.RoundTripper) bool` to `proxyutil` and assert with that (preferred — no API surface growth), or (b) export the type. Use (a); adjust the test accordingly. For the uTLS client, assert behaviorally: with `cfg.RelayURL` set, a request to `https://api.anthropic.com` reaches a local TLS "relay" test server that records `x-relay-target` (reuse the Task 11 relay test server pattern).

**Step 2: Run to verify failure**

Run: `go test ./internal/runtime/executor/helps -run TestNewProxyAwareHTTPClientWrapsRelay` — FAIL.

**Step 3: Implement wiring**

- `proxy_helpers.go` `NewProxyAwareHTTPClient`: after the existing proxy/transport resolution, on **every** return path:
  ```go
  relayURL := ""
  if cfg != nil { relayURL = strings.TrimSpace(cfg.RelayURL) }
  if relayURL != "" {
      base := httpClient.Transport
      if base == nil { base = http.DefaultTransport }
      httpClient.Transport = proxyutil.WrapRelay(base, relayURL)
  }
  ```
  Cache: change the cache key from `proxyURL` to `proxyURL + "|" + relayURL` (both the lookup and store paths, L~44–78).
- `utls_client.go` `NewUtlsHTTPClient`: build the `fallbackRoundTripper` as today; then
  ```go
  var transport http.RoundTripper = &fallbackRoundTripper{...}
  if cfg != nil && strings.TrimSpace(cfg.RelayURL) != "" {
      transport = proxyutil.WrapRelay(transport, strings.TrimSpace(cfg.RelayURL))
  }
  client := &http.Client{Transport: transport}
  ```
- `internal/util/proxy.go` `SetProxy`: after the existing body:
  ```go
  if cfg != nil && strings.TrimSpace(cfg.RelayURL) != "" {
      base := httpClient.Transport
      if base == nil { base = http.DefaultTransport }
      httpClient.Transport = proxyutil.WrapRelay(base, cfg.RelayURL)
  }
  ```
- `sdk/cliproxy/rtprovider.go`: add a `relayURL string` field to `defaultRoundTripperProvider`; wrap its produced roundtripper (`BuildHTTPTransport` result and the cached entry — cache key must include relay). Find its constructor via `grep -n "RoundTripperProvider" -r sdk internal cmd` and thread `cfg.RelayURL` from the construction site(s); `go build` will list every site.
- `antigravity_executor.go` `newAntigravityHTTPClient`: wrap the final `http.Client.Transport` the same guarded way (cfg is in scope at L439+; verify).
- `kiro_executor.go` `newKiroHTTPClientWithPooling`: include `cfg.RelayURL` in the pool key and wrap the pooled client's transport at creation (do not wrap per-checkout).

**Do NOT touch:** websocket dialers (`codex_websockets_connection.go`, `sideband.go`), the Amp reverse proxy, TUI/loopback clients.

**Step 4: Run tests**

Run: `gofmt -w .` then:

```bash
go test ./internal/runtime/executor/helps ./sdk/proxyutil ./internal/util ./sdk/cliproxy/... ./internal/runtime/executor
go build -o test-output ./cmd/server && rm test-output
```

All PASS; build clean. (Full `go test ./...` optional — it's slow; run it if any shared package changed.)

**Step 5: Commit**

```bash
git -C C:\Users\sysadmin\Documents\test\CLIProxyAPIPlus add -A
git -C C:\Users\sysadmin\Documents\test\CLIProxyAPIPlus commit -m "feat: apply relay-url via WrapRelay at all client factories"
```

---

## Part C — Cross-stack verification (local, non-invasive)

### Task 13: End-to-end smoke without platform tokens

Runs entirely on loopback; touches no running processes, no real `~/.ccs` files (uses temp `CCS_HOME`), no live proxy config.

**Step 1: Local relay + upstream harness test (CCS side)** — add `tests/unit/relay/local-e2e.test.ts`:

```ts
// tests/unit/relay/local-e2e.test.ts
// Boots (1) an echo "provider" server and (2) a local relay server speaking the
// 2-header protocol, then drives the REAL Vercel worker source (imported from
// worker-sources.ts) against the local relay — proving the deployed artifact
// round-trips a real HTTP exchange end to end.
import { afterEach, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { VERCEL_RELAY_WORKER } from '../../../src/relay/worker-sources';

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); });

describe('relay local e2e', () => {
  it('worker → local relay → upstream echo, headers stripped, body round-trip', async () => {
    // Upstream echo: records headers, returns JSON.
    let seenHeaders: Record<string, string | string[] | undefined> = {};
    const upstream = createServer((req, res) => {
      seenHeaders = req.headers;
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ echoed: body, path: req.url }));
      });
    });
    servers.push(upstream);
    await new Promise<void>((r) => upstream.listen(0, r));
    const upstreamPort = (upstream.address() as AddressInfo).port;

    // Local relay: implements x-relay-target/x-relay-path (same semantics as the worker).
    const relay = createServer((req, res) => {
      const target = String(req.headers['x-relay-target'] ?? '');
      const path = String(req.headers['x-relay-path'] ?? '/');
      if (!target) { res.writeHead(400).end(); return; }
      const headers = { ...req.headers } as Record<string, string>;
      delete headers['x-relay-target']; delete headers['x-relay-path']; delete headers['host'];
      const proxyReq = http.request(`${target.replace(/\/$/, '')}${path}`, { method: req.method, headers }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers as Record<string, string>);
        proxyRes.pipe(res);
      });
      proxyReq.on('error', () => res.writeHead(502).end());
      req.pipe(proxyReq);
    });
    servers.push(relay);
    await new Promise<void>((r) => relay.listen(0, r));
    const relayPort = (relay.address() as AddressInfo).port;

    // Run the real worker handler against the local relay.
    const dir = mkdtempSync(join(tmpdir(), 'relay-e2e-'));
    const file = join(dir, 'worker.mjs');
    writeFileSync(file, VERCEL_RELAY_WORKER, 'utf8');
    const mod = await import(pathToFileURL(file).href);
    const res = await mod.default(new Request('https://unused', {
      method: 'POST',
      headers: {
        'x-relay-target': `http://127.0.0.1:${upstreamPort}`,
        'x-relay-path': '/v1/messages?beta=true',
        'content-type': 'application/json',
        authorization: 'Bearer secret',
      },
      body: '{"prompt":"hi"}',
    }));
    expect(res.status).toBe(201);
    const payload = await res.json() as { echoed: string; path: string };
    expect(payload.echoed).toBe('{"prompt":"hi"}');
    expect(payload.path).toBe('/v1/messages?beta=true');
    expect(seenHeaders['x-relay-target']).toBeUndefined();
    expect(seenHeaders['x-relay-path']).toBeUndefined();
    expect(seenHeaders.authorization).toBe('Bearer secret');
  });
});
```

(Add `import * as http from 'node:http';` at the top.)

**Step 2: Run it**

Run: `bun test ./tests/unit/relay/local-e2e.test.ts` — PASS.

**Step 3: Go binary smoke (optional but recommended)** — build and run a *temporary* instance on a spare port, never touching the installed binary:

```powershell
go build -o "$env:TEMP\cliproxy-relay-smoke.exe" ./cmd/server
# temp config with relay-url pointing at a local 2-header relay server (run any of the
# harness servers above standalone, or reuse Task 13's relay), port 18317:
@"
port: 18317
relay-url: http://127.0.0.1:<relayPort>
"@ | Set-Content "$env:TEMP\cliproxy-relay-smoke.yaml"
& "$env:TEMP\cliproxy-relay-smoke.exe" --config "$env:TEMP\cliproxy-relay-smoke.yaml"
# Then: curl the temp instance's /v1/models or a provider call and confirm the relay
# server log shows x-relay-target headers; management/loopback calls stay direct.
```

Stop the temp instance afterward; delete the temp exe/config. **Do not** point this at the live `~/.ccs/cliproxy` config or port 8317.

**Step 4: Commit**

```bash
git add tests/unit/relay/local-e2e.test.ts
git commit -m "test: local end-to-end relay protocol verification"
```

---

## Definition of done

- All Tasks 1–13 green: CCS `npm run build` clean, every new/modified test file passes per-file, Go `go build` clean + targeted tests pass.
- CCS commits on `main`; CLIProxyAPIPlus commits on its default branch; nothing pushed without the user asking.
- Live verification (user-opted, manual, after the user supplies platform tokens): deploy a relay from the dashboard UI → Test badge green → Activate → confirm `~/.ccs/cliproxy/config.yaml` gained `relay-url: <url>` and the running proxy hot-reloaded it (proxy log shows the config diff) → a Claude/Gemini call egresses via the relay.

---

## Amendment (2026-10-15): deploy auto-activates

The lifecycle described above changed for 9Router parity: `POST /api/relay/deploy`
now appends **and activates** the relay inside the same serialized
save+regenerate transaction (the response carries `activated: true/false`, plus
`activationError` when regeneration fails — the deployed entry is kept and the
active pointer reverts). The `POST /api/relay/:id/activate` endpoint and the
dashboard Activate button were removed; deploying a relay makes it the live one
immediately, and deleting the active relay still turns relaying off. The
activate-route test sketches above were rewritten as deploy-activation cases
(append+activate, regenerate-failure revert, previous-active replacement).
