/**
 * Token Refresh Configuration
 *
 * Loads token refresh worker settings from unified config.
 * Enabled by default unless explicitly disabled.
 */

import type { TokenRefreshSettings } from '../../config/unified-config-types';
import { loadOrCreateUnifiedConfig } from '../../config/config-loader-facade';

/**
 * Get token refresh configuration from unified config
 * @returns Config if enabled, null if explicitly disabled
 */
export function getTokenRefreshConfig(): TokenRefreshSettings | null {
  const config = loadOrCreateUnifiedConfig();

  // Return null if explicitly disabled
  if (config.cliproxy?.token_refresh?.enabled === false) {
    return null;
  }

  // Return config with defaults (enabled by default)
  return {
    enabled: true,
    interval_minutes: config.cliproxy?.token_refresh?.interval_minutes ?? 5,
    preemptive_minutes: config.cliproxy?.token_refresh?.preemptive_minutes ?? 30,
    max_retries: config.cliproxy?.token_refresh?.max_retries ?? 3,
    verbose: config.cliproxy?.token_refresh?.verbose ?? false,
  };
}
