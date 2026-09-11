import {
  AI_PROVIDER_FAMILY_DEFINITIONS,
  AI_PROVIDER_FAMILY_IDS,
  type AiProviderApiKeyEntry,
  type AiProviderEntryView,
  type AiProviderFamilyId,
  type AiProviderFamilyState,
  type AiProviderModelAlias,
  type ListAiProvidersResult,
  type OpenAICompatEntry,
  type UpsertAiProviderEntryInput,
} from './types';
import { getAiProvidersSourceSummary, readFamilyEntries, writeFamilyEntries } from './config-store';

function maskSecret(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length > 8 ? `...${value.slice(-4)}` : '***';
}

function sanitizeUrlForView(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = new URL(trimmed);
    if (parsed.username) parsed.username = '***';
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

function restoreMaskedViewValue(
  value: string | undefined,
  existing: string | undefined,
  sanitizeForView: (value: string | undefined) => string | undefined = maskSecret
): string | undefined {
  const next = value?.trim() || undefined;
  if (!next || !existing) return next;
  return next === sanitizeForView(existing) ? existing : next;
}

function normalizeHeaders(
  headers: Array<{ key: string; value: string }> | undefined,
  existing?: Record<string, string>
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const normalized = headers.reduce<Record<string, string>>((acc, header) => {
    const key = header.key.trim();
    if (!key) return acc;
    acc[key] = restoreMaskedViewValue(header.value, existing?.[key]) || '';
    return acc;
  }, {});
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function toHeaderPairs(
  headers: Record<string, string> | undefined
): Array<{ key: string; value: string }> {
  return Object.entries(headers || {}).map(([key, value]) => ({
    key,
    value: maskSecret(value) || '***',
  }));
}

function readModelRulePart(model: unknown, key: keyof AiProviderModelAlias) {
  if (!model || typeof model !== 'object') {
    return '';
  }

  const value = (model as Partial<Record<keyof AiProviderModelAlias, unknown>>)[key];
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeModelAliases(models: unknown): AiProviderModelAlias[] {
  return (Array.isArray(models) ? models : [])
    .map((model) => ({
      name: readModelRulePart(model, 'name'),
      alias: readModelRulePart(model, 'alias'),
    }))
    .filter((model) => model.name.length > 0 || model.alias.length > 0);
}

function buildApiKeyEntryView(
  family: AiProviderFamilyId,
  entry: AiProviderApiKeyEntry,
  index: number
): AiProviderEntryView {
  return {
    id: entry.id || `${family}:${index}`,
    index,
    label: entry.prefix?.trim() || sanitizeUrlForView(entry['base-url']) || `Entry ${index + 1}`,
    baseUrl: sanitizeUrlForView(entry['base-url']),
    proxyUrl: sanitizeUrlForView(entry['proxy-url']),
    prefix: entry.prefix?.trim() || undefined,
    headers: toHeaderPairs(entry.headers),
    excludedModels: [...(entry['excluded-models'] || [])],
    models: normalizeModelAliases(entry.models),
    apiKeyMasked: maskSecret(entry['api-key']),
    secretConfigured: Boolean(entry['api-key']),
    accountId: entry['account-id'] || undefined,
  };
}

function buildOpenAiCompatEntryView(entry: OpenAICompatEntry, index: number): AiProviderEntryView {
  return {
    id: entry.id || `openai-compatibility:${index}`,
    index,
    name: entry.name,
    label: entry.name,
    baseUrl: sanitizeUrlForView(entry['base-url']),
    headers: toHeaderPairs(entry.headers),
    excludedModels: [],
    models: normalizeModelAliases(entry.models),
    apiKeysMasked: (entry['api-key-entries'] || []).map(
      (apiKeyEntry) => maskSecret(apiKeyEntry['api-key']) || '***'
    ),
    secretConfigured: (entry['api-key-entries'] || []).length > 0,
  };
}

function resolveFamilyStatus(entries: AiProviderEntryView[]): AiProviderFamilyState['status'] {
  if (entries.length === 0) return 'empty';
  return entries.every((entry) => entry.secretConfigured) ? 'ready' : 'partial';
}

function isOpenAiCompatFamily(family: AiProviderFamilyId): boolean {
  return family === 'openai-compatibility';
}

export async function listAiProviders(): Promise<ListAiProvidersResult> {
  const families = await Promise.all(
    AI_PROVIDER_FAMILY_IDS.map(async (familyId) => {
      const definition = AI_PROVIDER_FAMILY_DEFINITIONS[familyId];
      if (isOpenAiCompatFamily(familyId)) {
        const entries = (await readFamilyEntries(familyId)) as OpenAICompatEntry[];
        const entryViews = entries.map((entry, index) => buildOpenAiCompatEntryView(entry, index));
        return {
          ...definition,
          status: resolveFamilyStatus(entryViews),
          entries: entryViews,
        };
      }

      const entries = (await readFamilyEntries(familyId)) as AiProviderApiKeyEntry[];
      const entryViews = entries.map((entry: AiProviderApiKeyEntry, index: number) =>
        buildApiKeyEntryView(familyId, entry, index)
      );
      return {
        ...definition,
        status: resolveFamilyStatus(entryViews),
        entries: entryViews,
      };
    })
  );

  return {
    source: getAiProvidersSourceSummary(),
    families,
  };
}

function toApiKeyEntry(
  input: UpsertAiProviderEntryInput,
  existing?: AiProviderApiKeyEntry
): AiProviderApiKeyEntry {
  const nextSecret =
    input.apiKey !== undefined
      ? input.apiKey.trim()
      : input.preserveSecrets
        ? existing?.['api-key'] || ''
        : existing?.['api-key'] || '';

  return {
    id: existing?.id,
    'api-key': nextSecret,
    'base-url': restoreMaskedViewValue(input.baseUrl, existing?.['base-url'], sanitizeUrlForView),
    'proxy-url': restoreMaskedViewValue(
      input.proxyUrl,
      existing?.['proxy-url'],
      sanitizeUrlForView
    ),
    prefix: input.prefix?.trim() || undefined,
    headers: normalizeHeaders(input.headers, existing?.headers),
    'excluded-models': (input.excludedModels || [])
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
    models: normalizeModelAliases(input.models),
    'account-id': input.accountId?.trim() || existing?.['account-id'] || undefined,
  };
}

function toOpenAiCompatEntry(
  input: UpsertAiProviderEntryInput,
  existing?: OpenAICompatEntry
): OpenAICompatEntry {
  const nextApiKeys =
    input.apiKeys !== undefined
      ? input.apiKeys.map((value) => value.trim()).filter((value) => value.length > 0)
      : input.preserveSecrets
        ? (existing?.['api-key-entries'] || []).map((entry) => entry['api-key'])
        : (existing?.['api-key-entries'] || []).map((entry) => entry['api-key']);

  return {
    id: existing?.id,
    name: input.name?.trim() || existing?.name || 'connector',
    'base-url':
      restoreMaskedViewValue(input.baseUrl, existing?.['base-url'], sanitizeUrlForView) ||
      existing?.['base-url'] ||
      '',
    headers: normalizeHeaders(input.headers, existing?.headers),
    'api-key-entries': nextApiKeys.map((apiKey) => ({ 'api-key': apiKey })),
    models: normalizeModelAliases(input.models),
  };
}

function resolveEntryIndex(entries: Array<{ id?: string }>, entryId: string): number {
  const normalizedEntryId = entryId.trim();
  const matchedIndex = entries.findIndex((entry) => entry.id === normalizedEntryId);
  if (matchedIndex !== -1) {
    return matchedIndex;
  }

  const legacyIndex = Number.parseInt(normalizedEntryId, 10);
  if (
    Number.isInteger(legacyIndex) &&
    legacyIndex >= 0 &&
    legacyIndex < entries.length &&
    String(legacyIndex) === normalizedEntryId
  ) {
    return legacyIndex;
  }

  if (normalizedEntryId.startsWith('openai-compatibility:') || normalizedEntryId.includes(':')) {
    const legacySuffix = normalizedEntryId.split(':').at(-1) || '';
    const legacySuffixIndex = Number.parseInt(legacySuffix, 10);
    if (
      Number.isInteger(legacySuffixIndex) &&
      legacySuffixIndex >= 0 &&
      legacySuffixIndex < entries.length &&
      String(legacySuffixIndex) === legacySuffix
    ) {
      return legacySuffixIndex;
    }
  }

  throw new Error('Entry not found');
}

function assertEntryId(entryId: string): void {
  if (!entryId.trim()) {
    throw new Error('Entry not found');
  }
}

function validateFamilyInput(family: AiProviderFamilyId, input: UpsertAiProviderEntryInput): void {
  if (isOpenAiCompatFamily(family)) {
    if (!(input.name?.trim() || '').length) {
      throw new Error('name is required');
    }
    if (!(input.baseUrl?.trim() || '').length) {
      throw new Error('baseUrl is required');
    }
    if (!input.preserveSecrets && !(input.apiKeys || []).some((value) => value.trim().length > 0)) {
      throw new Error('At least one api key is required');
    }
    return;
  }

  if (!input.preserveSecrets && !(input.apiKey?.trim() || '').length) {
    throw new Error('apiKey is required');
  }
}

export async function createAiProviderEntry(
  family: AiProviderFamilyId,
  input: UpsertAiProviderEntryInput
): Promise<void> {
  validateFamilyInput(family, input);

  if (isOpenAiCompatFamily(family)) {
    const entries = (await readFamilyEntries(family)) as OpenAICompatEntry[];
    entries.push(toOpenAiCompatEntry(input));
    await writeFamilyEntries(family, entries);
    return;
  }

  const entries = (await readFamilyEntries(family)) as AiProviderApiKeyEntry[];
  entries.push(toApiKeyEntry(input));
  await writeFamilyEntries(family, entries);
}

export async function updateAiProviderEntry(
  family: AiProviderFamilyId,
  entryId: string,
  input: UpsertAiProviderEntryInput
): Promise<void> {
  assertEntryId(entryId);

  if (isOpenAiCompatFamily(family)) {
    const entries = (await readFamilyEntries(family)) as OpenAICompatEntry[];
    const index = resolveEntryIndex(entries, entryId);
    validateFamilyInput(family, input);
    entries[index] = toOpenAiCompatEntry(input, entries[index]);
    await writeFamilyEntries(family, entries);
    return;
  }

  const entries = (await readFamilyEntries(family)) as AiProviderApiKeyEntry[];
  const index = resolveEntryIndex(entries, entryId);
  validateFamilyInput(family, input);
  entries[index] = toApiKeyEntry(input, entries[index]);
  await writeFamilyEntries(family, entries);
}

export async function deleteAiProviderEntry(
  family: AiProviderFamilyId,
  entryId: string
): Promise<void> {
  assertEntryId(entryId);

  if (isOpenAiCompatFamily(family)) {
    const entries = (await readFamilyEntries(family)) as OpenAICompatEntry[];
    const index = resolveEntryIndex(entries, entryId);
    entries.splice(index, 1);
    await writeFamilyEntries(family, entries);
    return;
  }

  const entries = (await readFamilyEntries(family)) as AiProviderApiKeyEntry[];
  const index = resolveEntryIndex(entries, entryId);
  entries.splice(index, 1);
  await writeFamilyEntries(family, entries);
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

export async function testAiProviderConnection(
  input: TestAiProviderConnectionInput
): Promise<TestAiProviderConnectionResult> {
  const family = input.family;
  const apiKey = input.apiKey?.trim();
  let baseUrl = input.baseUrl?.trim();

  if (!apiKey) {
    return { success: false, message: 'API key is required for testing connection' };
  }

  if (!baseUrl) {
    if (family === 'nvidia-api-key') baseUrl = 'https://integrate.api.nvidia.com/v1';
    else if (family === 'openrouter-api-key') baseUrl = 'https://openrouter.ai/api/v1';
    else if (family === 'codex-api-key') baseUrl = 'https://api.openai.com/v1';
    else if (family === 'claude-api-key') baseUrl = 'https://api.anthropic.com';
    else if (family === 'gemini-api-key') baseUrl = 'https://generativelanguage.googleapis.com';
    else if (family === 'vertex-api-key') baseUrl = 'https://vertex.googleapis.com';
  }

  if (!baseUrl) {
    return { success: false, message: 'Base URL is required to test connection' };
  }

  baseUrl = baseUrl.replace(/\/+$/, '');

  const customHeaders: Record<string, string> = {};
  if (Array.isArray(input.headers)) {
    for (const h of input.headers) {
      if (h.key.trim()) customHeaders[h.key.trim()] = h.value.trim();
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    let testUrl = `${baseUrl}/models`;
    const reqHeaders: Record<string, string> = {
      Accept: 'application/json',
      ...customHeaders,
    };

    if (family === 'claude-api-key') {
      reqHeaders['x-api-key'] = apiKey || '';
      reqHeaders['anthropic-version'] = '2023-06-01';
      testUrl = baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
    } else if (family === 'gemini-api-key') {
      testUrl = `${baseUrl}/v1beta/models?key=${encodeURIComponent(apiKey || '')}`;
    } else {
      reqHeaders['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(testUrl, {
      method: 'GET',
      headers: reqHeaders,
      signal: controller.signal,
    });

    if (response.ok || response.status === 200) {
      return { success: true, statusCode: response.status, message: 'Connection successful' };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        statusCode: response.status,
        message: `Authentication failed (HTTP ${response.status}): Check API key`,
      };
    }

    if (response.status === 400 || response.status === 404 || response.status === 405) {
      return {
        success: true,
        statusCode: response.status,
        message: `Endpoint reachable (HTTP ${response.status})`,
      };
    }

    return {
      success: false,
      statusCode: response.status,
      message: `Provider returned HTTP ${response.status}`,
    };
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return { success: false, message: 'Connection timed out (8s limit)' };
    }
    return { success: false, message: `Connection failed: ${(error as Error).message}` };
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface AiProviderModel {
  id: string;
  owned_by: string;
}

export interface FetchAiProviderModelsResult {
  models: AiProviderModel[];
  provider: string;
}

const PROVIDER_MODEL_ENDPOINTS: Partial<
  Record<
    AiProviderFamilyId,
    (baseUrl: string, apiKey: string, entry: AiProviderApiKeyEntry) => string
  >
> = {
  'nvidia-api-key': (baseUrl) => `${baseUrl.replace(/\/+$/, '')}/models`,
  'openrouter-api-key': (baseUrl) => `${baseUrl.replace(/\/+$/, '')}/models`,
  'cloudflare-api-key': (_baseUrl, _apiKey, entry) => {
    const accountId = entry['account-id']?.trim();
    if (!accountId) return '';
    return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search`;
  },
  'codex-api-key': (baseUrl) => `${baseUrl.replace(/\/+$/, '')}/models`,
  'claude-api-key': (baseUrl) =>
    baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl.replace(/\/+$/, '')}/v1/models`,
  'gemini-api-key': (baseUrl, apiKey) =>
    `${baseUrl.replace(/\/+$/, '')}/v1beta/models?key=${encodeURIComponent(apiKey)}`,
  'vertex-api-key': (baseUrl) =>
    `${baseUrl.replace(/\/+$/, '')}/v1/projects/-/locations/us-central1/publishers/google/models`,
};

export async function fetchAiProviderModels(
  family: AiProviderFamilyId
): Promise<FetchAiProviderModelsResult> {
  const entries = (await readFamilyEntries(family)) as AiProviderApiKeyEntry[];
  const firstEntry = entries[0];
  const apiKey = firstEntry?.['api-key']?.trim();

  if (!apiKey) {
    return { models: [], provider: family };
  }

  let baseUrl = firstEntry?.['base-url']?.trim();
  if (!baseUrl) {
    if (family === 'nvidia-api-key') baseUrl = 'https://integrate.api.nvidia.com/v1';
    else if (family === 'openrouter-api-key') baseUrl = 'https://openrouter.ai/api/v1';
    else if (family === 'codex-api-key') baseUrl = 'https://api.openai.com/v1';
    else if (family === 'claude-api-key') baseUrl = 'https://api.anthropic.com';
    else if (family === 'gemini-api-key') baseUrl = 'https://generativelanguage.googleapis.com';
    else if (family === 'vertex-api-key') baseUrl = 'https://vertex.googleapis.com';
  }

  if (!baseUrl) {
    return { models: [], provider: family };
  }

  const endpointBuilder = PROVIDER_MODEL_ENDPOINTS[family];
  if (!endpointBuilder) {
    return { models: [], provider: family };
  }

  const url = endpointBuilder(baseUrl, apiKey, firstEntry);
  if (!url) {
    return { models: [], provider: family };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const reqHeaders: Record<string, string> = { Accept: 'application/json' };

    if (family === 'claude-api-key') {
      reqHeaders['x-api-key'] = apiKey;
      reqHeaders['anthropic-version'] = '2023-06-01';
    } else if (family === 'gemini-api-key') {
      // API key is in the URL query string
    } else {
      reqHeaders['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: reqHeaders,
      signal: controller.signal,
    });

    if (!response.ok) {
      return { models: [], provider: family };
    }

    const data = (await response.json()) as {
      data?: Array<{ id: string; owned_by?: string }>;
      models?: Array<{ id: string; owned_by?: string }>;
    };

    const rawModels = data.data ?? data.models ?? [];
    const providerLabel = family.replace('-api-key', '');
    const models: AiProviderModel[] = rawModels.map((m) => ({
      id: m.id,
      owned_by: providerLabel,
    }));

    return { models, provider: family };
  } catch {
    return { models: [], provider: family };
  } finally {
    clearTimeout(timeoutId);
  }
}
