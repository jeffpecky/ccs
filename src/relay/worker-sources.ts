/**
 * Edge relay worker sources — verbatim ports of the four 9Router relay workers.
 *
 * Each constant is the complete source text of one edge-relay function, copied
 * byte-for-byte from the 9Router repo (see deviations below). They are deployed
 * as-is — no build step, no bundling — by the future `src/relay/deploy.ts`.
 *
 * - VERCEL_RELAY_WORKER      Vercel Edge Function (`export default handler`)
 * - CLOUDFLARE_RELAY_WORKER  Cloudflare Worker (`export default { fetch }`)
 * - DENO_RELAY_WORKER        Deno Deploy entrypoint (`Deno.serve`)
 * - NETLIFY_RELAY_FUNCTION   Netlify Lambda-runtime function (`exports.handler`)
 * - NETLIFY_INDEX_HTML       placeholder index page for the Netlify site
 *
 * Protocol (identical across all four workers):
 *   - `x-relay-target` (origin, required) — e.g. `https://api.anthropic.com`;
 *     trailing slash is trimmed before the path is appended.
 *   - `x-relay-path`   (path + query, defaults to `/`) — e.g. `/v1/messages?beta=true`.
 * The workers strip `x-relay-target`, `x-relay-path`, and `host` from the
 * forwarded headers and pass everything else (e.g. `authorization`) through.
 *
 * Documented trade-off: these are open forwarders with no auth — anyone who can
 * reach the deployed relay URL can make it fetch arbitrary upstreams. Access
 * control is left to deployment-level protections, not the relay code itself.
 *
 * Deviations from the 9Router originals (everything else byte-identical):
 *   1. VERCEL_RELAY_WORKER wraps the upstream `fetch` + response construction in
 *      try/catch and returns a 502 JSON `{ error }` on failure, mirroring how the
 *      Cloudflare/Deno/Netlify workers already handle upstream errors. The 9Router
 *      Vercel original lacks this and surfaces a platform 500 instead.
 *   2. NETLIFY_INDEX_HTML rebrands "9Router Relay" -> "CCS Relay" (same HTML
 *      structure, same `/.netlify/functions/relay` code path).
 *   3. All four workers stamp each response they proxy with `x-relay-proxied: 1`
 *      (the response side of the two-header protocol), so the proxy's relay
 *      breaker can tell an answer the upstream really gave — a rate-limited
 *      provider is not a broken relay — from a 429/5xx produced by the worker's
 *      own hosting platform, which parks that relay for 30s. Relays deployed
 *      before this change lack the stamp; the breaker then falls back to the
 *      response shape (JSON/SSE payload = upstream answer, anything else =
 *      platform error page). The stamp is stripped before a response reaches
 *      the API client.
 *
 * Escaping note: the `\\/` sequences inside these template literals are
 * intentional and must stay as-is — the deployed worker source must contain the
 * two characters `\/` (escaped slash in the trailing-slash-trimming regex
 * `target.replace(/\/$/, "")`). Do not "fix" the backslashes.
 */

/** Vercel Edge Function source (`export default async function handler(req)`). */
export const VERCEL_RELAY_WORKER = `
export const config = { runtime: "edge" };

export default async function handler(req) {
  const target = req.headers.get("x-relay-target");
  const relayPath = req.headers.get("x-relay-path") || "/";
  if (!target) {
    return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const targetUrl = target.replace(/\\/$/, "") + relayPath;

  const rawHeaders = {};
  for (const [k, v] of req.headers.entries()) rawHeaders[k] = v;
  delete rawHeaders["x-relay-target"];
  delete rawHeaders["x-relay-path"];
  delete rawHeaders["host"];

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: rawHeaders,
      body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
      duplex: "half",
    });

    const proxiedHeaders = new Headers(response.headers);
    proxiedHeaders.set("x-relay-proxied", "1");
    return new Response(response.body, {
      status: response.status,
      headers: proxiedHeaders,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}
`;

/** Cloudflare Worker source (`export default { async fetch(request, env, ctx) }`). */
export const CLOUDFLARE_RELAY_WORKER = `
export default {
  async fetch(request, env, ctx) {
    const target = request.headers.get("x-relay-target");
    const relayPath = request.headers.get("x-relay-path") || "/";
    
    if (!target) {
      return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const targetUrl = target.replace(/\\/$/, "") + relayPath;
    const newRequestInit = {
      method: request.method,
      headers: new Headers(request.headers),
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      newRequestInit.body = request.body;
      newRequestInit.duplex = "half";
    }

    newRequestInit.headers.delete("x-relay-target");
    newRequestInit.headers.delete("x-relay-path");
    newRequestInit.headers.delete("host");

    try {
      const response = await fetch(targetUrl, newRequestInit);
      const proxiedHeaders = new Headers(response.headers);
      proxiedHeaders.set("x-relay-proxied", "1");
      return new Response(response.body, {
        status: response.status,
        headers: proxiedHeaders,
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
  },
};
`;

/** Deno Deploy source (entrypoint calling `Deno.serve(handler)`). */
export const DENO_RELAY_WORKER = `Deno.serve(async (request) => {
  const target = request.headers.get("x-relay-target");
  const relayPath = request.headers.get("x-relay-path") || "/";

  if (!target) {
    return new Response(JSON.stringify({ error: "Missing x-relay-target header" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const targetUrl = target.replace(/\\/$/, "") + relayPath;
  const newHeaders = new Headers(request.headers);
  newHeaders.delete("x-relay-target");
  newHeaders.delete("x-relay-path");
  newHeaders.delete("host");

  const init = {
    method: request.method,
    headers: newHeaders,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }

  try {
    const response = await fetch(targetUrl, init);
    const proxiedHeaders = new Headers(response.headers);
    proxiedHeaders.set("x-relay-proxied", "1");
    return new Response(response.body, {
      status: response.status,
      headers: proxiedHeaders,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
});`;

/** Netlify Lambda-runtime function source (`exports.handler(event)` with string body). */
export const NETLIFY_RELAY_FUNCTION = `exports.handler = async (event) => {
  const headers = {};
  for (const [k, v] of Object.entries(event.headers || {})) {
    headers[k.toLowerCase()] = v;
  }

  const target = headers["x-relay-target"];
  const relayPath = headers["x-relay-path"] || "/";

  if (!target) {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Missing x-relay-target header" }),
    };
  }

  const targetUrl = target.replace(/\\/$/, "") + relayPath;
  const forwardHeaders = { ...event.headers };
  for (const k of Object.keys(forwardHeaders)) {
    const lower = k.toLowerCase();
    if (lower === "x-relay-target" || lower === "x-relay-path" || lower === "host") {
      delete forwardHeaders[k];
    }
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: event.httpMethod,
      headers: forwardHeaders,
      body: event.httpMethod !== "GET" && event.httpMethod !== "HEAD" && event.body
        ? event.isBase64Encoded
          ? Buffer.from(event.body, "base64")
          : event.body
        : undefined,
    });
    // Lambda response body must be a string: returning the stream object
    // fails with cannot-unmarshal-object-into-Go-struct-field (live 502).
    // So buffer here: text for API payloads (JSON/SSE), base64 for binary.
    // Tradeoff vs the other relays: SSE arrives buffered, stays valid SSE.
    const responseHeaders = {};
    upstream.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    responseHeaders["x-relay-proxied"] = "1";
    const contentType = upstream.headers.get("content-type") || "";
    const isText = new RegExp("^(text/|[^;]*json|[^;]*event-stream|[^;]*javascript|[^;]*xml|[^;]*urlencoded)", "i").test(contentType);
    const rawBody = await upstream.arrayBuffer();
    const responseBody = isText
      ? Buffer.from(rawBody).toString("utf8")
      : Buffer.from(rawBody).toString("base64");
    return {
      statusCode: upstream.status,
      headers: responseHeaders,
      body: responseBody,
      isBase64Encoded: !isText,
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: error.message || "Relay fetch failed" }),
    };
  }
};
`;

/** Netlify site index page (rebranded to CCS; same HTML structure). */
export const NETLIFY_INDEX_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>CCS Relay</title></head>
<body><p>CCS relay function lives at <code>/.netlify/functions/relay</code>.</p></body></html>
`;
