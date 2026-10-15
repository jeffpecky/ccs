/**
 * Relay storage/test service.
 *
 * Thin persistence + probe layer for edge relay configuration: reads/writes
 * the `relay` section of the unified config, resolves the active relay URL,
 * creates relay entries, and runs connectivity probes against deployed
 * relays. Deployment itself lives in ./deploy; route wiring lives in
 * ../web-server/routes/relay-routes.
 */

import { randomUUID } from 'node:crypto';

import { getRelayConfig, mutateConfig } from '../config/config-loader-facade';
import { DEFAULT_RELAY_CONFIG } from '../config/schemas/relay';
import type { RelayConfig, RelayEntry, RelayPlatform } from '../config/schemas/relay';

// Reuse the facade's getter (config-getters semantics: defaults when the
// relay section is absent) instead of duplicating it here.
export { getRelayConfig };

/** Result of a relay connectivity probe. */
export interface RelayTestResult {
  ok: boolean;
  status: number;
  error?: string;
  elapsedMs: number;
}

/**
 * Persist the relay section of the unified config.
 *
 * Prefer updateRelayConfig for read-modify-write flows: this replaces the
 * whole section with a snapshot the caller read earlier, so a concurrent
 * writer between the read and this call is clobbered.
 */
export function saveRelayConfig(next: RelayConfig): void {
  mutateConfig((config) => {
    config.relay = next;
  });
}

/**
 * Atomically read-modify-write the relay section under the config loader's
 * mutateConfig lock. The mutator sees the freshest config, so concurrent
 * writers (deploys, tests, activations) are never clobbered by a stale
 * snapshot.
 */
export function updateRelayConfig(update: (current: RelayConfig) => RelayConfig): void {
  mutateConfig((config) => {
    config.relay = update(config.relay ?? structuredClone(DEFAULT_RELAY_CONFIG));
  });
}

/**
 * Public URL of the active relay, or null when none is active.
 *
 * Accepts an optional config snapshot so callers (and tests) can resolve
 * against an already-loaded config; no-arg calls read the live config.
 */
export function getActiveRelayUrl(config: RelayConfig = getRelayConfig()): string | null {
  const { relays, activeId } = config;
  if (!activeId) return null;
  return relays.find((relay) => relay.id === activeId)?.url ?? null;
}

/**
 * Ordered relay URL candidates for the proxy's outbound egress.
 *
 * `none` keeps the legacy single-relay behavior: only the active relay
 * participates, so flipping the dashboard toggle is still a hard on/off. With a
 * rotation strategy every relay that is not known-failed becomes a candidate,
 * with the active relay first so it stays the preferred starting point.
 *
 * Health gating is deliberately one-directional: a relay last probed `fail` is
 * excluded (retrying it on every request would just add latency), while an
 * untested relay stays eligible because a freshly deployed worker has no probe
 * history yet. When every relay has failed the list is empty — the caller then
 * egresses direct, or fails closed when `strict` is set.
 */
export function resolveRelayCandidates(config: RelayConfig = getRelayConfig()): string[] {
  const active = config.activeId
    ? config.relays.find((relay) => relay.id === config.activeId)
    : undefined;

  // A section written before rotation existed (or by a hand-edit the merger
  // has not seen yet) has no strategy; treat it as the legacy single-relay mode
  // rather than quietly rotating.
  if ((config.strategy ?? 'none') === 'none') {
    return active ? [active.url] : [];
  }

  const healthy = config.relays.filter((relay) => relay.testStatus !== 'fail');
  const ordered =
    active && healthy.includes(active)
      ? [active, ...healthy.filter((relay) => relay !== active)]
      : healthy;
  return ordered.map((relay) => relay.url);
}

/**
 * Per-provider relay URL overrides for the proxy config.
 *
 * Only pins that still resolve to a deployed relay are emitted; a pin left
 * behind by a relay deletion is dropped rather than forwarded as a dangling
 * id (the Go side reads URLs, not ids).
 */
export function resolveProviderRelayUrls(
  config: RelayConfig = getRelayConfig()
): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const [provider, relayId] of Object.entries(config.providerRelayIds ?? {})) {
    const relay = config.relays.find((entry) => entry.id === relayId);
    if (relay) urls[provider] = relay.url;
  }
  return urls;
}

/** Create a fresh relay entry for a just-completed deployment. */
export function createRelayEntry(platform: RelayPlatform, name: string, url: string): RelayEntry {
  return {
    id: randomUUID(),
    name,
    platform,
    url,
    createdAt: new Date().toISOString(),
    testStatus: 'untested',
  };
}

/**
 * Probe a deployed relay the way 9Router does: GET the relay with
 * x-relay-target/x-relay-path headers and treat any HTTP response as a
 * live relay. Network errors and timeouts resolve to ok: false instead of
 * rejecting so callers can persist the failure.
 */
export async function testRelay(url: string, timeoutMs = 10000): Promise<RelayTestResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      headers: {
        'x-relay-target': 'https://httpbin.org',
        'x-relay-path': '/get',
      },
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    const err = error as Error;
    return {
      ok: false,
      status: 0,
      error: err.name === 'AbortError' ? 'Relay test timed out' : err.message,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}
