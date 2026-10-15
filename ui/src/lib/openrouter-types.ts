/**
 * OpenRouter Model Catalog Types
 * Based on https://openrouter.ai/docs/api-reference/list-available-models
 */

export interface OpenRouterPricing {
  prompt: string; // USD per token, e.g., "0.000003"
  completion: string;
  request: string;
  image: string;
  audio?: string;
  web_search?: string;
  internal_reasoning?: string;
  input_cache_read?: string;
}

export interface OpenRouterArchitecture {
  modality: string; // "text+image->text"
  input_modalities: string[]; // ["text", "image"]
  output_modalities: string[]; // ["text"]
  tokenizer: string; // "GPT", "Claude", "Gemini"
  instruct_type: string | null;
}

export interface OpenRouterTopProvider {
  context_length: number;
  max_completion_tokens: number | null;
  is_moderated: boolean;
}

export interface OpenRouterModel {
  id: string; // "anthropic/claude-sonnet-4"
  name: string; // "Anthropic: Claude Sonnet 4"
  canonical_slug: string;
  hugging_face_id: string | null;
  description: string;
  context_length: number;
  architecture: OpenRouterArchitecture;
  pricing: OpenRouterPricing;
  top_provider: OpenRouterTopProvider;
  supported_parameters: string[];
  per_request_limits: Record<string, string> | null;
  created: number; // Unix timestamp when model was added to OpenRouter
}

export interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

export interface OpenRouterCatalogCache {
  models: OpenRouterModel[];
  fetchedAt: number;
  version: string;
}

/** Model category for grouping */
export type ModelCategory =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'meta'
  | 'mistral'
  | 'opensource'
  | 'other';

/** Categorized model for UI display */
export interface CategorizedModel extends OpenRouterModel {
  category: ModelCategory;
  pricePerMillionPrompt: number;
  pricePerMillionCompletion: number;
  isFree: boolean;
  isExacto: boolean; // Models with :exacto suffix - optimized for tool use
}
