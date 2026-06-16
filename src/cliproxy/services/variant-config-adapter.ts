import * as fs from 'fs';
import { getConfigPath } from '../../utils/config-manager';
import { CLIProxyProvider } from '../types';
import type { TargetType } from '../../targets/target-adapter';
import {
  CLIProxyVariantConfig,
  CompositeVariantConfig,
  CompositeTierConfig,
  CLIPROXY_SUPPORTED_PROVIDERS,
} from '../../config/unified-config-types';

import { CLIPROXY_DEFAULT_PORT } from '../config/config-generator';
import {
  isUnifiedMode,
  loadConfigSafe,
  loadOrCreateUnifiedConfig,
  mutateConfig,
} from '../../config/config-loader-facade';

export const VARIANT_PORT_BASE = CLIPROXY_DEFAULT_PORT + 1;
export const VARIANT_PORT_MAX_OFFSET = 100;
export interface VariantConfig {
  provider: string;
  settings?: string;
  account?: string;
  model?: string;
  port?: number;
  target?: TargetType;
  /** Composite variant fields */
  type?: 'composite';
  default_tier?: 'opus' | 'sonnet' | 'haiku';
  tiers?: {
    opus: CompositeTierConfig;
    sonnet: CompositeTierConfig;
    haiku: CompositeTierConfig;
  };
  /** Whether any tier has fallback configured */
  hasFallback?: boolean;
}

export function variantExistsInConfig(name: string): boolean {
  try {
    if (isUnifiedMode()) {
      const config = loadOrCreateUnifiedConfig();
      return !!(config.cliproxy?.variants && name in config.cliproxy.variants);
    }
    const config = loadConfigSafe();
    return !!(config.cliproxy && name in config.cliproxy);
  } catch {
    return false;
  }
}

export function getNextAvailablePort(): number {
  const variants = listVariantsFromConfig();
  const usedPorts = new Set<number>();

  for (const name of Object.keys(variants)) {
    const port = variants[name].port;
    if (port) usedPorts.add(port);
  }

  // Find first available port in range
  for (let offset = 0; offset < VARIANT_PORT_MAX_OFFSET; offset++) {
    const port = VARIANT_PORT_BASE + offset;
    if (!usedPorts.has(port)) {
      return port;
    }
  }

  const variantCount = Object.keys(variants).length;
  throw new Error(
    `Port limit reached (${variantCount}/${VARIANT_PORT_MAX_OFFSET} variants). ` +
      `Delete unused variants from the dashboard to free ports.`
  );
}

export function listVariantsFromConfig(): Record<string, VariantConfig> {
  try {
    if (isUnifiedMode()) {
      const unifiedConfig = loadOrCreateUnifiedConfig();
      const variants = unifiedConfig.cliproxy?.variants || {};
      const result: Record<string, VariantConfig> = {};
      for (const [name, variantConfig] of Object.entries(variants)) {
        try {
          if ('type' in variantConfig && variantConfig.type === 'composite') {
            const composite = variantConfig as CompositeVariantConfig;
            const tiers = composite.tiers as Partial<{
              opus: CompositeTierConfig;
              sonnet: CompositeTierConfig;
              haiku: CompositeTierConfig;
            }> | null;

            if (!tiers || !tiers.opus || !tiers.sonnet || !tiers.haiku || !composite.default_tier) {
              console.warn(
                `[!] Skipping malformed composite variant '${name}': missing required tier configuration`
              );
              continue;
            }

            const defaultTierConfig = tiers[composite.default_tier];
            if (!defaultTierConfig) {
              console.warn(
                `[!] Skipping malformed composite variant '${name}': missing default tier '${composite.default_tier}'`
              );
              continue;
            }

            const normalizedTiers = {
              opus: tiers.opus,
              sonnet: tiers.sonnet,
              haiku: tiers.haiku,
            };

            const hasFallback = !!(
              normalizedTiers.opus.fallback ||
              normalizedTiers.sonnet.fallback ||
              normalizedTiers.haiku.fallback
            );

            result[name] = {
              provider: defaultTierConfig.provider,
              settings: composite.settings,
              port: composite.port,
              target: composite.target || 'claude',
              type: 'composite',
              default_tier: composite.default_tier,
              tiers: normalizedTiers,
              hasFallback,
            };
          } else {
            const single = variantConfig as CLIProxyVariantConfig;
            result[name] = {
              provider: single.provider,
              settings: single.settings,
              account: single.account,
              port: single.port,
              target: single.target || 'claude',
            };
          }
        } catch (error) {
          console.warn(
            `[!] Skipping malformed variant '${name}': ${(error as Error).message || 'invalid config'}`
          );
        }
      }
      return result;
    }

    const config = loadConfigSafe();
    const variants = config.cliproxy || {};
    const result: Record<string, VariantConfig> = {};
    for (const name of Object.keys(variants)) {
      const v = variants[name] as {
        provider: string;
        settings: string;
        account?: string;
        port?: number;
        target?: TargetType;
      };
      result[name] = {
        provider: v.provider,
        settings: v.settings,
        account: v.account,
        port: v.port,
        target: v.target || 'claude',
      };
    }
    return result;
  } catch {
    return {};
  }
}

export function saveCompositeVariantUnified(name: string, config: CompositeVariantConfig): void {
  mutateConfig((unifiedConfig) => {
    if (!unifiedConfig.cliproxy) {
      unifiedConfig.cliproxy = {
        oauth_accounts: {},
        providers: [...CLIPROXY_SUPPORTED_PROVIDERS],
        variants: {},
      };
    }
    if (!unifiedConfig.cliproxy.variants) {
      unifiedConfig.cliproxy.variants = {};
    }

    unifiedConfig.cliproxy.variants[name] = config;
  });
}

export function saveVariantUnified(
  name: string,
  provider: CLIProxyProvider,
  settingsPath: string,
  account?: string,
  port?: number,
  target: TargetType = 'claude'
): void {
  mutateConfig((config) => {
    if (!config.cliproxy) {
      config.cliproxy = {
        oauth_accounts: {},
        providers: [...CLIPROXY_SUPPORTED_PROVIDERS],
        variants: {},
      };
    }
    if (!config.cliproxy.variants) {
      config.cliproxy.variants = {};
    }

    config.cliproxy.variants[name] = {
      provider,
      account,
      settings: settingsPath,
      port,
      ...(target !== 'claude' && { target }),
    };
  });
}

export function saveVariantLegacy(
  name: string,
  provider: string,
  settingsPath: string,
  account?: string,
  port?: number,
  target: TargetType = 'claude'
): void {
  const configPath = getConfigPath();

  let config: { profiles: Record<string, string>; cliproxy?: Record<string, unknown> };
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    config = { profiles: {} };
  }

  if (!config.cliproxy) {
    config.cliproxy = {};
  }

  const variantConfig: {
    provider: string;
    settings: string;
    account?: string;
    port?: number;
    target?: TargetType;
  } = {
    provider,
    settings: settingsPath,
  };
  if (account) {
    variantConfig.account = account;
  }
  if (port) {
    variantConfig.port = port;
  }
  if (target !== 'claude') {
    variantConfig.target = target;
  }
  config.cliproxy[name] = variantConfig;

  const tempPath = configPath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  fs.renameSync(tempPath, configPath);
}

export function removeVariantFromUnifiedConfig(name: string): VariantConfig | null {
  let removedVariant: CLIProxyVariantConfig | CompositeVariantConfig | null = null;
  mutateConfig((config) => {
    if (!config.cliproxy?.variants || !(name in config.cliproxy.variants)) {
      return;
    }

    removedVariant = config.cliproxy.variants[name];
    delete config.cliproxy.variants[name];
  });

  if (!removedVariant) {
    return null;
  }

  const composite = removedVariant as CompositeVariantConfig;
  if (composite.type === 'composite') {
    return {
      provider: composite.tiers[composite.default_tier].provider,
      settings: composite.settings,
      port: composite.port,
      target: composite.target || 'claude',
      type: 'composite',
      default_tier: composite.default_tier,
      tiers: composite.tiers,
    };
  }
  const singleVariant = removedVariant as CLIProxyVariantConfig;
  return {
    provider: singleVariant.provider,
    settings: singleVariant.settings,
    port: singleVariant.port,
    target: singleVariant.target || 'claude',
  };
}

export function removeVariantFromLegacyConfig(name: string): VariantConfig | null {
  const configPath = getConfigPath();

  let config: { profiles: Record<string, string>; cliproxy?: Record<string, unknown> };
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }

  if (!config.cliproxy || !(name in config.cliproxy)) {
    return null;
  }

  const variant = config.cliproxy[name] as {
    provider: string;
    settings: string;
    port?: number;
    target?: TargetType;
  };
  delete config.cliproxy[name];

  if (Object.keys(config.cliproxy).length === 0) {
    delete config.cliproxy;
  }

  const tempPath = configPath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  fs.renameSync(tempPath, configPath);

  return variant;
}
