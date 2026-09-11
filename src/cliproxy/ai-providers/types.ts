export const AI_PROVIDER_FAMILY_IDS = [
  'gemini-api-key',
  'codex-api-key',
  'claude-api-key',
  'vertex-api-key',
  'openai-compatibility',
  'cloudflare-api-key',
  'nvidia-api-key',
  'openrouter-api-key',
] as const;

export type AiProviderFamilyId = (typeof AI_PROVIDER_FAMILY_IDS)[number];

export interface AiProviderModelAlias {
  name: string;
  alias: string;
}

export interface AiProviderApiKeyEntry {
  id?: string;
  'api-key': string;
  'base-url'?: string;
  'proxy-url'?: string;
  prefix?: string;
  headers?: Record<string, string>;
  'excluded-models'?: string[];
  models?: AiProviderModelAlias[];
  'account-id'?: string;
}

export interface OpenAICompatApiKeyEntry {
  'api-key': string;
  'proxy-url'?: string;
}

export interface OpenAICompatEntry {
  id?: string;
  name: string;
  'base-url': string;
  headers?: Record<string, string>;
  'api-key-entries': OpenAICompatApiKeyEntry[];
  models?: AiProviderModelAlias[];
}

export interface AiProviderFamilyDefinition {
  id: AiProviderFamilyId;
  displayName: string;
  description: string;
  authMode: 'api-key' | 'hybrid' | 'connector';
  supportsNamedEntries: boolean;
  routePath: string;
}

export interface AiProviderEntryView {
  id: string;
  index: number;
  name?: string;
  label: string;
  baseUrl?: string;
  proxyUrl?: string;
  prefix?: string;
  headers: Array<{ key: string; value: string }>;
  excludedModels: string[];
  models: AiProviderModelAlias[];
  apiKeyMasked?: string;
  apiKeysMasked?: string[];
  secretConfigured: boolean;
  accountId?: string;
}

export interface AiProviderFamilyState {
  id: AiProviderFamilyId;
  displayName: string;
  description: string;
  authMode: 'api-key' | 'hybrid' | 'connector';
  routePath: string;
  status: 'empty' | 'partial' | 'ready';
  supportsNamedEntries: boolean;
  entries: AiProviderEntryView[];
}

export interface AiProvidersSourceSummary {
  mode: 'local' | 'remote';
  label: string;
  target: string;
  managementAuth: 'configured' | 'fallback' | 'missing';
}

export interface ListAiProvidersResult {
  source: AiProvidersSourceSummary;
  families: AiProviderFamilyState[];
}

export interface UpsertAiProviderEntryInput {
  name?: string;
  baseUrl?: string;
  proxyUrl?: string;
  prefix?: string;
  headers?: Array<{ key: string; value: string }>;
  excludedModels?: string[];
  models?: AiProviderModelAlias[];
  apiKey?: string;
  apiKeys?: string[];
  preserveSecrets?: boolean;
  accountId?: string;
}

export interface TestAiProviderConnectionInput {
  family: AiProviderFamilyId;
  apiKey?: string;
  baseUrl?: string;
  headers?: Array<{ key: string; value: string }>;
}

export interface TestAiProviderConnectionResult {
  success: boolean;
  message: string;
  statusCode?: number;
}

export interface LocalAiProviderConfig {
  'gemini-api-key'?: AiProviderApiKeyEntry[];
  'codex-api-key'?: AiProviderApiKeyEntry[];
  'claude-api-key'?: AiProviderApiKeyEntry[];
  'vertex-api-key'?: AiProviderApiKeyEntry[];
  'openai-compatibility'?: OpenAICompatEntry[];
  'cloudflare-api-key'?: AiProviderApiKeyEntry[];
  'nvidia-api-key'?: AiProviderApiKeyEntry[];
  'openrouter-api-key'?: AiProviderApiKeyEntry[];
  [key: string]: unknown;
}

export const AI_PROVIDER_FAMILY_DEFINITIONS: Record<
  AiProviderFamilyId,
  AiProviderFamilyDefinition
> = {
  'gemini-api-key': {
    id: 'gemini-api-key',
    displayName: 'Gemini',
    description: 'Google Gemini API keys and route defaults',
    authMode: 'hybrid',
    supportsNamedEntries: false,
    routePath: '/api/provider/gemini',
  },
  'codex-api-key': {
    id: 'codex-api-key',
    displayName: 'Codex',
    description: 'OpenAI Codex API keys and endpoint overrides',
    authMode: 'hybrid',
    supportsNamedEntries: false,
    routePath: '/api/provider/codex',
  },
  'claude-api-key': {
    id: 'claude-api-key',
    displayName: 'Claude',
    description: 'Anthropic-compatible routing entries with aliases and filters',
    authMode: 'api-key',
    supportsNamedEntries: false,
    routePath: '/api/provider/claude',
  },
  'vertex-api-key': {
    id: 'vertex-api-key',
    displayName: 'Vertex',
    description: 'Vertex AI API keys and regional endpoint overrides',
    authMode: 'api-key',
    supportsNamedEntries: false,
    routePath: '/api/provider/vertex',
  },
  'openai-compatibility': {
    id: 'openai-compatibility',
    displayName: 'OpenAI-Compatible',
    description: 'Named connectors for OpenRouter, Together, and custom OpenAI-style APIs',
    authMode: 'connector',
    supportsNamedEntries: true,
    routePath: '/api/provider/openai-compat',
  },
  'cloudflare-api-key': {
    id: 'cloudflare-api-key',
    displayName: 'Cloudflare',
    description: 'Cloudflare Workers AI via OpenAI-compatible endpoint',
    authMode: 'api-key',
    supportsNamedEntries: false,
    routePath: '/api/provider/cloudflare',
  },
  'nvidia-api-key': {
    id: 'nvidia-api-key',
    displayName: 'NVIDIA',
    description: 'NVIDIA NIM API for hosted models',
    authMode: 'api-key',
    supportsNamedEntries: false,
    routePath: '/api/provider/nvidia',
  },
  'openrouter-api-key': {
    id: 'openrouter-api-key',
    displayName: 'OpenRouter',
    description: 'OpenRouter multi-model API gateway',
    authMode: 'api-key',
    supportsNamedEntries: false,
    routePath: '/api/provider/openrouter',
  },
};
