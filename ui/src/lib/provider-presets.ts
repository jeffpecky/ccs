/**
 * Provider Presets Configuration
 * Shared catalog from backend source-of-truth.
 */

import {
  OPENROUTER_BASE_URL,
  createProviderPresetDefinitions,
  normalizeProviderPresetId,
  type PresetCategory,
  type ProviderPresetDefinition,
} from '../../../src/shared/provider-preset-catalog';

export { OPENROUTER_BASE_URL };
export type { PresetCategory };

export type ProviderPreset = ProviderPresetDefinition;

const BASE_PROVIDER_PRESETS = createProviderPresetDefinitions();

export const PROVIDER_PRESETS: readonly ProviderPreset[] = Object.freeze(
  BASE_PROVIDER_PRESETS.map((preset) => ({ ...preset }))
);

export function resolvePresetApiKeyValue(
  preset: ProviderPreset | null | undefined,
  apiKey: string
): string {
  if (apiKey) {
    return apiKey;
  }

  if (preset?.requiresApiKey === false) {
    return preset.apiKeyPlaceholder || preset.id;
  }

  return '';
}

/** Get presets by category */
export function getPresetsByCategory(category: PresetCategory): ProviderPreset[] {
  return PROVIDER_PRESETS.filter((preset) => preset.category === category);
}

/** Get preset by ID (supports legacy aliases via shared alias map). */
export function getPresetById(id: string): ProviderPreset | undefined {
  const canonical = normalizeProviderPresetId(id);
  return PROVIDER_PRESETS.find((preset) => preset.id === canonical);
}

/** Check if a URL matches a known preset */
export function detectPresetFromUrl(baseUrl: string): ProviderPreset | undefined {
  const normalizedInput = baseUrl.trim().toLowerCase().replace(/\/+$/, '');
  if (!normalizedInput) {
    return undefined;
  }

  return PROVIDER_PRESETS.find((preset) => {
    const normalizedPresetUrl = preset.baseUrl.trim().toLowerCase().replace(/\/+$/, '');
    if (!normalizedPresetUrl) {
      return false;
    }
    return (
      normalizedInput === normalizedPresetUrl ||
      normalizedInput.startsWith(`${normalizedPresetUrl}/`)
    );
  });
}
