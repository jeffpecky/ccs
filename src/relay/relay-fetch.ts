import { getActiveRelayUrl } from './relay-service';

function isLoopback(hostname: string): boolean {
  // hostname always carries brackets for IPv6 ('[::1]'); anchored so public
  // domains like '127.example.com' are not misclassified as loopback.
  return /^(?:localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\])$/.test(hostname);
}

/**
 * fetch() wrapper for CCS-originated external calls. When a relay is active in
 * the dashboard, https calls to non-loopback hosts are forwarded through the
 * relay worker (x-relay-target + x-relay-path protocol). Everything else —
 * loopback, plain http, no active relay — is a plain fetch. Request instances
 * are passed through untouched (their bodies are one-shot streams).
 *
 * Deliberately NOT used for managed-quota traffic: the Go binary's api-call
 * covers that path via the Go relay (see the edge relay design doc). Loopback
 * callers (CLIProxy management API, Ollama readiness probes) and the binary
 * downloader stay on plain fetch as well.
 *
 * getActiveRelayUrl() with no args reads the live config per call — correct
 * here, since the hot path is external HTTP (one round-trip), not loopback.
 */
export async function relayFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  if (input instanceof Request) {
    // Request bodies are one-shot streams; relaying a pre-built Request would
    // require re-wrapping, so pass it through untouched.
    return fetch(input, init);
  }
  const relayUrl = getActiveRelayUrl();
  const target = new URL(typeof input === 'string' ? input : input.toString());
  if (!relayUrl || target.protocol !== 'https:' || isLoopback(target.hostname)) {
    return fetch(input, init);
  }
  let relay: URL;
  try {
    relay = new URL(relayUrl);
  } catch {
    throw new Error(
      `Active relay URL is invalid ("${relayUrl}") — fix or deactivate the relay in the dashboard`
    );
  }
  if (relay.host === target.host) {
    return fetch(input, init);
  }
  const headers = new Headers(init?.headers);
  headers.set('x-relay-target', target.origin);
  headers.set('x-relay-path', target.pathname + target.search);
  // Stored URL is origin for vercel/cloudflare/deno, origin + function path
  // for netlify — preserve the stored path so the worker is actually reached.
  const relayBase = relayUrl.replace(/\/+$/, '');
  // redirect: 'error' — the worker follows upstream redirects server-side, so
  // a 3xx here always means relay-infra misconfig; never follow it with the
  // x-relay-* headers attached.
  return fetch(`${relayBase}${target.pathname}${target.search}`, {
    ...init,
    headers,
    redirect: 'error',
  });
}
