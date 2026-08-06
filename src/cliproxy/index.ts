/**
 * CLIProxy Module Exports
 * Central export point for CLIProxyAPI binary management and execution
 */

// Types
export type {
  PlatformInfo,
  SupportedOS,
  SupportedArch,
  ArchiveExtension,
  BinaryManagerConfig,
  BinaryInfo,
  DownloadProgress,
  ProgressCallback,
  ChecksumResult,
  DownloadResult,
  CLIProxyProvider,
  CliproxyRoutingStrategy,
  CLIProxyConfig,
  ExecutorConfig,
  ProviderConfig,
  ProviderModelMapping,
} from './types';

// Platform detection
export {
  detectPlatform,
  getDownloadUrl,
  getChecksumsUrl,
  getExecutableName,
  getArchiveBinaryName,
  isPlatformSupported,
  getPlatformDescription,
  CLIPROXY_VERSION,
} from './binary/platform-detector';

// Binary management
export {
  BinaryManager,
  ensureCLIProxyBinary,
  isCLIProxyInstalled,
  getCLIProxyPath,
  getInstalledCliproxyVersion,
  installCliproxyVersion,
  fetchLatestCliproxyVersion,
  getPinnedVersion,
  savePinnedVersion,
  clearPinnedVersion,
  isVersionPinned,
  getVersionPinPath,
} from './binary-manager';

// Config generation
export {
  generateConfig,
  regenerateConfig,
  configNeedsRegeneration,
  parseUserApiKeys,
  getClaudeEnvVars,
  getEffectiveEnvVars,
  getProviderSettingsPath,
  ensureProviderSettings,
  getProviderConfig,
  getModelMapping,
  getCliproxyDir,
  getProviderAuthDir,
  getAuthDir,
  getCliproxyConfigPath,
  getBinDir,
  configExists,
  deleteConfig,
  CLIPROXY_DEFAULT_PORT,
  CLIPROXY_CONFIG_VERSION,
} from './config/config-generator';

// Base config loader (for reading config/base-*.settings.json)
export {
  loadBaseConfig,
  getModelMappingFromConfig,
  getEnvVarsFromConfig,
  clearConfigCache,
} from './config/base-config-loader';

// Model catalog and configuration
export type { ModelEntry, ProviderCatalog } from './model-catalog';
export { MODEL_CATALOG, supportsModelConfig, getProviderCatalog, findModel } from './model-catalog';
export {
  MODEL_ENV_VAR_KEYS,
  extractProviderFromPathname,
  isAntigravityProvider,
  normalizeClaudeDottedMajorMinor,
  normalizeClaudeDottedThinkingMajorMinor,
  normalizeModelIdForProvider,
  normalizeModelIdForRouting,
  normalizeModelEnvVarsForProvider,
} from './ai-providers/model-id-normalizer';
export {
  hasUserSettings,
  getCurrentModel,
  configureProviderModel,
  showCurrentConfig,
} from './config/model-config';
export {
  getDefaultCodexModel,
  getFreePlanFallbackCodexModel,
  reconcileCodexModelForActivePlan,
} from './ai-providers/codex-plan-compatibility';

// Executor
export {
  execClaudeWithCLIProxy,
  isPortAvailable,
  findAvailablePort,
} from './executor';

// Authentication
export type { AuthStatus } from './auth/auth-handler';
export {
  isAuthenticated,
  getAuthStatus,
  getAllAuthStatus,
  clearAuth,
  triggerOAuth,
  ensureAuth,
  getOAuthConfig,
  getProviderTokenDir,
  displayAuthStatus,
} from './auth/auth-handler';

// Stats fetcher
export type { CliproxyStats } from './services/stats-fetcher';
export { fetchCliproxyStats, isCliproxyRunning } from './services/stats-fetcher';

// Quota fetcher
export type { ModelQuota, QuotaResult } from './quota/quota-fetcher';
export { fetchAccountQuota } from './quota/quota-fetcher';

// OpenAI compatibility layer
export type { OpenAICompatProvider, OpenAICompatModel } from './ai-providers/openai-compat-manager';
export {
  listOpenAICompatProviders,
  getOpenAICompatProvider,
  addOpenAICompatProvider,
  updateOpenAICompatProvider,
  removeOpenAICompatProvider,
  OPENROUTER_TEMPLATE,
  TOGETHER_TEMPLATE,
} from './ai-providers/openai-compat-manager';

// AI provider management
export type {
  AiProviderFamilyId,
  AiProviderFamilyState,
  AiProviderEntryView,
  ListAiProvidersResult,
  UpsertAiProviderEntryInput,
} from './ai-providers';
export {
  AI_PROVIDER_FAMILY_DEFINITIONS,
  AI_PROVIDER_FAMILY_IDS,
  listAiProviders,
  createAiProviderEntry,
  updateAiProviderEntry,
  deleteAiProviderEntry,
} from './ai-providers';

// Service manager (background CLIProxy for dashboard)
export type { ServiceStartResult } from './service-manager';
export { ensureCliproxyService, stopCliproxyService, getServiceStatus } from './service-manager';

// Proxy detector (unified detection with multiple fallbacks)
export type { ProxyStatus, DetectionMethod } from './proxy/proxy-detector';
export {
  detectRunningProxy,
  waitForProxyHealthy,
  reclaimOrphanedProxy,
} from './proxy/proxy-detector';

// Startup lock (prevents race conditions between CCS processes)
export type { LockResult } from './services/startup-lock';
export { acquireStartupLock, withStartupLock } from './services/startup-lock';

// Auth token manager (customizable API key and management secret)
export {
  generateSecureToken,
  maskToken,
  getEffectiveApiKey,
  getEffectiveManagementSecret,
  setGlobalApiKey,
  setGlobalManagementSecret,
  setVariantApiKey,
  resetAuthToDefaults,
  getAuthSummary,
} from './auth/auth-token-manager';

// Thinking validator
export type { ThinkingValidationResult } from './thinking-validator';
export {
  validateThinking,
  THINKING_LEVEL_BUDGETS,
  VALID_THINKING_LEVELS,
  VALID_THINKING_TIERS,
  THINKING_OFF_VALUES,
  THINKING_AUTO_VALUE,
  THINKING_BUDGET_MIN,
  THINKING_BUDGET_MAX,
  THINKING_BUDGET_DEFAULT_MIN,
} from './thinking-validator';

// Management API client (for remote CLIProxy sync)
export type {
  ClaudeKey,
  ClaudeModel,
  ManagementClientConfig,
  ManagementHealthStatus,
  ManagementApiErrorCode,
  ClaudeKeyPatch,
  SyncStatus,
  RemoteModelInfo,
  RemoteThinkingSupport,
} from './management/management-api-types';
export { ManagementApiClient, createManagementClient } from './management/management-api-client';

// Catalog cache (model catalog sync with CLIProxyAPI)
export {
  getResolvedCatalog,
  getAllResolvedCatalogs,
  getCacheAge,
  clearCatalogCache,
  setCachedCatalog,
  SYNCABLE_PROVIDERS,
  PROVIDER_TO_CHANNEL,
} from './services/catalog-cache';

// Sync module (profile sync to remote CLIProxy)
export type { SyncableProfile, SyncPreviewItem } from './sync';
export {
  loadSyncableProfiles,
  mapProfileToClaudeKey,
  generateSyncPayload,
  generateSyncPreview,
  getSyncableProfileCount,
  isProfileSyncable,
} from './sync';

// Tool name sanitization (for Gemini 64-char limit compliance)
export type { SanitizeResult } from './ai-providers/tool-name-sanitizer';
export {
  sanitizeToolName,
  isValidToolName,
  removeDuplicateSegments,
  smartTruncate,
  GEMINI_MAX_TOOL_NAME_LENGTH,
} from './ai-providers/tool-name-sanitizer';

export type {
  Tool,
  ToolUseBlock,
  ContentBlock,
  SanitizationChange,
} from './ai-providers/tool-name-mapper';
export { ToolNameMapper } from './ai-providers/tool-name-mapper';

export type { ToolSanitizationProxyConfig } from './proxy/tool-sanitization-proxy';
export { ToolSanitizationProxy } from './proxy/tool-sanitization-proxy';

// Schema sanitization (for MCP input_schema non-standard property removal)
export type { SchemaSanitizationResult } from './ai-providers/schema-sanitizer';
export { sanitizeInputSchema, sanitizeToolSchemas } from './ai-providers/schema-sanitizer';
