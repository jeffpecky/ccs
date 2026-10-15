/**
 * OpenRouter Model Catalog Utilities
 * Search, filter, pricing, and categorization
 */

import type { OpenRouterModel, CategorizedModel, ModelCategory } from './openrouter-types';
import i18n from './i18n';

const CACHE_KEY = 'ccs:openrouter-models';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_VERSION = '1';

/** Convert per-token price to per-million */
export function pricePerMillion(perToken: string): number {
  const value = parseFloat(perToken);
  if (isNaN(value) || value === 0) return 0;
  return value * 1_000_000;
}

/** Format price for display */
export function formatPrice(perToken: string): string {
  const perMillion = pricePerMillion(perToken);
  if (perMillion === 0) return i18n.t('openrouterUtils.priceFree');
  if (perMillion < 0.01) return i18n.t('openrouterUtils.priceLessThanCent');
  if (perMillion < 1) return `$${perMillion.toFixed(2)}`;
  return `$${perMillion.toFixed(perMillion < 10 ? 2 : 0)}`;
}

/** Format pricing pair (prompt/completion) */
export function formatPricingPair(pricing: { prompt: string; completion: string }): string {
  const promptPrice = formatPrice(pricing.prompt);
  const completionPrice = formatPrice(pricing.completion);
  if (
    promptPrice === i18n.t('openrouterUtils.priceFree') &&
    completionPrice === i18n.t('openrouterUtils.priceFree')
  )
    return i18n.t('openrouterUtils.priceFree');
  return `${promptPrice}/${completionPrice}`;
}

/** Categorize model by provider */
export function categorizeModel(model: OpenRouterModel): ModelCategory {
  const id = model.id.toLowerCase();
  if (id.startsWith('anthropic/')) return 'anthropic';
  if (id.startsWith('openai/')) return 'openai';
  if (id.startsWith('google/')) return 'google';
  if (id.startsWith('meta-llama/') || id.startsWith('meta/')) return 'meta';
  if (id.startsWith('mistralai/')) return 'mistral';
  // Open source indicators
  if (id.includes(':free') || id.includes('qwen') || id.includes('deepseek')) return 'opensource';
  return 'other';
}

/** Enrich model with computed fields */
export function enrichModel(model: OpenRouterModel): CategorizedModel {
  return {
    ...model,
    category: categorizeModel(model),
    pricePerMillionPrompt: pricePerMillion(model.pricing.prompt),
    pricePerMillionCompletion: pricePerMillion(model.pricing.completion),
    isFree: model.pricing.prompt === '0' && model.pricing.completion === '0',
    isExacto: model.id.includes(':exacto'), // Exacto variants - optimized for agentic/tool use
  };
}

/** Search models by query */
export function searchModels(
  models: CategorizedModel[],
  query: string,
  filters?: {
    category?: ModelCategory;
    freeOnly?: boolean;
    minContext?: number;
  }
): CategorizedModel[] {
  const q = query.toLowerCase().trim();

  return models.filter((model) => {
    // Apply filters
    if (filters?.category && model.category !== filters.category) return false;
    if (filters?.freeOnly && !model.isFree) return false;
    if (filters?.minContext && model.context_length < filters.minContext) return false;

    // Search query
    if (!q) return true;
    return (
      model.id.toLowerCase().includes(q) ||
      model.name.toLowerCase().includes(q) ||
      model.description?.toLowerCase().includes(q)
    );
  });
}

/**
 * Sort models with priority: Free > Exacto > Regular
 * Within each tier, sort by name alphabetically
 */
export function sortModelsByPriority(models: CategorizedModel[]): CategorizedModel[] {
  return [...models].sort((a, b) => {
    // Priority 1: Free models first
    if (a.isFree && !b.isFree) return -1;
    if (!a.isFree && b.isFree) return 1;

    // Priority 2: Exacto models second (only if both not free)
    if (!a.isFree && !b.isFree) {
      if (a.isExacto && !b.isExacto) return -1;
      if (!a.isExacto && b.isExacto) return 1;
    }

    // Same tier: sort by name
    return a.name.localeCompare(b.name);
  });
}

/** Get cached models from localStorage */
export function getCachedModels(): OpenRouterModel[] | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;

    const data = JSON.parse(cached) as {
      models: OpenRouterModel[];
      fetchedAt: number;
      version: string;
    };

    // Check version
    if (data.version !== CACHE_VERSION) return null;

    // Check TTL
    if (Date.now() - data.fetchedAt > CACHE_TTL_MS) return null;

    return data.models;
  } catch {
    return null;
  }
}

/** Save models to localStorage cache */
export function setCachedModels(models: OpenRouterModel[]): void {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        models,
        fetchedAt: Date.now(),
        version: CACHE_VERSION,
      })
    );
  } catch {
    // Storage full or unavailable, ignore
  }
}

/** Clear cached models */
export function clearCachedModels(): void {
  localStorage.removeItem(CACHE_KEY);
}

/** Suggest tier mappings based on selected model */
export function suggestTierMappings(
  selectedModelId: string,
  allModels: CategorizedModel[]
): { opus?: string; sonnet?: string; haiku?: string } {
  // Extract provider prefix
  const [provider] = selectedModelId.split('/');
  if (!provider) return {};

  const providerModels = allModels.filter((m) => m.id.startsWith(`${provider}/`));
  if (providerModels.length === 0) return {};

  // Sort by price (expensive = opus, mid = sonnet, cheap = haiku)
  const sorted = [...providerModels].sort(
    (a, b) => b.pricePerMillionPrompt - a.pricePerMillionPrompt
  );

  // Simple heuristic: top 1/3 = opus, middle = sonnet, bottom = haiku
  const third = Math.ceil(sorted.length / 3);

  return {
    opus: sorted[0]?.id,
    sonnet: sorted[Math.min(third, sorted.length - 1)]?.id,
    haiku: sorted[sorted.length - 1]?.id,
  };
}

/** Format context length for display */
export function formatContextLength(length: number): string {
  if (length >= 1_000_000) return `${(length / 1_000_000).toFixed(1)}M`;
  if (length >= 1_000) return `${Math.round(length / 1_000)}K`;
  return String(length);
}

/** Category display names */
export const CATEGORY_LABELS: Record<ModelCategory, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
  google: 'Google (Gemini)',
  meta: 'Meta (Llama)',
  mistral: 'Mistral',
  opensource: 'Open Source',
  other: 'Other',
};

/** Provider prefixes for detecting newest models */
const PROVIDER_PREFIXES: Record<ModelCategory, string[]> = {
  anthropic: ['anthropic/'],
  openai: ['openai/'],
  google: ['google/'],
  meta: ['meta-llama/', 'meta/'],
  mistral: ['mistralai/'],
  opensource: ['deepseek/', 'qwen/', 'cohere/'],
  other: [],
};

/** Get the newest models per provider (sorted by created timestamp) */
export function getNewestModelsPerProvider(
  allModels: CategorizedModel[],
  modelsPerProvider: number = 2
): CategorizedModel[] {
  const result: CategorizedModel[] = [];
  const categories: ModelCategory[] = [
    'anthropic',
    'openai',
    'google',
    'meta',
    'mistral',
    'opensource',
  ];

  for (const category of categories) {
    const prefixes = PROVIDER_PREFIXES[category];
    if (prefixes.length === 0) continue;

    // Get models for this provider
    const providerModels = allModels.filter((m) =>
      prefixes.some((prefix) => m.id.toLowerCase().startsWith(prefix))
    );

    // Sort by created timestamp (newest first)
    const sorted = [...providerModels].sort((a, b) => (b.created ?? 0) - (a.created ?? 0));

    // Take top N
    result.push(...sorted.slice(0, modelsPerProvider));
  }

  // Sort final result by created (newest first)
  return result.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
}

/** Format relative time for model creation date */
export function formatModelAge(created: number): string {
  const now = Date.now() / 1000; // Convert to seconds
  const diff = now - created;

  if (diff < 86400) return i18n.t('openrouterUtils.ageToday');
  if (diff < 172800) return i18n.t('openrouterUtils.ageYesterday');
  if (diff < 604800)
    return i18n.t('openrouterUtils.ageDaysAgo', { count: Math.floor(diff / 86400) });
  if (diff < 2592000)
    return i18n.t('openrouterUtils.ageWeeksAgo', { count: Math.floor(diff / 604800) });
  if (diff < 31536000)
    return i18n.t('openrouterUtils.ageMonthsAgo', { count: Math.floor(diff / 2592000) });
  return i18n.t('openrouterUtils.ageYearsAgo', { count: Math.floor(diff / 31536000) });
}
