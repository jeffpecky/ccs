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

/** Public URL of the active relay, or null when none is active. */
export function getActiveRelayUrl(): string | null {
  const { relays, activeId } = getRelayConfig();
  if (!activeId) return null;
  return relays.find((relay) => relay.id === activeId)?.url ?? null;
}

/** Create a fresh relay entry for a just-completed deployment. */
export function createRelayEntry(
  platform: RelayPlatform,
  name: string,
  url: string
): RelayEntry {
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
export async function testRelay(
  url: string,
  timeoutMs = 10000
): Promise<RelayTestResult> {
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
