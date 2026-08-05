/**
 * Settings Page Types
 * Type definitions for GlobalEnv and Proxy configurations
 */

import type {
  CliproxyServerConfig,
  RemoteProxyStatus,
} from '@/lib/api-client';

// === GlobalEnv Types ===

export interface GlobalEnvConfig {
  enabled: boolean;
  env: Record<string, string>;
}

// === Tab Types ===

export type SettingsTab =
  | 'globalenv'
  | 'proxy'
  | 'auth'
  | 'backups'
  | 'thinking';

// === Thinking Types ===

export type ThinkingMode = 'auto' | 'off' | 'manual';

export interface ThinkingTierDefaults {
  opus: string;
  sonnet: string;
  haiku: string;
}

export interface ThinkingConfig {
  mode: ThinkingMode;
  override?: string | number;
  tier_defaults: ThinkingTierDefaults;
  provider_overrides?: Record<string, Partial<ThinkingTierDefaults>>;
  show_warnings?: boolean;
}

// === Re-exports from api-client ===

export type { CliproxyServerConfig, RemoteProxyStatus };
