import { getActiveRelayUrl } from './relay-service';

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname.startsWith('127.') ||
    hostname.startsWith('[::1')
  );
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
  const relay = new URL(relayUrl);
  if (relay.host === target.host) {
    return fetch(input, init);
  }
  const headers = new Headers(init?.headers);
  headers.set('x-relay-target', target.origin);
  headers.set('x-relay-path', target.pathname + target.search);
  return fetch(`${relay.origin}${target.pathname}${target.search}`, { ...init, headers });
}
