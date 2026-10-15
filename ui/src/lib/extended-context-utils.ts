/**
 * UI facade for shared extended-context helpers.
 */

export {
  ANTHROPIC_MODEL_ENV_KEYS,
  EXTENDED_CONTEXT_SUFFIX,
  applyExtendedContextPreferenceToAnthropicModels,
  isNativeGeminiModel,
  isAnthropicModelEnvKey,
  hasAnthropicExtendedContextEnabled,
  hasExtendedContextSuffix,
  applyExtendedContextSuffix,
  isClaudeModelId,
  likelySupportsClaudeExtendedContext,
  stripModelConfigurationSuffixes,
  stripExtendedContextSuffix,
} from '../../../src/shared/extended-context-utils';
