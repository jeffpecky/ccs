# Edge Relay Design

## Goal

Port 9Router's edge relay to CCS + CLIProxyAPIPlus: deploy a tiny open-forwarder worker to Vercel / Cloudflare / Deno / Netlify, then route outbound traffic through it so AI providers see the edge platform's egress IP instead of the user's. One global toggle governs both the proxy's inference traffic and CCS's own outbound calls.

## Ownership

- CCS owns relay lifecycle: worker sources, deploy clients, storage, API routes, dashboard UI, activation write-through, and its own outbound consumption (`relayFetch`).
- CLIProxyAPIPlus owns inference egress: new `relay-url` config field and a `relayRoundTripper` that rewrites provider requests through the relay.
- Edge platforms host the workers; tokens are supplied per deploy, used once, never persisted.

## Protocol (9Router-compatible)

Two request headers, worker composes upstream URL as `target + path`:

- `x-relay-target`: origin, e.g. `https://api.anthropic.com`
- `x-relay-path`: path + query, defaults to `/`

Worker behavior (all four platforms):

- Missing target → `400` with JSON error.
- Strip `x-relay-target`, `x-relay-path`, `host` before forwarding; forward method, remaining headers, body.
- Stream response body and status back (Netlify buffers by design).
- Upstream throw → `502` JSON (Vercel worker gains the try/catch the 9Router original lacks, for uniform behavior).
- No worker auth, no CORS logic — open forwarder, same trade-off 9Router makes.

Relays are interchangeable with 9Router-deployed relays in both directions.

## CCS Components

### Worker sources

`src/relay/worker-sources.ts`: four embedded source strings (Vercel edge, Cloudflare module, Deno, Netlify Lambda), ported from 9Router's deploy routes. `src/relay/netlify-zip.ts`: hand-rolled stored-zip + CRC32 builder for Netlify digest deploys (port from `netlify-relay.ts`).

### Deploy clients

`src/relay/deploy.ts`: `deployVercel`, `deployCloudflare`, `deployDeno`, `deployNetlify`. Endpoints, auth headers, and error mapping (name-taken → 409) ported 1:1 from 9Router's `vercel-deploy`, `cf-deploy`, `deno-deploy`, `netlify-deploy` routes. Tokens arrive in the request body, are used for that deploy only, and are never written to disk.

### Storage

Unified config gains an optional section:

```json
{
  "relay": {
    "relays": [
      {
        "id": "…",
        "name": "…",
        "platform": "vercel | cloudflare | deno | netlify",
        "url": "https://….workers.dev",
        "testStatus": "ok | fail | untested",
        "lastTestedAt": "…",
        "lastError": "…"
      }
    ],
    "activeId": null
  }
}
```

Absent section = feature idle; existing configs load unchanged.

### API routes

- `GET /api/relay` — list + active id.
- `POST /api/relay/deploy` — `{ platform, token, name }` → deploy, append relay.
- `POST /api/relay/:id/test` — 9Router-style probe: forward to `https://httpbin.org/get`, expect JSON echo; 10s deadline; updates `testStatus`.
- `POST /api/relay/:id/activate` — set `activeId`, regenerate proxy config.
- `DELETE /api/relay/:id` — remove; if it was active, clear `activeId` and regenerate (relay-url removed).

### Activation write-through

Activating writes `relay-url: <url>` into the generated CLIProxyAPIPlus `config.yaml` through the existing config generator; deactivating deletes the key. The global toggle therefore lives in the dashboard and reaches the proxy as ordinary config — no new IPC.

### CCS outbound consumption

`src/relay/relay-fetch.ts`: `relayFetch(url, init)` — when an active relay exists, rewrite to relay origin, set both headers, forward; otherwise plain `fetch`. Applied to credentialed/high-value outbound first: live quota fetchers, OAuth token exchanges, connection tests. CCS loopback calls never go through the relay.

## Go Components (CLIProxyAPIPlus)

- Config: `relay-url` string field (yaml), empty = disabled.
- `relayRoundTripper` wraps the transport at the central client factory (`proxy.go`): when `relay-url` is set and the target is external `https`, rewrite URL to the relay and inject the two headers; otherwise pass through untouched.
- Loopback targets always direct (dashboard ↔ proxy management traffic).
- WebSocket dialers stay direct — workers cannot reliably upgrade connections (documented limitation).
- No silent fallback: a dead relay surfaces as a normal upstream error.

## UI

New "Relay" section in the dashboard: deploy modal (platform dropdown + token + name), relay list (platform badge, URL, test status, last error), actions per row (test, activate/deactivate, delete). Netlify rows carry a "buffered — not for streaming/inference" hint; recommended platforms flagged in the deploy modal.

## Error Handling

- Worker: `400` missing target, `502` upstream failure (uniform across platforms).
- Deploy: provider API failures mapped to friendly messages; name conflicts → `409`.
- Test: 10s deadline, failure records `lastError`, UI shows badge.
- Proxy: relay failures are plain upstream errors; no retry/fallback layer.

## Testing

- Worker protocol tests: invoke each handler with stubbed upstream fetch — headers stripped, target/path composition, 400/502 paths, streaming passthrough.
- Deploy client tests: mocked HTTP — endpoints, auth, payload shape, error mapping, Netlify zip bytes (CRC32 vectors).
- `relay-fetch` tests: active/inactive rewrite, loopback exclusion.
- Route tests: deploy persists relay (never token), activate/delete regenerate config with/without `relay-url`.
- Go tests: `relayRoundTripper` rewrite, header injection, loopback bypass, disabled passthrough.
- Local end-to-end: in-process relay server speaking the 2-header spec; point CCS and the running proxy at it; verify quota fetch and inference round-trip without real platform tokens.

## Limitations (v1)

- WebSockets bypass the relay.
- Netlify relay buffers responses — unsuitable for SSE/inference.
- Single active relay; no failover.
- Path-form target (`/r/https/host/…`) deferred — future add-on for callers that can only change a base URL (e.g. openai-compatibility connectors).
