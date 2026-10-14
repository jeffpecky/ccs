/**
 * OpenRouter Model Catalog Fetcher
 * Fetches model list from OpenRouter API for CLI use
 */

import * as fs from 'fs';
import * as path from 'path';
import { getCcsDir } from '../../config/config-loader-facade';
import { relayFetch } from '../../relay/relay-fetch';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/models';
function getCacheFile() {
  return path.join(getCcsDir(), 'openrouter-models-cache.json');
}
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface OpenRouterModel {
  id: string;
  name: string;
  description: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
  };
}

interface CacheData {
  models: OpenRouterModel[];
  fetchedAt: number;
}

/** Check if cached data is valid */
function getCachedModels(): OpenRouterModel[] | null {
  try {
    const cacheFile = getCacheFile();
    if (!fs.existsSync(cacheFile)) return null;
    const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as CacheData;
    if (Date.now() - data.fetchedAt > CACHE_TTL_MS) return null;
    return data.models;
  } catch {
    return null;
  }
}

/** Save models to cache */
function setCachedModels(models: OpenRouterModel[]): void {
  try {
    const cacheFile = getCacheFile();
    const dir = path.dirname(cacheFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      cacheFile,
      JSON.stringify({
        models,
        fetchedAt: Date.now(),
      })
    );
  } catch {
    // Ignore cache write errors
  }
}

/** Fetch models from OpenRouter API */
export async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  // Try cache first
  const cached = getCachedModels();
  if (cached) return cached;

  // Fetch from API
  const response = await relayFetch(OPENROUTER_API_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenRouter models: ${response.status}`);
  }

  const data = (await response.json()) as { data: OpenRouterModel[] };
  const models = data.data.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    context_length: m.context_length,
    pricing: m.pricing,
  }));

  // Cache for next time
  setCachedModels(models);

  return models;
}

/** Format price per token to per million */
export function formatPrice(perToken: string): string {
  const value = parseFloat(perToken);
  if (isNaN(value) || value === 0) return 'Free';
  const perMillion = value * 1_000_000;
  if (perMillion < 0.01) return '<$0.01';
  if (perMillion < 1) return `$${perMillion.toFixed(2)}`;
  return `$${perMillion.toFixed(perMillion < 10 ? 2 : 0)}`;
}

/** Format pricing pair */
export function formatPricingPair(pricing: { prompt: string; completion: string }): string {
  return `${formatPrice(pricing.prompt)}/${formatPrice(pricing.completion)}`;
}

/** Format context length */
export function formatContext(length: number): string {
  if (length >= 1_000_000) return `${(length / 1_000_000).toFixed(1)}M`;
  return `${Math.round(length / 1_000)}K`;
}

/** Search models */
export function searchModels(models: OpenRouterModel[], query: string): OpenRouterModel[] {
  if (!query.trim()) return models.slice(0, 20); // Show first 20 if no query
  const q = query.toLowerCase();
  return models
    .filter((m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
    .slice(0, 20); // Limit to 20 results
}

/** Check if URL is OpenRouter */
export function isOpenRouterUrl(url: string): boolean {
  return url.toLowerCase().includes('openrouter.ai');
}
