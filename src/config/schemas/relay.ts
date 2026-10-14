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
 * Relay configuration section.
 * Lists deployed relays and the active relay for outbound traffic.
 */
export interface RelayConfig {
  /** Deployed relay entries */
  relays: RelayEntry[];
  /** ID of the active relay, or null when none is active */
  activeId: string | null;
}

/**
 * Default relay configuration.
 */
export const DEFAULT_RELAY_CONFIG: RelayConfig = { relays: [], activeId: null };

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
 * activeId may be omitted in hand-edited sections (the merger fills in null).
 */
export function isRelayConfig(value: unknown): value is RelayConfig {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<RelayConfig>;
  return (
    Array.isArray(candidate.relays) &&
    candidate.relays.every(isRelayEntry) &&
    (candidate.activeId === null ||
      candidate.activeId === undefined ||
      typeof candidate.activeId === 'string')
  );
}
