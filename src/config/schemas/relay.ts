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
  /**
   * Manually paused: kept on the dashboard but excluded from the rotation
   * pool (and from per-provider pins) until resumed. Absent means active.
   */
  paused?: boolean;
}

/**
 * How the proxy picks among the relays it may use.
 *
 * - `round-robin` (default): rotate the starting relay per request across the
 *   healthy pool.
 * - `random`: pick a uniformly random starting relay per request.
 * - `none`: only the active relay (single `relay-url`, the legacy behavior).
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
  /** Rotation strategy across the healthy relay pool (default: 'round-robin') */
  strategy: RelayStrategy;
  /**
   * Fail closed when no healthy relay resolves: outbound HTTPS requests error
   * instead of quietly egressing from this machine's IP (default: false).
   */
  strict: boolean;
  /**
   * Per-provider relay pins: provider name -> relay id. A pinned provider
   * always uses that relay, bypassing the rotation pool. Pins pointing at a
   * deleted relay — or a paused one — are dropped at generation time.
   */
  providerRelayIds: Record<string, string>;
}

/**
 * Default rotation strategy: every healthy relay carries traffic. A missing
 * or empty `strategy` anywhere in the pipeline (hand-edited section, older
 * saved config) is normalized to this value, so relaying never silently
 * collapses back to a single relay.
 */
export const DEFAULT_RELAY_STRATEGY: RelayStrategy = 'round-robin';

/**
 * Default relay configuration.
 */
export const DEFAULT_RELAY_CONFIG: RelayConfig = {
  relays: [],
  activeId: null,
  strategy: DEFAULT_RELAY_STRATEGY,
  strict: false,
  providerRelayIds: {},
};

/** Relay strategies accepted by the API and the generator. */
export const RELAY_STRATEGIES: readonly RelayStrategy[] = ['none', 'round-robin', 'random'];

/**
 * Normalize a stored strategy value. Absent, null, blank, or unrecognized
 * values fall back to the default so a hand-edited section can never leave
 * the pool in an ambiguous state.
 */
export function normalizeRelayStrategy(value: string | null | undefined): RelayStrategy {
  const trimmed = value?.trim();
  return trimmed && RELAY_STRATEGIES.includes(trimmed as RelayStrategy)
    ? (trimmed as RelayStrategy)
    : DEFAULT_RELAY_STRATEGY;
}

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
    RELAY_PLATFORMS.includes(entry.platform as RelayPlatform) &&
    // A non-boolean pause flag (hand-edited `paused: "yes"`) fails like any
    // other malformed entry instead of silently reading as active.
    (entry.paused === undefined || typeof entry.paused === 'boolean')
  );
}

/**
 * Type guard for RelayConfig.
 * activeId / strategy / strict / providerRelayIds may be omitted in
 * hand-edited sections (the merger fills in the defaults). A blank or null
 * strategy counts as omitted — it must not reject the section, or the merger
 * would drop the deployed relay list along with it. An unrecognized non-blank
 * value still fails so a typo is surfaced instead of silently rotating.
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
      candidate.strategy === null ||
      (typeof candidate.strategy === 'string' &&
        (candidate.strategy.trim() === '' ||
          RELAY_STRATEGIES.includes(candidate.strategy as RelayStrategy)))) &&
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
