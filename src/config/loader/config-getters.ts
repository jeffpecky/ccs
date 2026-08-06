/**
 * config-getters.ts
 *
 * Typed sub-config accessor functions extracted from unified-config-loader.ts
 * (Phase 5 split — issue #1164).
 *
 * All functions read the loaded config via loadOrCreateUnifiedConfig and
 * return typed sub-configs with defaults applied.
 *
 * No I/O beyond what loadOrCreateUnifiedConfig performs internally.
 */

import {
  DEFAULT_CLIPROXY_SAFETY_CONFIG,
  DEFAULT_CURSOR_CONFIG,
  DEFAULT_GLOBAL_ENV,
  DEFAULT_LOGGING_CONFIG,
  DEFAULT_OFFICIAL_CHANNELS_CONFIG,
  DEFAULT_THINKING_CONFIG,
} from '../unified-config-types';
import type {
  BrowserConfig,
  CLIProxySafetyConfig,
  CursorConfig,
  DashboardAuthConfig,
  GlobalEnvConfig,
  LoggingConfig,
  OfficialChannelsConfig,
  ThinkingConfig,
} from '../unified-config-types';
import { canonicalizeBrowserConfig } from './normalizers';
import { normalizeOfficialChannelIds } from '../../channels/official-channels-ids';

// ---------------------------------------------------------------------------
// Circular-import safety: loadOrCreateUnifiedConfig lives in
// unified-config-loader.ts which imports this file. We break the cycle by
// using a lazy require() inside getConfig() so the module is resolved at
// call time (after both modules have finished loading) rather than at import
// time. This also preserves spy/mock compatibility: test spies replace the
// function on the module namespace object, and require() returns that live
// namespace, so the spy is always picked up.
// ---------------------------------------------------------------------------

function getConfig(): import('../unified-config-types').UnifiedConfig {
  const loader = require('../unified-config-loader') as {
    loadOrCreateUnifiedConfig: () => import('../unified-config-types').UnifiedConfig;
  };
  return loader.loadOrCreateUnifiedConfig();
}

// ---------------------------------------------------------------------------
// Accessor functions
// ---------------------------------------------------------------------------

/**
 * Get global_env configuration.
 * Returns defaults if not configured.
 */
export function getGlobalEnvConfig(): GlobalEnvConfig {
  const config = getConfig();
  return {
    enabled: config.global_env?.enabled ?? true,
    env: config.global_env?.env ?? { ...DEFAULT_GLOBAL_ENV },
  };
}

/**
 * Get continuity inheritance mapping.
 * Returns empty mapping when not configured.
 */
export function getContinuityInheritanceMap(): Record<string, string> {
  const config = getConfig();
  return config.continuity?.inherit_from_account ?? {};
}

/**
 * Get cliproxy safety configuration.
 * Returns defaults if not configured.
 */
export function getCliproxySafetyConfig(): CLIProxySafetyConfig {
  const config = getConfig();
  return {
    antigravity_ack_bypass:
      config.cliproxy?.safety?.antigravity_ack_bypass ??
      DEFAULT_CLIPROXY_SAFETY_CONFIG.antigravity_ack_bypass,
  };
}

/**
 * Get thinking configuration.
 * Returns defaults if not configured.
 */
export function getThinkingConfig(): ThinkingConfig {
  const config = getConfig();

  // W2: Check for invalid thinking config (e.g., thinking: true instead of object)
  if (config.thinking !== undefined && typeof config.thinking !== 'object') {
    console.warn(
      `[!] Invalid thinking config: expected object, got ${typeof config.thinking}. Using defaults.`
    );
    console.warn(`    Tip: Use 'thinking: { mode: auto }' instead of 'thinking: true'`);
    return DEFAULT_THINKING_CONFIG;
  }

  return {
    mode: config.thinking?.mode ?? DEFAULT_THINKING_CONFIG.mode,
    override: config.thinking?.override,
    tier_defaults: {
      opus: config.thinking?.tier_defaults?.opus ?? DEFAULT_THINKING_CONFIG.tier_defaults.opus,
      sonnet:
        config.thinking?.tier_defaults?.sonnet ?? DEFAULT_THINKING_CONFIG.tier_defaults.sonnet,
      haiku: config.thinking?.tier_defaults?.haiku ?? DEFAULT_THINKING_CONFIG.tier_defaults.haiku,
    },
    provider_overrides: config.thinking?.provider_overrides,
    show_warnings: config.thinking?.show_warnings ?? DEFAULT_THINKING_CONFIG.show_warnings,
  };
}

/**
 * Get Official Channels configuration.
 * Returns defaults if not configured.
 */
export function getOfficialChannelsConfig(): OfficialChannelsConfig {
  const config = getConfig();

  return {
    selected:
      config.channels?.selected && config.channels.selected.length > 0
        ? normalizeOfficialChannelIds(config.channels.selected)
        : DEFAULT_OFFICIAL_CHANNELS_CONFIG.selected,
    unattended: config.channels?.unattended ?? DEFAULT_OFFICIAL_CHANNELS_CONFIG.unattended,
  };
}

/**
 * Check if dashboard auth is enabled.
 * Priority: ENV vars > config.yaml > defaults
 */
export function isDashboardAuthEnabled(): boolean {
  const envEnabled = process.env.CCS_DASHBOARD_AUTH_ENABLED;

  if (envEnabled !== undefined) {
    return envEnabled === 'true' || envEnabled === '1';
  }

  const config = getConfig();
  return config.dashboard_auth?.enabled ?? false;
}

/**
 * Get dashboard_auth configuration with ENV var override.
 * Priority: ENV vars > config.yaml > defaults
 */
export function getDashboardAuthConfig(): DashboardAuthConfig {
  const config = getConfig();

  // ENV vars take precedence
  const envEnabled = process.env.CCS_DASHBOARD_AUTH_ENABLED;
  const envUsername = process.env.CCS_DASHBOARD_USERNAME;
  const envPasswordHash = process.env.CCS_DASHBOARD_PASSWORD_HASH;

  return {
    enabled:
      envEnabled !== undefined
        ? envEnabled === 'true' || envEnabled === '1'
        : (config.dashboard_auth?.enabled ?? false),
    username: envUsername ?? config.dashboard_auth?.username ?? '',
    password_hash: envPasswordHash ?? config.dashboard_auth?.password_hash ?? '',
    session_timeout_hours: config.dashboard_auth?.session_timeout_hours ?? 24,
  };
}

/**
 * Get browser automation configuration.
 * Returns canonicalized defaults if not configured.
 */
export function getBrowserConfig(): BrowserConfig {
  const config = getConfig();
  return canonicalizeBrowserConfig(config.browser);
}

/**
 * Get logging configuration.
 * Returns defaults if not configured.
 */
export function getLoggingConfig(): LoggingConfig {
  const config = getConfig();

  return {
    enabled: config.logging?.enabled ?? DEFAULT_LOGGING_CONFIG.enabled,
    level: config.logging?.level ?? DEFAULT_LOGGING_CONFIG.level,
    rotate_mb: config.logging?.rotate_mb ?? DEFAULT_LOGGING_CONFIG.rotate_mb,
    retain_days: config.logging?.retain_days ?? DEFAULT_LOGGING_CONFIG.retain_days,
    redact: config.logging?.redact ?? DEFAULT_LOGGING_CONFIG.redact,
    live_buffer_size: config.logging?.live_buffer_size ?? DEFAULT_LOGGING_CONFIG.live_buffer_size,
  };
}

/**
 * Get cursor configuration.
 * Returns defaults if not configured.
 */
export function getCursorConfig(): CursorConfig {
  const config = getConfig();
  return config.cursor ?? { ...DEFAULT_CURSOR_CONFIG };
}
