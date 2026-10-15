/**
 * Edge relay configuration types and defaults.
 *
 * Controls the deployed edge relay workers used for outbound traffic
 * and selection of the active relay.
 */

// ============================================================================
// RELAY CONFIGURATION
// ============================================================================

/**
 * Supported relay deployment platforms.
 */
export type RelayPlatform = 'vercel' | 'cloudflare' | 'deno' | 'netlify';

/**
 * A single deployed relay entry.
 */
export interface RelayEntry {
  /** Unique relay ID */
  id: string;
  /** Human-readable relay name */
  name: string;
  /** Deployment platform */
  platform: RelayPlatform;
  /** Relay base URL */
  url: string;
  /** ISO timestamp when the relay was created */
  createdAt: string;
  /** Last connectivity test result (default: 'untested') */
  testStatus?: 'ok' | 'fail' | 'untested';
  /** ISO timestamp of the last connectivity test */
  lastTestedAt?: string;
  /** Last connectivity test error message */
  lastError?: string | null;
}

/**
 * How the proxy picks among the relays it may use.
 *
 * - `none`: only the active relay (single `relay-url`, the legacy behavior).
 * - `round-robin`: rotate the starting relay per request across the healthy pool.
 * - `random`: pick a uniformly random starting relay per request.
 */
export type RelayStrategy = 'none' | 'round-robin' | 'random';

/**
 * Relay configuration section.
 * Lists deployed relays and the active relay for outbound traffic.
 */
export interface RelayConfig {
  /** Deployed relay entries */
  relays: RelayEntry[];
  /** ID of the active relay, or null when none is active */
  activeId: string | null;
  /** Rotation strategy across the healthy relay pool (default: 'none') */
  strategy: RelayStrategy;
  /**
   * Fail closed when no healthy relay resolves: outbound HTTPS requests error
   * instead of quietly egressing from this machine's IP (default: false).
   */
  strict: boolean;
  /**
   * Per-provider relay pins: provider name -> relay id. A pinned provider
   * always uses that relay, bypassing the rotation pool. Pins pointing at a
   * deleted relay are dropped at generation time.
   */
  providerRelayIds: Record<string, string>;
}

/**
 * Default relay configuration.
 */
export const DEFAULT_RELAY_CONFIG: RelayConfig = {
  relays: [],
  activeId: null,
  strategy: 'none',
  strict: false,
  providerRelayIds: {},
};

/** Relay strategies accepted by the API and the generator. */
export const RELAY_STRATEGIES: readonly RelayStrategy[] = ['none', 'round-robin', 'random'];

/** Deployment platforms accepted by the relay API routes. */
export const RELAY_PLATFORMS: readonly RelayPlatform[] = [
  'vercel',
  'cloudflare',
  'deno',
  'netlify',
];

/**
 * Minimal per-entry validation: an object with string id, string url,
 * and a known deployment platform.
 */
function isRelayEntry(value: unknown): value is RelayEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<RelayEntry>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.url === 'string' &&
    typeof entry.platform === 'string' &&
    RELAY_PLATFORMS.includes(entry.platform as RelayPlatform)
  );
}

/**
 * Type guard for RelayConfig.
 * activeId / strategy / strict / providerRelayIds may be omitted in
 * hand-edited sections (the merger fills in the defaults).
 */
export function isRelayConfig(value: unknown): value is RelayConfig {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<RelayConfig>;
  return (
    Array.isArray(candidate.relays) &&
    candidate.relays.every(isRelayEntry) &&
    (candidate.activeId === null ||
      candidate.activeId === undefined ||
      typeof candidate.activeId === 'string') &&
    (candidate.strategy === undefined ||
      (typeof candidate.strategy === 'string' &&
        RELAY_STRATEGIES.includes(candidate.strategy as RelayStrategy))) &&
    (candidate.strict === undefined || typeof candidate.strict === 'boolean') &&
    (candidate.providerRelayIds === undefined || isRelayProviderPins(candidate.providerRelayIds))
  );
}

/**
 * Provider pins are a flat provider -> relay id map. Anything else (nested
 * objects, arrays, null) fails the guard so the merger drops the section
 * rather than emitting a map the Go side cannot read.
 */
function isRelayProviderPins(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((pin) => typeof pin === 'string');
}
