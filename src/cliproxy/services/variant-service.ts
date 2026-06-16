/**
 * CLIProxy Variant Service
 *
 * Handles CRUD operations for CLIProxy variant profiles.
 * Supports both unified config (config.yaml) and legacy JSON format.
 */

import * as os from 'os';
import * as path from 'path';
import { CLIProxyProfileName } from '../../auth/profile-detector';
import { CLIProxyProvider, PLUS_ONLY_PROVIDERS } from '../types';
import { CompositeTierConfig, CompositeVariantConfig } from '../../config/unified-config-types';
import type { TargetType } from '../../targets/target-adapter';
import { isReservedName, isWindowsReservedName } from '../../config/reserved-names';

import { deleteConfigForPort } from '../config/config-generator';
import { hasActiveSessions, deleteSessionLockForPort } from '../session-tracker';
import { warn } from '../../utils/ui';

import { validateCompositeTiers } from '../config/composite-validator';
import {
  canonicalizeModelIdForProvider,
  getDeniedModelIdReasonForProvider,
} from '../ai-providers/model-id-normalizer';
import {
  createSettingsFile,
  createSettingsFileUnified,
  createCompositeSettingsFile,
  deleteSettingsFile,
  getRelativeSettingsPath,
  updateSettingsModel,
  updateSettingsProviderAndModel,
} from './variant-settings';
import {
  VariantConfig,
  variantExistsInConfig,
  listVariantsFromConfig,
  saveVariantUnified,
  saveVariantLegacy,
  saveCompositeVariantUnified,
  removeVariantFromUnifiedConfig,
  removeVariantFromLegacyConfig,
  getNextAvailablePort,
} from './variant-config-adapter';
import { getConfiguredBackend, getPlusBackendUnavailableMessage } from '../binary-manager';
import { getCcsDir, isUnifiedMode } from '../../config/config-loader-facade';

// Re-export VariantConfig from adapter
export type { VariantConfig } from './variant-config-adapter';

/** Result of variant operations */
export interface VariantOperationResult {
  success: boolean;
  error?: string;
  variant?: VariantConfig;
  settingsPath?: string;
}

/**
 * Validate CLIProxy profile name
 */
export function validateProfileName(name: string): string | null {
  if (!name) {
    return 'Profile name is required';
  }
  if (!/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(name)) {
    return 'Name must start with letter, contain only letters, numbers, dot, dash, underscore';
  }
  if (name.length > 32) {
    return 'Name must be 32 characters or less';
  }
  if (isReservedName(name)) {
    return `'${name}' is a reserved name`;
  }
  if (isWindowsReservedName(name)) {
    return `'${name}' is a Windows reserved device name and cannot be used`;
  }
  return null;
}

/**
 * Validate provider/backend compatibility
 * Returns an error message if a provider requires Plus while local CLIProxy is
 * configured for the default original backend.
 */
export function validateProviderBackend(provider: CLIProxyProfileName): string | null {
  // Normalize provider to lowercase for case-insensitive comparison
  const normalizedProvider = provider.toLowerCase() as CLIProxyProvider;
  const backend = getConfiguredBackend();
  if (backend === 'original' && PLUS_ONLY_PROVIDERS.includes(normalizedProvider)) {
    return getPlusBackendUnavailableMessage(provider);
  }
  return null;
}

/**
 * Check if CLIProxy variant profile exists
 */
export function variantExists(name: string): boolean {
  return variantExistsInConfig(name);
}

/**
 * List all CLIProxy variants
 */
export function listVariants(): Record<string, VariantConfig> {
  return listVariantsFromConfig();
}

/**
 * Create a new CLIProxy variant
 */
export function createVariant(
  name: string,
  provider: CLIProxyProfileName,
  model: string,
  account?: string,
  target: TargetType = 'claude'
): VariantOperationResult {
  try {
    const canonicalModel = canonicalizeModelIdForProvider(model, provider);
    const deniedModelReason = getDeniedModelIdReasonForProvider(canonicalModel, provider);
    if (deniedModelReason) {
      return { success: false, error: deniedModelReason };
    }

    // Validate provider/backend compatibility (block kiro/ghcp on original backend)
    const backendError = validateProviderBackend(provider);
    if (backendError) {
      return { success: false, error: backendError };
    }

    // Allocate unique port for this variant
    const port = getNextAvailablePort();

    let settingsPath: string;

    if (isUnifiedMode()) {
      settingsPath = createSettingsFileUnified(name, provider, canonicalModel, port);
      saveVariantUnified(
        name,
        provider as CLIProxyProvider,
        getRelativeSettingsPath(provider, name),
        account,
        port,
        target
      );
    } else {
      settingsPath = createSettingsFile(name, provider, canonicalModel, port);
      saveVariantLegacy(
        name,
        provider,
        `~/.ccs/${path.basename(settingsPath)}`,
        account,
        port,
        target
      );
    }

    return {
      success: true,
      settingsPath,
      variant: { provider, model: canonicalModel, account, port, target },
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Remove a CLIProxy variant
 */
export function removeVariant(name: string): VariantOperationResult {
  try {
    // First check if variant exists and has active sessions
    const variants = listVariantsFromConfig();
    const existingVariant = variants[name];

    if (!existingVariant) {
      return { success: false, error: `Variant '${name}' not found` };
    }

    // Check for active sessions on this variant's port before deletion
    if (existingVariant.port && hasActiveSessions(existingVariant.port)) {
      return {
        success: false,
        error: `Cannot delete variant '${name}': CLIProxy is running with active sessions. Stop the session first.`,
      };
    }

    let variant: VariantConfig | null;

    if (isUnifiedMode()) {
      const unifiedVariant = removeVariantFromUnifiedConfig(name);
      if (unifiedVariant?.settings) {
        deleteSettingsFile(unifiedVariant.settings);
      }
      // Clean up port-specific config and session files
      if (unifiedVariant?.port) {
        deleteConfigForPort(unifiedVariant.port);
        deleteSessionLockForPort(unifiedVariant.port);
      }
      variant = unifiedVariant;
    } else {
      variant = removeVariantFromLegacyConfig(name);
      if (variant?.settings) {
        deleteSettingsFile(variant.settings);
      }
      // Clean up port-specific config and session files
      if (variant?.port) {
        deleteConfigForPort(variant.port);
        deleteSessionLockForPort(variant.port);
      }
    }

    return { success: true, variant: variant ?? undefined };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/** Update options for variant */
export interface UpdateVariantOptions {
  provider?: CLIProxyProfileName;
  account?: string;
  model?: string;
  target?: TargetType;
}

/**
 * Update an existing CLIProxy variant
 */
export function updateVariant(name: string, updates: UpdateVariantOptions): VariantOperationResult {
  try {
    const variants = listVariantsFromConfig();
    const existing = variants[name];

    if (!existing) {
      return { success: false, error: `Variant '${name}' not found` };
    }

    if (existing.type === 'composite') {
      console.log(
        warn(
          'Cannot update composite variant properties directly. Remove and recreate, or edit config.yaml.'
        )
      );
      return { success: false, error: 'Composite variant update not supported' };
    }

    const providerChanged =
      updates.provider !== undefined && updates.provider !== existing.provider;
    const existingTarget = existing.target || 'claude';
    const targetChanged = updates.target !== undefined && updates.target !== existingTarget;
    const hasModelUpdate = updates.model !== undefined && updates.model.trim().length > 0;
    const providerForModelUpdate = (updates.provider ?? existing.provider) as CLIProxyProfileName;
    const canonicalModelUpdate =
      updates.model !== undefined
        ? canonicalizeModelIdForProvider(updates.model.trim(), providerForModelUpdate)
        : undefined;

    if (providerChanged && !hasModelUpdate) {
      return {
        success: false,
        error: 'Changing provider requires model update in the same request',
      };
    }

    if (hasModelUpdate) {
      const deniedModelReason = getDeniedModelIdReasonForProvider(
        canonicalModelUpdate || '',
        providerForModelUpdate
      );
      if (deniedModelReason) {
        return { success: false, error: deniedModelReason };
      }
    }

    if (updates.provider !== undefined) {
      const backendError = validateProviderBackend(updates.provider);
      if (backendError) {
        return { success: false, error: backendError };
      }
    }

    // Update settings file
    if (existing.settings) {
      const settingsPath = existing.settings.replace(/^~/, os.homedir());
      if (providerChanged) {
        updateSettingsProviderAndModel(
          settingsPath,
          updates.provider as CLIProxyProfileName,
          canonicalModelUpdate || '',
          existing.port
        );
      } else if (updates.model !== undefined) {
        updateSettingsModel(
          settingsPath,
          canonicalModelUpdate || '',
          existing.provider as CLIProxyProfileName
        );
      }
    }

    // Update config entry if provider/account/target changed
    if (updates.provider !== undefined || updates.account !== undefined || targetChanged) {
      const newProvider = updates.provider ?? existing.provider;
      const newAccount = updates.account !== undefined ? updates.account : existing.account;
      const newTarget = updates.target ?? existingTarget;

      if (isUnifiedMode()) {
        saveVariantUnified(
          name,
          newProvider as CLIProxyProvider,
          existing.settings || '',
          newAccount || undefined,
          existing.port,
          newTarget
        );
      } else {
        saveVariantLegacy(
          name,
          newProvider,
          existing.settings || '',
          newAccount || undefined,
          existing.port,
          newTarget
        );
      }
    }

    return {
      success: true,
      variant: {
        provider: updates.provider ?? existing.provider,
        model: canonicalModelUpdate || existing.model,
        account: updates.account !== undefined ? updates.account : existing.account,
        port: existing.port,
        settings: existing.settings,
        target: updates.target ?? existingTarget,
      },
    };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/** Composite variant creation options */
export interface CreateCompositeVariantOptions {
  name: string;
  defaultTier: 'opus' | 'sonnet' | 'haiku';
  target?: TargetType;
  tiers: {
    opus: CompositeTierConfig;
    sonnet: CompositeTierConfig;
    haiku: CompositeTierConfig;
  };
}

/**
 * Create a new composite CLIProxy variant.
 * Mixes different providers per tier using CLIProxyAPI root endpoints.
 */
export function createCompositeVariant(
  options: CreateCompositeVariantOptions
): VariantOperationResult {
  if (!isUnifiedMode()) {
    throw new Error(
      'Composite variants require unified config (config.yaml). Migrate from the dashboard settings first.'
    );
  }

  try {
    const { name, defaultTier, tiers, target = 'claude' } = options;

    const validationError = validateCompositeTiers(tiers, {
      defaultTier,
      requireAllTiers: true,
    });
    if (validationError) {
      return { success: false, error: validationError };
    }

    // Validate all tier providers against backend compatibility
    const tierNames: Array<'opus' | 'sonnet' | 'haiku'> = ['opus', 'sonnet', 'haiku'];
    for (const tier of tierNames) {
      const backendError = validateProviderBackend(tiers[tier].provider);
      if (backendError) {
        return { success: false, error: `${tier} tier: ${backendError}` };
      }
    }

    // Allocate unique port for this composite variant
    const port = getNextAvailablePort();

    // Create settings file with root URL + per-tier models
    const settingsPath = createCompositeSettingsFile(name, tiers, defaultTier, port);

    // Save composite config to unified config
    const compositeConfig: CompositeVariantConfig = {
      type: 'composite',
      default_tier: defaultTier,
      tiers,
      settings: settingsPath,
      port,
      ...(target !== 'claude' && { target }),
    };
    saveCompositeVariantUnified(name, compositeConfig);

    return {
      success: true,
      settingsPath,
      variant: {
        provider: tiers[defaultTier].provider,
        type: 'composite',
        default_tier: defaultTier,
        tiers,
        port,
        target,
      },
    };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/** Update options for composite variant */
export interface UpdateCompositeVariantOptions {
  defaultTier?: 'opus' | 'sonnet' | 'haiku';
  tiers?: Partial<Record<'opus' | 'sonnet' | 'haiku', CompositeTierConfig>>;
  target?: TargetType;
}

/**
 * Update an existing composite CLIProxy variant.
 * Merges changes with existing config and regenerates settings file.
 */
export function updateCompositeVariant(
  name: string,
  updates: UpdateCompositeVariantOptions
): VariantOperationResult {
  if (!isUnifiedMode()) {
    throw new Error('Composite variants require unified config (config.yaml).');
  }

  try {
    const variants = listVariantsFromConfig();
    const existing = variants[name];

    if (!existing) {
      return { success: false, error: `Variant '${name}' not found` };
    }

    if (existing.type !== 'composite' || !existing.tiers) {
      return { success: false, error: `Variant '${name}' is not a composite variant` };
    }

    // Deep merge tiers to preserve optional fields (fallback, thinking, account)
    const mergedTiers = {
      opus: { ...existing.tiers.opus, ...updates.tiers?.opus },
      sonnet: { ...existing.tiers.sonnet, ...updates.tiers?.sonnet },
      haiku: { ...existing.tiers.haiku, ...updates.tiers?.haiku },
    };

    const newDefaultTier = updates.defaultTier ?? existing.default_tier ?? 'sonnet';
    const existingTarget = existing.target || 'claude';
    const newTarget = updates.target ?? existingTarget;
    const validationError = validateCompositeTiers(mergedTiers, {
      defaultTier: newDefaultTier,
      requireAllTiers: true,
    });
    if (validationError) {
      return { success: false, error: validationError };
    }

    // Validate all tier providers against backend compatibility
    const tierNames: Array<'opus' | 'sonnet' | 'haiku'> = ['opus', 'sonnet', 'haiku'];
    for (const tier of tierNames) {
      const backendError = validateProviderBackend(mergedTiers[tier].provider);
      if (backendError) {
        return { success: false, error: `${tier} tier: ${backendError}` };
      }
    }

    // Preserve existing settings path when configured; otherwise use default path.
    const settingsRef =
      existing.settings || path.join(getCcsDir(), `composite-${name}.settings.json`);

    // Create new settings file with updated config
    const settingsPath = createCompositeSettingsFile(
      name,
      mergedTiers,
      newDefaultTier,
      existing.port,
      settingsRef
    );

    // Save updated composite config to unified config
    const compositeConfig: CompositeVariantConfig = {
      type: 'composite',
      default_tier: newDefaultTier,
      tiers: mergedTiers,
      settings: settingsRef,
      port: existing.port,
      ...(newTarget !== 'claude' && { target: newTarget }),
    };
    saveCompositeVariantUnified(name, compositeConfig);

    return {
      success: true,
      settingsPath,
      variant: {
        provider: mergedTiers[newDefaultTier].provider,
        type: 'composite',
        default_tier: newDefaultTier,
        tiers: mergedTiers,
        port: existing.port,
        settings: settingsRef,
        target: newTarget,
      },
    };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
