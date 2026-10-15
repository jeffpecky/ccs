/**
 * OpenRouter Models Hook
 * Fetches and caches OpenRouter model catalog
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { OpenRouterModel, CategorizedModel } from '@/lib/openrouter-types';
import {
  getCachedModels,
  setCachedModels,
  clearCachedModels,
  enrichModel,
} from '@/lib/openrouter-utils';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const QUERY_KEY = ['openrouter-models'];
const STALE_TIME = 24 * 60 * 60 * 1000; // 24 hours

async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
  const response = await fetch(OPENROUTER_MODELS_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenRouter models: ${response.status}`);
  }
  const data = (await response.json()) as { data: OpenRouterModel[] };
  const models = data.data;

  // Cache for offline use
  setCachedModels(models);

  return models;
}

export function useOpenRouterModels() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchOpenRouterModels,
    staleTime: STALE_TIME,
    gcTime: STALE_TIME,
    // Use cached data as initial data (instant display)
    initialData: () => getCachedModels() ?? undefined,
    // Don't refetch on window focus for this heavy payload
    refetchOnWindowFocus: false,
  });
}

/** Get enriched models with categories and pricing */
export function useOpenRouterCatalog() {
  const query = useOpenRouterModels();

  const enrichedModels: CategorizedModel[] = (query.data ?? []).map(enrichModel);

  return {
    ...query,
    models: enrichedModels,
  };
}

/** Force refresh hook */
export function useRefreshOpenRouterModels() {
  const queryClient = useQueryClient();

  return () => {
    clearCachedModels();
    return queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  };
}

/** Check if OpenRouter catalog is loaded */
export function useOpenRouterReady() {
  const { data, isLoading, isError } = useOpenRouterModels();
  return {
    isReady: !!data && data.length > 0,
    isLoading,
    isError,
    modelCount: data?.length ?? 0,
  };
}
