/**
 * Model Presets for Copilot Configuration
 * Grouped by tier: Free (available to all) and Paid (requires Pro+)
 */

import type { ModelPreset } from './types';

// TODO i18n: missing keys for preset descriptions ("Free tier - no premium usage", etc.)
// Note: ALL Claude models require paid Copilot subscription
export const FREE_PRESETS: ModelPreset[] = [
  {
    name: 'GPT-4.1 (Free)',
    description: 'Free tier - no premium usage',
    default: 'gpt-4.1',
    opus: 'gpt-4.1',
    sonnet: 'gpt-4.1',
    haiku: 'gpt-4.1',
  },
  {
    name: 'GPT-5 Mini (Free)',
    description: 'Free tier - lightweight model',
    default: 'gpt-5-mini',
    opus: 'gpt-5-mini',
    sonnet: 'gpt-5-mini',
    haiku: 'gpt-5-mini',
  },
];

// TODO i18n: missing keys for paid preset descriptions
export const PAID_PRESETS: ModelPreset[] = [
  {
    name: 'Claude Opus 4.5',
    description: 'Pro+ (3x) - Most capable reasoning',
    default: 'claude-opus-4.5',
    opus: 'claude-opus-4.5',
    sonnet: 'claude-sonnet-4.5',
    haiku: 'claude-haiku-4.5',
  },
  {
    name: 'Claude Sonnet 4.5',
    description: 'Pro+ (1x) - Balanced performance',
    default: 'claude-sonnet-4.5',
    opus: 'claude-opus-4.5',
    sonnet: 'claude-sonnet-4.5',
    haiku: 'claude-haiku-4.5',
  },
  {
    name: 'GPT-5.2',
    description: 'Pro+ (1x) - Latest OpenAI (Preview)',
    default: 'gpt-5.2',
    opus: 'gpt-5.2',
    sonnet: 'gpt-5.1',
    haiku: 'gpt-5-mini',
  },
  {
    name: 'GPT-5.1 Codex Max',
    description: 'Pro+ (1x) - Best for coding',
    default: 'gpt-5.1-codex-max',
    opus: 'gpt-5.1-codex-max',
    sonnet: 'gpt-5.1-codex',
    haiku: 'gpt-5.1-codex-mini',
  },
  {
    name: 'Gemini 2.5 Pro',
    description: 'Pro+ (1x) - Google latest',
    default: 'gemini-2.5-pro',
    opus: 'gemini-2.5-pro',
    sonnet: 'gemini-2.5-pro',
    haiku: 'gemini-3-flash',
  },
];
