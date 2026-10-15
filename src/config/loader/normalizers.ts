/**
 * normalizers.ts
 *
 * Input normalization and validation helpers extracted from
 * unified-config-loader.ts (Phase 2 split — issue #1164).
 *
 * Contains: session affinity TTL normalizer, composite variant validator, and
 * continuity config normalizer.
 */

import type { UnifiedConfig, ContinuityConfig } from '../unified-config-types';
import { validateCompositeTiers } from '../../cliproxy/config/composite-validator';
import { GO_DURATION_PATTERN, GO_DURATION_SEGMENT } from './io-locks';

// ---------------------------------------------------------------------------
// Session affinity TTL normalizer
// ---------------------------------------------------------------------------

export function normalizeSessionAffinityTtl(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed || !GO_DURATION_PATTERN.test(trimmed) || !hasPositiveDuration(trimmed)) {
    return fallback;
  }

  return trimmed;
}

export function hasPositiveDuration(value: string): boolean {
  const segments = value.match(new RegExp(GO_DURATION_SEGMENT, 'g'));
  if (!segments) {
    return false;
  }

  return segments.some((segment) => {
    const numeric = parseFloat(segment);
    return Number.isFinite(numeric) && numeric > 0;
  });
}

// ---------------------------------------------------------------------------
// Composite variant validator
// ---------------------------------------------------------------------------

/**
 * Validate composite variant provider strings.
 * Warns about invalid providers in composite variant configurations.
 */
export function validateCompositeVariants(config: UnifiedConfig): void {
  const variants = config.cliproxy?.variants;
  if (!variants) return;

  for (const [name, variant] of Object.entries(variants)) {
    if ('type' in variant && variant.type === 'composite') {
      const error = validateCompositeTiers(variant.tiers, {
        defaultTier: variant.default_tier,
        requireAllTiers: true,
      });
      if (error) {
        console.warn(`[!] Variant '${name}': invalid composite config (${error})`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Continuity config normalizer
// ---------------------------------------------------------------------------

/**
 * Normalize continuity inheritance mapping payload.
 * Keeps only non-empty string keys and values.
 */
export function normalizeContinuityInheritanceMap(
  value: unknown
): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const normalized: Record<string, string> = {};
  for (const [profileName, accountName] of Object.entries(value as Record<string, unknown>)) {
    const normalizedProfile = profileName.trim();
    const normalizedAccount = typeof accountName === 'string' ? accountName.trim() : '';

    if (!normalizedProfile || !normalizedAccount) {
      continue;
    }

    normalized[normalizedProfile] = normalizedAccount;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/**
 * Normalize continuity section.
 * Supports legacy root key: continuity_inherit_from_account.
 */
export function normalizeContinuityConfig(
  partial: Partial<UnifiedConfig>
): ContinuityConfig | undefined {
  const legacyMap = normalizeContinuityInheritanceMap(
    (partial as Partial<UnifiedConfig> & { continuity_inherit_from_account?: unknown })
      .continuity_inherit_from_account
  );
  const continuityMap = normalizeContinuityInheritanceMap(partial.continuity?.inherit_from_account);

  if (!legacyMap && !continuityMap) {
    return undefined;
  }

  return {
    inherit_from_account: {
      ...(legacyMap ?? {}),
      ...(continuityMap ?? {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Continuity config normalizer
// ---------------------------------------------------------------------------
