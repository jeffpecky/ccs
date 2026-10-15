/**
 * Tests for quota utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  getMinClaudeQuota,
  sortModelsByPriority,
  getEarliestResetTime,
  getMinCodexQuota,
  getCodexResetTime,
  getCodexWindowDisplayLabel,
  getMinGeminiQuota,
  getGeminiResetTime,
  getQuotaFailureInfo,
  getProviderMinQuota,
  getProviderResetTime,
  isAgyQuotaResult,
  isClaudeQuotaResult,
  isCodexQuotaResult,
  isGeminiQuotaResult,
  isGhcpQuotaResult,
} from '@/lib/utils';
import type {
  CodexQuotaWindow,
  CodexQuotaResult,
  ClaudeQuotaResult,
  GeminiCliBucket,
  GeminiCliQuotaResult,
  GhcpQuotaResult,
  QuotaResult,
  ModelQuota,
} from '@/lib/api-client';

describe('getMinClaudeQuota', () => {
  describe('basic functionality', () => {
    it('returns null for empty models array', () => {
      expect(getMinClaudeQuota([])).toBeNull();
    });

    it('returns minimum of Claude models when present', () => {
      const models = [
        { name: 'claude-opus-4', displayName: 'Claude Opus 4', percentage: 95 },
        { name: 'claude-sonnet-4', displayName: 'Claude Sonnet 4', percentage: 90 },
        { name: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', percentage: 100 },
      ];
      expect(getMinClaudeQuota(models)).toBe(90);
    });

    it('returns 0 when no Claude/GPT models (exhausted)', () => {
      const models = [
        { name: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', percentage: 100 },
        { name: 'gemini-3-pro', displayName: 'Gemini 3 Pro', percentage: 98 },
      ];
      // No Claude/GPT models means they're exhausted
      expect(getMinClaudeQuota(models)).toBe(0);
    });

    it('handles single Claude model', () => {
      const models = [{ name: 'claude-opus-4', displayName: 'Claude Opus 4', percentage: 85 }];
      expect(getMinClaudeQuota(models)).toBe(85);
    });
  });

  describe('Claude detection', () => {
    it('detects Claude from displayName', () => {
      const models = [
        { name: 'model-abc', displayName: 'Claude Opus 4.5', percentage: 75 },
        { name: 'gemini-flash', displayName: 'Gemini Flash', percentage: 100 },
      ];
      expect(getMinClaudeQuota(models)).toBe(75);
    });

    it('detects Claude from name when displayName is missing', () => {
      const models = [
        { name: 'claude-sonnet-4-thinking', percentage: 80 },
        { name: 'gemini-2.5-flash', percentage: 100 },
      ];
      expect(getMinClaudeQuota(models)).toBe(80);
    });

    it('is case-insensitive for Claude detection', () => {
      const models = [
        { name: 'CLAUDE-OPUS', displayName: 'CLAUDE OPUS', percentage: 70 },
        { name: 'gemini', displayName: 'Gemini', percentage: 100 },
      ];
      expect(getMinClaudeQuota(models)).toBe(70);
    });
  });

  describe('edge cases', () => {
    it('handles models with 0% quota', () => {
      const models = [
        { name: 'claude-opus', displayName: 'Claude Opus', percentage: 0 },
        { name: 'claude-sonnet', displayName: 'Claude Sonnet', percentage: 50 },
      ];
      expect(getMinClaudeQuota(models)).toBe(0);
    });

    it('handles models with 100% quota', () => {
      const models = [{ name: 'claude-opus', displayName: 'Claude Opus', percentage: 100 }];
      expect(getMinClaudeQuota(models)).toBe(100);
    });

    it('handles undefined displayName gracefully', () => {
      const models = [{ name: 'claude-opus', displayName: undefined, percentage: 85 }];
      expect(getMinClaudeQuota(models)).toBe(85);
    });

    it('handles empty string displayName', () => {
      const models = [{ name: 'claude-opus', displayName: '', percentage: 85 }];
      expect(getMinClaudeQuota(models)).toBe(85);
    });

    it('filters out NaN percentages', () => {
      const models = [
        { name: 'claude-opus', displayName: 'Claude Opus', percentage: NaN },
        { name: 'claude-sonnet', displayName: 'Claude Sonnet', percentage: 80 },
      ];
      expect(getMinClaudeQuota(models)).toBe(80);
    });

    it('filters out Infinity percentages', () => {
      const models = [
        { name: 'claude-opus', displayName: 'Claude Opus', percentage: Infinity },
        { name: 'claude-sonnet', displayName: 'Claude Sonnet', percentage: 75 },
      ];
      expect(getMinClaudeQuota(models)).toBe(75);
    });

    it('returns 0 when all percentages are invalid', () => {
      const models = [
        { name: 'claude-opus', displayName: 'Claude Opus', percentage: NaN },
        { name: 'claude-sonnet', displayName: 'Claude Sonnet', percentage: Infinity },
      ];
      // Invalid percentages filtered out, no valid ones left -> returns 0
      expect(getMinClaudeQuota(models)).toBe(0);
    });
  });

  describe('real-world scenarios', () => {
    it('matches screenshot scenario - Claude 95%, Gemini 100%', () => {
      const models = [
        {
          name: 'claude-opus-4-5-thinking',
          displayName: 'Claude Opus 4.5 (Thinking)',
          percentage: 95,
        },
        { name: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5', percentage: 95 },
        {
          name: 'claude-sonnet-4-5-thinking',
          displayName: 'Claude Sonnet 4.5 (Thinking)',
          percentage: 95,
        },
        { name: 'gemini-2-5-flash', displayName: 'Gemini 2.5 Flash', percentage: 100 },
        {
          name: 'gemini-2-5-flash-thinking',
          displayName: 'Gemini 2.5 Flash (Thinking)',
          percentage: 100,
        },
        { name: 'gemini-2-5-flash-lite', displayName: 'Gemini 2.5 Flash Lite', percentage: 100 },
        { name: 'gemini-2-5-pro', displayName: 'Gemini 2.5 Pro', percentage: 100 },
        { name: 'gemini-3-flash', displayName: 'Gemini 3 Flash', percentage: 98 },
        { name: 'gemini-3-pro-high', displayName: 'Gemini 3 Pro (High)', percentage: 100 },
        { name: 'gemini-3-pro-low', displayName: 'Gemini 3 Pro (Low)', percentage: 100 },
        { name: 'gpt-oss-120b', displayName: 'GPT-OSS 120B (Medium)', percentage: 95 },
      ];
      // Should return 95 (min of Claude), not 99 (avg of all)
      expect(getMinClaudeQuota(models)).toBe(95);
    });

    it('handles mixed Claude percentages', () => {
      const models = [
        { name: 'claude-opus-4', displayName: 'Claude Opus 4', percentage: 80 },
        { name: 'claude-sonnet-4', displayName: 'Claude Sonnet 4', percentage: 95 },
        { name: 'claude-haiku-3', displayName: 'Claude Haiku 3', percentage: 100 },
        { name: 'gemini-flash', displayName: 'Gemini Flash', percentage: 100 },
      ];
      expect(getMinClaudeQuota(models)).toBe(80);
    });
  });
});

describe('sortModelsByPriority', () => {
  it('sorts Claude and GPT models first (Tier 0)', () => {
    const models = [
      { name: 'gemini-flash', displayName: 'Gemini Flash' },
      { name: 'claude-opus', displayName: 'Claude Opus' },
      { name: 'gpt-4', displayName: 'GPT-4' },
    ];
    const sorted = sortModelsByPriority(models);
    // Both Claude and GPT are Tier 0, sorted alphabetically: Claude Opus < GPT-4
    expect(sorted[0].name).toBe('claude-opus');
    expect(sorted[1].name).toBe('gpt-4');
    // Gemini is lower priority
    expect(sorted[2].name).toBe('gemini-flash');
  });

  it('sorts alphabetically within same priority', () => {
    const models = [
      { name: 'claude-sonnet', displayName: 'Claude Sonnet' },
      { name: 'claude-opus', displayName: 'Claude Opus' },
      { name: 'claude-haiku', displayName: 'Claude Haiku' },
    ];
    const sorted = sortModelsByPriority(models);
    expect(sorted[0].displayName).toBe('Claude Haiku');
    expect(sorted[1].displayName).toBe('Claude Opus');
    expect(sorted[2].displayName).toBe('Claude Sonnet');
  });

  it('does not mutate original array', () => {
    const models = [
      { name: 'gemini-flash', displayName: 'Gemini Flash' },
      { name: 'claude-opus', displayName: 'Claude Opus' },
    ];
    const original = [...models];
    sortModelsByPriority(models);
    expect(models).toEqual(original);
  });
});

describe('getEarliestResetTime', () => {
  it('returns null for empty array', () => {
    expect(getEarliestResetTime([])).toBeNull();
  });

  it('returns null when all resetTime are null', () => {
    const models = [{ resetTime: null }, { resetTime: null }];
    expect(getEarliestResetTime(models)).toBeNull();
  });

  it('returns earliest reset time', () => {
    const models = [
      { resetTime: '2026-01-01T16:00:00Z' },
      { resetTime: '2026-01-01T14:00:00Z' },
      { resetTime: '2026-01-01T18:00:00Z' },
    ];
    expect(getEarliestResetTime(models)).toBe('2026-01-01T14:00:00Z');
  });

  it('handles mixed null and valid reset times', () => {
    const models = [
      { resetTime: null },
      { resetTime: '2026-01-01T14:00:00Z' },
      { resetTime: null },
    ];
    expect(getEarliestResetTime(models)).toBe('2026-01-01T14:00:00Z');
  });
});

// ==================== Codex Quota Functions ====================

describe('getMinCodexQuota', () => {
  describe('basic functionality', () => {
    it('returns null for empty windows array', () => {
      expect(getMinCodexQuota([])).toBeNull();
    });

    it('returns null for null input', () => {
      expect(getMinCodexQuota(null as unknown as CodexQuotaWindow[])).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(getMinCodexQuota(undefined as unknown as CodexQuotaWindow[])).toBeNull();
    });

    it('returns minimum remaining percent from single window', () => {
      const windows: CodexQuotaWindow[] = [
        {
          label: 'Primary',
          usedPercent: 25,
          remainingPercent: 75,
          resetAfterSeconds: 3600,
          resetAt: '2026-01-30T12:00:00Z',
        },
      ];
      expect(getMinCodexQuota(windows)).toBe(75);
    });

    it('returns minimum remaining percent from multiple windows', () => {
      const windows: CodexQuotaWindow[] = [
        {
          label: 'Primary',
          usedPercent: 20,
          remainingPercent: 80,
          resetAfterSeconds: 3600,
          resetAt: '2026-01-30T12:00:00Z',
        },
        {
          label: 'Secondary',
          usedPercent: 65,
          remainingPercent: 35,
          resetAfterSeconds: 7200,
          resetAt: '2026-01-30T14:00:00Z',
        },
        {
          label: 'Code Review (Primary)',
          usedPercent: 50,
          remainingPercent: 50,
          resetAfterSeconds: 1800,
          resetAt: '2026-01-30T11:00:00Z',
        },
      ];
      expect(getMinCodexQuota(windows)).toBe(35);
    });
  });

  describe('edge cases', () => {
    it('handles 0% remaining quota', () => {
      const windows: CodexQuotaWindow[] = [
        {
          label: 'Primary',
          usedPercent: 100,
          remainingPercent: 0,
          resetAfterSeconds: 3600,
          resetAt: '2026-01-30T12:00:00Z',
        },
        {
          label: 'Secondary',
          usedPercent: 50,
          remainingPercent: 50,
          resetAfterSeconds: 7200,
          resetAt: '2026-01-30T14:00:00Z',
        },
      ];
      expect(getMinCodexQuota(windows)).toBe(0);
    });

    it('handles 100% remaining quota', () => {
      const windows: CodexQuotaWindow[] = [
        {
          label: 'Primary',
          usedPercent: 0,
          remainingPercent: 100,
          resetAfterSeconds: 3600,
          resetAt: '2026-01-30T12:00:00Z',
        },
      ];
      expect(getMinCodexQuota(windows)).toBe(100);
    });

    it('handles negative values (should not occur but test defensive code)', () => {
      const windows: CodexQuotaWindow[] = [
        {
          label: 'Primary',
          usedPercent: 120,
          remainingPercent: -20,
          resetAfterSeconds: 3600,
          resetAt: '2026-01-30T12:00:00Z',
        },
        {
          label: 'Secondary',
          usedPercent: 50,
          remainingPercent: 50,
          resetAfterSeconds: 7200,
          resetAt: '2026-01-30T14:00:00Z',
        },
      ];
      expect(getMinCodexQuota(windows)).toBe(-20);
    });
  });

  describe('real-world scenarios', () => {
    it('matches Codex rate limit response structure', () => {
      const windows: CodexQuotaWindow[] = [
        {
          label: 'Primary',
          usedPercent: 45.2,
          remainingPercent: 54.8,
          resetAfterSeconds: 3456,
          resetAt: '2026-01-30T13:27:36Z',
        },
        {
          label: 'Secondary',
          usedPercent: 78.9,
          remainingPercent: 21.1,
          resetAfterSeconds: 7890,
          resetAt: '2026-01-30T15:41:30Z',
        },
        {
          label: 'Code Review (Primary)',
          usedPercent: 12.5,
          remainingPercent: 87.5,
          resetAfterSeconds: 1234,
          resetAt: '2026-01-30T12:20:34Z',
        },
        {
          label: 'Code Review (Secondary)',
          usedPercent: 91.3,
          remainingPercent: 8.7,
          resetAfterSeconds: 5432,
          resetAt: '2026-01-30T14:30:32Z',
        },
      ];
      // Core account quota should ignore code-review windows.
      expect(getMinCodexQuota(windows)).toBe(21.1);
    });
  });
});

describe('getCodexResetTime', () => {
  describe('basic functionality', () => {
    it('returns null for empty windows array', () => {
      expect(getCodexResetTime([])).toBeNull();
    });

    it('returns null for null input', () => {
      expect(getCodexResetTime(null as unknown as CodexQuotaWindow[])).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(getCodexResetTime(undefined as unknown as CodexQuotaWindow[])).toBeNull();
    });

    it('returns earliest reset time from single window', () => {
      const windows: CodexQuotaWindow[] = [
        {
          label: 'Primary',
          usedPercent: 25,
          remainingPercent: 75,
          resetAfterSeconds: 3600,
          resetAt: '2026-01-30T12:00:00Z',
        },
      ];
      expect(getCodexResetTime(windows)).toBe('2026-01-30T12:00:00Z');
    });

    it('returns earliest reset time from multiple windows', () => {
      const windows: CodexQuotaWindow[] = [
        {
          label: 'Primary',
          usedPercent: 20,
          remainingPercent: 80,
          resetAfterSeconds: 3600,
          resetAt: '2026-01-30T14:00:00Z',
        },
        {
          label: 'Secondary',
          usedPercent: 65,
          remainingPercent: 35,
          resetAfterSeconds: 7200,
          resetAt: '2026-01-30T10:00:00Z',
        },
        {
          label: 'Code Review (Primary)',
          usedPercent: 50,
          remainingPercent: 50,
          resetAfterSeconds: 1800,
          resetAt: '2026-01-30T09:00:00Z',
        },
      ];
      // Should ignore code-review reset when choosing main account reset.
      expect(getCodexResetTime(windows)).toBe('2026-01-30T10:00:00Z');
    });
  });

  describe('edge cases', () => {
    it('returns null when all resetAt are null', () => {
      const windows: CodexQuotaWindow[] = [
        {
          label: 'Primary',
          usedPercent: 25,
          remainingPercent: 75,
          resetAfterSeconds: null,
          resetAt: null,
        },
        {
          label: 'Secondary',
          usedPercent: 50,
          remainingPercent: 50,
          resetAfterSeconds: null,
          resetAt: null,
        },
      ];
      expect(getCodexResetTime(windows)).toBeNull();
    });

    it('handles mixed null and valid reset times', () => {
      const windows: CodexQuotaWindow[] = [
        {
          label: 'Primary',
          usedPercent: 20,
          remainingPercent: 80,
          resetAfterSeconds: null,
          resetAt: null,
        },
        {
          label: 'Secondary',
          usedPercent: 65,
          remainingPercent: 35,
          resetAfterSeconds: 7200,
          resetAt: '2026-01-30T12:00:00Z',
        },
        {
          label: 'Code Review',
          usedPercent: 50,
          remainingPercent: 50,
          resetAfterSeconds: null,
          resetAt: null,
        },
      ];
      expect(getCodexResetTime(windows)).toBe('2026-01-30T12:00:00Z');
    });

    it('sorts timestamps alphabetically (ISO 8601 format)', () => {
      const windows: CodexQuotaWindow[] = [
        {
          label: 'Primary',
          usedPercent: 25,
          remainingPercent: 75,
          resetAfterSeconds: 3600,
          resetAt: '2026-01-30T15:00:00Z',
        },
        {
          label: 'Secondary',
          usedPercent: 50,
          remainingPercent: 50,
          resetAfterSeconds: 1800,
          resetAt: '2026-01-30T09:30:00Z',
        },
        {
          label: 'Code Review',
          usedPercent: 75,
          remainingPercent: 25,
          resetAfterSeconds: 5400,
          resetAt: '2026-01-30T08:15:00Z',
        },
      ];
      // Code-review windows should not drive the main account reset.
      expect(getCodexResetTime(windows)).toBe('2026-01-30T09:30:00Z');
    });
  });
});

describe('getCodexWindowDisplayLabel', () => {
  it('labels code review primary as weekly when it matches usage weekly window', () => {
    const windows: Array<{ label: string; resetAfterSeconds: number | null }> = [
      { label: 'Primary', resetAfterSeconds: 18000 },
      { label: 'Secondary', resetAfterSeconds: 604800 },
      { label: 'Code Review (Primary)', resetAfterSeconds: 600000 },
    ];
    expect(
      getCodexWindowDisplayLabel(
        {
          label: 'Code Review (Primary)',
          resetAfterSeconds: 600000,
        },
        windows
      )
    ).toBe('Code review (weekly)');
  });

  it('labels code review primary as 5h when it matches usage 5h window', () => {
    const windows: Array<{ label: string; resetAfterSeconds: number | null }> = [
      { label: 'Primary', resetAfterSeconds: 18000 },
      { label: 'Secondary', resetAfterSeconds: 604800 },
      { label: 'Code Review (Primary)', resetAfterSeconds: 17000 },
    ];
    expect(
      getCodexWindowDisplayLabel(
        {
          label: 'Code Review (Primary)',
          resetAfterSeconds: 17000,
        },
        windows
      )
    ).toBe('Code review (5h)');
  });

  it('keeps secondary usage label as weekly by default', () => {
    expect(getCodexWindowDisplayLabel('Secondary')).toBe('Weekly usage limit');
  });

  it('falls back to generic code review label when cadence cannot be inferred', () => {
    expect(
      getCodexWindowDisplayLabel({
        label: 'Code Review (Primary)',
        resetAfterSeconds: 604800,
      })
    ).toBe('Code review');
  });
});

// ==================== Gemini Quota Functions ====================

describe('getMinGeminiQuota', () => {
  describe('basic functionality', () => {
    it('returns null for empty buckets array', () => {
      expect(getMinGeminiQuota([])).toBeNull();
    });

    it('returns null for null input', () => {
      expect(getMinGeminiQuota(null as unknown as GeminiCliBucket[])).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(getMinGeminiQuota(undefined as unknown as GeminiCliBucket[])).toBeNull();
    });

    it('returns minimum remaining percent from single bucket', () => {
      const buckets: GeminiCliBucket[] = [
        {
          id: 'gemini-flash-series::input',
          label: 'Gemini Flash Series',
          tokenType: 'input',
          remainingFraction: 0.82,
          remainingPercent: 82,
          resetTime: '2026-01-30T00:00:00Z',
          modelIds: ['gemini-2.5-flash', 'gemini-3-flash'],
        },
      ];
      expect(getMinGeminiQuota(buckets)).toBe(82);
    });

    it('returns minimum remaining percent from multiple buckets', () => {
      const buckets: GeminiCliBucket[] = [
        {
          id: 'gemini-flash-series::input',
          label: 'Gemini Flash Series',
          tokenType: 'input',
          remainingFraction: 0.95,
          remainingPercent: 95,
          resetTime: '2026-01-30T00:00:00Z',
          modelIds: ['gemini-2.5-flash'],
        },
        {
          id: 'gemini-pro-series::input',
          label: 'Gemini Pro Series',
          tokenType: 'input',
          remainingFraction: 0.45,
          remainingPercent: 45,
          resetTime: '2026-01-30T00:00:00Z',
          modelIds: ['gemini-2.5-pro', 'gemini-3-pro'],
        },
        {
          id: 'gemini-flash-series::output',
          label: 'Gemini Flash Series',
          tokenType: 'output',
          remainingFraction: 0.78,
          remainingPercent: 78,
          resetTime: '2026-01-30T00:00:00Z',
          modelIds: ['gemini-2.5-flash'],
        },
      ];
      expect(getMinGeminiQuota(buckets)).toBe(45);
    });
  });

  describe('edge cases', () => {
    it('handles 0% remaining quota', () => {
      const buckets: GeminiCliBucket[] = [
        {
          id: 'gemini-flash-series::input',
          label: 'Gemini Flash Series',
          tokenType: 'input',
          remainingFraction: 0,
          remainingPercent: 0,
          resetTime: '2026-01-30T00:00:00Z',
          modelIds: ['gemini-2.5-flash'],
        },
        {
          id: 'gemini-pro-series::input',
          label: 'Gemini Pro Series',
          tokenType: 'input',
          remainingFraction: 0.5,
          remainingPercent: 50,
          resetTime: '2026-01-30T00:00:00Z',
          modelIds: ['gemini-2.5-pro'],
        },
      ];
      expect(getMinGeminiQuota(buckets)).toBe(0);
    });

    it('handles 100% remaining quota', () => {
      const buckets: GeminiCliBucket[] = [
        {
          id: 'gemini-flash-series::input',
          label: 'Gemini Flash Series',
          tokenType: 'input',
          remainingFraction: 1.0,
          remainingPercent: 100,
          resetTime: '2026-01-30T00:00:00Z',
          modelIds: ['gemini-2.5-flash'],
        },
      ];
      expect(getMinGeminiQuota(buckets)).toBe(100);
    });

    it('handles negative values (should not occur but test defensive code)', () => {
      const buckets: GeminiCliBucket[] = [
        {
          id: 'gemini-flash-series::input',
          label: 'Gemini Flash Series',
          tokenType: 'input',
          remainingFraction: -0.1,
          remainingPercent: -10,
          resetTime: '2026-01-30T00:00:00Z',
          modelIds: ['gemini-2.5-flash'],
        },
        {
          id: 'gemini-pro-series::input',
          label: 'Gemini Pro Series',
          tokenType: 'input',
          remainingFraction: 0.5,
          remainingPercent: 50,
          resetTime: '2026-01-30T00:00:00Z',
          modelIds: ['gemini-2.5-pro'],
        },
      ];
      expect(getMinGeminiQuota(buckets)).toBe(-10);
    });
  });

  describe('real-world scenarios', () => {
    it('matches Gemini CLI response structure', () => {
      const buckets: GeminiCliBucket[] = [
        {
          id: 'gemini-flash-series::input',
          label: 'Gemini Flash Series',
          tokenType: 'input',
          remainingFraction: 0.923,
          remainingPercent: 92.3,
          resetTime: '2026-01-30T00:00:00Z',
          modelIds: ['gemini-2.5-flash', 'gemini-3-flash'],
        },
        {
          id: 'gemini-flash-series::output',
          label: 'Gemini Flash Series',
          tokenType: 'output',
          remainingFraction: 0.867,
          remainingPercent: 86.7,
          resetTime: '2026-01-30T00:00:00Z',
          modelIds: ['gemini-2.5-flash', 'gemini-3-flash'],
        },
        {
          id: 'gemini-pro-series::input',
          label: 'Gemini Pro Series',
          tokenType: 'input',
          remainingFraction: 0.341,
          remainingPercent: 34.1,
          resetTime: '2026-01-30T00:00:00Z',
          modelIds: ['gemini-2.5-pro', 'gemini-3-pro-high', 'gemini-3-pro-low'],
        },
        {
          id: 'gemini-pro-series::output',
          label: 'Gemini Pro Series',
          tokenType: 'output',
          remainingFraction: 0.456,
          remainingPercent: 45.6,
          resetTime: '2026-01-30T00:00:00Z',
          modelIds: ['gemini-2.5-pro', 'gemini-3-pro-high', 'gemini-3-pro-low'],
        },
      ];
      expect(getMinGeminiQuota(buckets)).toBe(34.1);
    });
  });
});

describe('getGeminiResetTime', () => {
  describe('basic functionality', () => {
    it('returns null for empty buckets array', () => {
      expect(getGeminiResetTime([])).toBeNull();
    });

    it('returns null for null input', () => {
      expect(getGeminiResetTime(null as unknown as GeminiCliBucket[])).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(getGeminiResetTime(undefined as unknown as GeminiCliBucket[])).toBeNull();
    });

    it('returns earliest reset time from single bucket', () => {
      const buckets: GeminiCliBucket[] = [
        {
          id: 'gemini-flash-series::input',
          label: 'Gemini Flash Series',
          tokenType: 'input',
          remainingFraction: 0.82,
          remainingPercent: 82,
          resetTime: '2026-01-30T00:00:00Z',
          modelIds: ['gemini-2.5-flash'],
        },
      ];
      expect(getGeminiResetTime(buckets)).toBe('2026-01-30T00:00:00Z');
    });

    it('returns earliest reset time from multiple buckets', () => {
      const buckets: GeminiCliBucket[] = [
        {
          id: 'gemini-flash-series::input',
          label: 'Gemini Flash Series',
          tokenType: 'input',
          remainingFraction: 0.95,
          remainingPercent: 95,
          resetTime: '2026-01-30T12:00:00Z',
          modelIds: ['gemini-2.5-flash'],
        },
        {
          id: 'gemini-pro-series::input',
          label: 'Gemini Pro Series',
          tokenType: 'input',
          remainingFraction: 0.45,
          remainingPercent: 45,
          resetTime: '2026-01-30T06:00:00Z',
          modelIds: ['gemini-2.5-pro'],
        },
        {
          id: 'gemini-flash-series::output',
          label: 'Gemini Flash Series',
          tokenType: 'output',
          remainingFraction: 0.78,
          remainingPercent: 78,
          resetTime: '2026-01-30T18:00:00Z',
          modelIds: ['gemini-2.5-flash'],
        },
      ];
      expect(getGeminiResetTime(buckets)).toBe('2026-01-30T06:00:00Z');
    });
  });

  describe('edge cases', () => {
    it('returns null when all resetTime are null', () => {
      const buckets: GeminiCliBucket[] = [
        {
          id: 'gemini-flash-series::input',
          label: 'Gemini Flash Series',
          tokenType: 'input',
          remainingFraction: 0.82,
          remainingPercent: 82,
          resetTime: null,
          modelIds: ['gemini-2.5-flash'],
        },
        {
          id: 'gemini-pro-series::input',
          label: 'Gemini Pro Series',
          tokenType: 'input',
          remainingFraction: 0.45,
          remainingPercent: 45,
          resetTime: null,
          modelIds: ['gemini-2.5-pro'],
        },
      ];
      expect(getGeminiResetTime(buckets)).toBeNull();
    });

    it('handles mixed null and valid reset times', () => {
      const buckets: GeminiCliBucket[] = [
        {
          id: 'gemini-flash-series::input',
          label: 'Gemini Flash Series',
          tokenType: 'input',
          remainingFraction: 0.95,
          remainingPercent: 95,
          resetTime: null,
          modelIds: ['gemini-2.5-flash'],
        },
        {
          id: 'gemini-pro-series::input',
          label: 'Gemini Pro Series',
          tokenType: 'input',
          remainingFraction: 0.45,
          remainingPercent: 45,
          resetTime: '2026-01-30T00:00:00Z',
          modelIds: ['gemini-2.5-pro'],
        },
        {
          id: 'gemini-flash-series::output',
          label: 'Gemini Flash Series',
          tokenType: 'output',
          remainingFraction: 0.78,
          remainingPercent: 78,
          resetTime: null,
          modelIds: ['gemini-2.5-flash'],
        },
      ];
      expect(getGeminiResetTime(buckets)).toBe('2026-01-30T00:00:00Z');
    });

    it('sorts timestamps alphabetically (ISO 8601 format)', () => {
      const buckets: GeminiCliBucket[] = [
        {
          id: 'gemini-flash-series::input',
          label: 'Gemini Flash Series',
          tokenType: 'input',
          remainingFraction: 0.95,
          remainingPercent: 95,
          resetTime: '2026-01-30T18:00:00Z',
          modelIds: ['gemini-2.5-flash'],
        },
        {
          id: 'gemini-pro-series::input',
          label: 'Gemini Pro Series',
          tokenType: 'input',
          remainingFraction: 0.45,
          remainingPercent: 45,
          resetTime: '2026-01-30T03:30:00Z',
          modelIds: ['gemini-2.5-pro'],
        },
        {
          id: 'gemini-flash-series::output',
          label: 'Gemini Flash Series',
          tokenType: 'output',
          remainingFraction: 0.78,
          remainingPercent: 78,
          resetTime: '2026-01-30T21:45:00Z',
          modelIds: ['gemini-2.5-flash'],
        },
      ];
      expect(getGeminiResetTime(buckets)).toBe('2026-01-30T03:30:00Z');
    });
  });
});

// ==================== Type Guards ====================

describe('isAgyQuotaResult', () => {
  it('returns true for valid Agy quota result', () => {
    const quota: QuotaResult = {
      success: true,
      models: [
        { name: 'claude-opus-4', displayName: 'Claude Opus 4', percentage: 95, resetTime: null },
      ],
      lastUpdated: Date.now(),
    };
    expect(isAgyQuotaResult(quota)).toBe(true);
  });

  it('returns false for Codex quota result', () => {
    const quota: CodexQuotaResult = {
      success: true,
      windows: [],
      planType: 'free',
      lastUpdated: Date.now(),
    };
    expect(isAgyQuotaResult(quota)).toBe(false);
  });

  it('returns false for Gemini quota result', () => {
    const quota: GeminiCliQuotaResult = {
      success: true,
      buckets: [],
      projectId: null,
      lastUpdated: Date.now(),
    };
    expect(isAgyQuotaResult(quota)).toBe(false);
  });

  it('returns true for Agy quota with empty models array', () => {
    const quota: QuotaResult = {
      success: true,
      models: [],
      lastUpdated: Date.now(),
    };
    expect(isAgyQuotaResult(quota)).toBe(true);
  });
});

describe('isCodexQuotaResult', () => {
  it('returns true for valid Codex quota result', () => {
    const quota: CodexQuotaResult = {
      success: true,
      windows: [
        {
          label: 'Primary',
          usedPercent: 25,
          remainingPercent: 75,
          resetAfterSeconds: 3600,
          resetAt: '2026-01-30T12:00:00Z',
        },
      ],
      planType: 'free',
      lastUpdated: Date.now(),
    };
    expect(isCodexQuotaResult(quota)).toBe(true);
  });

  it('returns false for Agy quota result', () => {
    const quota: QuotaResult = {
      success: true,
      models: [],
      lastUpdated: Date.now(),
    };
    expect(isCodexQuotaResult(quota)).toBe(false);
  });

  it('returns false for Gemini quota result', () => {
    const quota: GeminiCliQuotaResult = {
      success: true,
      buckets: [],
      projectId: null,
      lastUpdated: Date.now(),
    };
    expect(isCodexQuotaResult(quota)).toBe(false);
  });

  it('returns true for Codex quota with empty windows array', () => {
    const quota: CodexQuotaResult = {
      success: true,
      windows: [],
      planType: null,
      lastUpdated: Date.now(),
    };
    expect(isCodexQuotaResult(quota)).toBe(true);
  });
});

describe('isClaudeQuotaResult', () => {
  it('returns true for valid Claude quota result', () => {
    const quota: ClaudeQuotaResult = {
      success: true,
      windows: [
        {
          rateLimitType: 'five_hour',
          label: 'Session limit',
          status: 'allowed',
          utilization: 0.5,
          usedPercent: 50,
          remainingPercent: 50,
          resetAt: '2026-01-30T12:00:00Z',
        },
      ],
      coreUsage: {
        fiveHour: {
          rateLimitType: 'five_hour',
          label: 'Session limit',
          remainingPercent: 50,
          resetAt: '2026-01-30T12:00:00Z',
          status: 'allowed',
        },
        weekly: null,
      },
      lastUpdated: Date.now(),
    };
    expect(isClaudeQuotaResult(quota)).toBe(true);
  });

  it('returns false for Codex quota result', () => {
    const quota: CodexQuotaResult = {
      success: true,
      windows: [],
      planType: 'free',
      lastUpdated: Date.now(),
    };
    expect(isClaudeQuotaResult(quota as unknown as ClaudeQuotaResult)).toBe(false);
  });

  it('returns false when Claude windows are malformed', () => {
    const malformed = {
      success: true,
      windows: [{ rateLimitType: 'five_hour', label: 'Session limit' }],
      lastUpdated: Date.now(),
    };
    expect(isClaudeQuotaResult(malformed as unknown as ClaudeQuotaResult)).toBe(false);
  });
});

describe('isGeminiQuotaResult', () => {
  it('returns true for valid Gemini quota result', () => {
    const quota: GeminiCliQuotaResult = {
      success: true,
      buckets: [
        {
          id: 'gemini-flash-series::input',
          label: 'Gemini Flash Series',
          tokenType: 'input',
          remainingFraction: 0.82,
          remainingPercent: 82,
          resetTime: '2026-01-30T00:00:00Z',
          modelIds: ['gemini-2.5-flash'],
        },
      ],
      projectId: 'my-project-123',
      lastUpdated: Date.now(),
    };
    expect(isGeminiQuotaResult(quota)).toBe(true);
  });

  it('returns false for Agy quota result', () => {
    const quota: QuotaResult = {
      success: true,
      models: [],
      lastUpdated: Date.now(),
    };
    expect(isGeminiQuotaResult(quota)).toBe(false);
  });

  it('returns false for Codex quota result', () => {
    const quota: CodexQuotaResult = {
      success: true,
      windows: [],
      planType: 'free',
      lastUpdated: Date.now(),
    };
    expect(isGeminiQuotaResult(quota)).toBe(false);
  });

  it('returns true for Gemini quota with empty buckets array', () => {
    const quota: GeminiCliQuotaResult = {
      success: true,
      buckets: [],
      projectId: null,
      lastUpdated: Date.now(),
    };
    expect(isGeminiQuotaResult(quota)).toBe(true);
  });
});

describe('isGhcpQuotaResult', () => {
  it('returns true for valid GHCP quota result', () => {
    const quota: GhcpQuotaResult = {
      success: true,
      planType: 'individual',
      quotaResetDate: '2026-01-31T00:00:00Z',
      snapshots: {
        premiumInteractions: {
          entitlement: 300,
          remaining: 120,
          used: 180,
          percentRemaining: 40,
          percentUsed: 60,
          unlimited: false,
          overageCount: 0,
          overagePermitted: false,
          quotaId: 'premium_interactions',
        },
        chat: {
          entitlement: 999999,
          remaining: 999999,
          used: 0,
          percentRemaining: 100,
          percentUsed: 0,
          unlimited: true,
          overageCount: 0,
          overagePermitted: true,
          quotaId: 'chat',
        },
        completions: {
          entitlement: 5000,
          remaining: 4200,
          used: 800,
          percentRemaining: 84,
          percentUsed: 16,
          unlimited: false,
          overageCount: 0,
          overagePermitted: false,
          quotaId: 'completions',
        },
      },
      lastUpdated: Date.now(),
    };
    expect(isGhcpQuotaResult(quota)).toBe(true);
  });

  it('returns false for non-GHCP quota result', () => {
    const quota: GeminiCliQuotaResult = {
      success: true,
      buckets: [],
      projectId: null,
      lastUpdated: Date.now(),
    };
    expect(isGhcpQuotaResult(quota)).toBe(false);
  });
});

// ==================== Unified Provider Helpers ====================

describe('getProviderMinQuota', () => {
  describe('agy provider', () => {
    it('returns minimum quota from Claude models', () => {
      const models: ModelQuota[] = [
        { name: 'claude-opus-4', displayName: 'Claude Opus 4', percentage: 85, resetTime: null },
        {
          name: 'claude-sonnet-4',
          displayName: 'Claude Sonnet 4',
          percentage: 92,
          resetTime: null,
        },
        {
          name: 'gemini-2.5-flash',
          displayName: 'Gemini 2.5 Flash',
          percentage: 100,
          resetTime: null,
        },
      ];
      const quota: QuotaResult = { success: true, models, lastUpdated: Date.now() };
      expect(getProviderMinQuota('agy', quota)).toBe(85);
    });

    it('returns null when quota is null', () => {
      expect(getProviderMinQuota('agy', null)).toBeNull();
    });

    it('returns null when quota is undefined', () => {
      expect(getProviderMinQuota('agy', undefined)).toBeNull();
    });

    it('returns null when success is false', () => {
      const quota: QuotaResult = {
        success: false,
        models: [],
        lastUpdated: Date.now(),
        error: 'Failed',
      };
      expect(getProviderMinQuota('agy', quota)).toBeNull();
    });

    it('returns null when quota is wrong type', () => {
      const quota: CodexQuotaResult = {
        success: true,
        windows: [],
        planType: 'free',
        lastUpdated: Date.now(),
      };
      expect(getProviderMinQuota('agy', quota)).toBeNull();
    });
  });

  describe('codex provider', () => {
    it('returns minimum quota from windows', () => {
      const windows: CodexQuotaWindow[] = [
        {
          label: 'Primary',
          usedPercent: 20,
          remainingPercent: 80,
          resetAfterSeconds: 3600,
          resetAt: '2026-01-30T12:00:00Z',
        },
        {
          label: 'Secondary',
          usedPercent: 65,
          remainingPercent: 35,
          resetAfterSeconds: 7200,
          resetAt: '2026-01-30T14:00:00Z',
        },
      ];
      const quota: CodexQuotaResult = {
        success: true,
        windows,
        planType: 'free',
        lastUpdated: Date.now(),
      };
      expect(getProviderMinQuota('codex', quota)).toBe(35);
    });

    it('returns null when quota is null', () => {
      expect(getProviderMinQuota('codex', null)).toBeNull();
    });

    it('returns null when success is false', () => {
      const quota: CodexQuotaResult = {
        success: false,
        windows: [],
        planType: null,
        lastUpdated: Date.now(),
        error: 'Failed',
      };
      expect(getProviderMinQuota('codex', quota)).toBeNull();
    });

    it('returns null when quota is wrong type', () => {
      const quota: QuotaResult = { success: true, models: [], lastUpdated: Date.now() };
      expect(getProviderMinQuota('codex', quota)).toBeNull();
    });
  });

  describe('gemini provider', () => {
    it('returns minimum quota from buckets', () => {
      const buckets: GeminiCliBucket[] = [
        {
          id: 'gemini-flash-series::input',
          label: 'Gemini Flash Series',
          tokenType: 'input',
          remainingFraction: 0.95,
          remainingPercent: 95,
          resetTime: '2026-01-30T00:00:00Z',
          modelIds: ['gemini-2.5-flash'],
        },
        {
          id: 'gemini-pro-series::input',
          label: 'Gemini Pro Series',
          tokenType: 'input',
          remainingFraction: 0.45,
          remainingPercent: 45,
          resetTime: '2026-01-30T00:00:00Z',
          modelIds: ['gemini-2.5-pro'],
        },
      ];
      const quota: GeminiCliQuotaResult = {
        success: true,
        buckets,
        projectId: 'test',
        lastUpdated: Date.now(),
      };
      expect(getProviderMinQuota('gemini', quota)).toBe(45);
    });

    it('returns null when quota is null', () => {
      expect(getProviderMinQuota('gemini', null)).toBeNull();
    });

    it('returns null when success is false', () => {
      const quota: GeminiCliQuotaResult = {
        success: false,
        buckets: [],
        projectId: null,
        lastUpdated: Date.now(),
        error: 'Failed',
      };
      expect(getProviderMinQuota('gemini', quota)).toBeNull();
    });

    it('returns null when quota is wrong type', () => {
      const quota: QuotaResult = { success: true, models: [], lastUpdated: Date.now() };
      expect(getProviderMinQuota('gemini', quota)).toBeNull();
    });
  });

  describe('ghcp provider', () => {
    it('returns minimum quota from snapshots', () => {
      const quota: GhcpQuotaResult = {
        success: true,
        planType: 'individual',
        quotaResetDate: '2026-01-31T00:00:00Z',
        snapshots: {
          premiumInteractions: {
            entitlement: 300,
            remaining: 90,
            used: 210,
            percentRemaining: 30,
            percentUsed: 70,
            unlimited: false,
            overageCount: 0,
            overagePermitted: false,
            quotaId: 'premium_interactions',
          },
          chat: {
            entitlement: 1000,
            remaining: 1000,
            used: 0,
            percentRemaining: 100,
            percentUsed: 0,
            unlimited: true,
            overageCount: 0,
            overagePermitted: true,
            quotaId: 'chat',
          },
          completions: {
            entitlement: 5000,
            remaining: 2750,
            used: 2250,
            percentRemaining: 55,
            percentUsed: 45,
            unlimited: false,
            overageCount: 0,
            overagePermitted: false,
            quotaId: 'completions',
          },
        },
        lastUpdated: Date.now(),
      };
      expect(getProviderMinQuota('ghcp', quota)).toBe(30);
    });

    it('supports github-copilot alias', () => {
      const quota: GhcpQuotaResult = {
        success: true,
        planType: 'individual',
        quotaResetDate: null,
        snapshots: {
          premiumInteractions: {
            entitlement: 300,
            remaining: 150,
            used: 150,
            percentRemaining: 50,
            percentUsed: 50,
            unlimited: false,
            overageCount: 0,
            overagePermitted: false,
            quotaId: null,
          },
          chat: {
            entitlement: 1000,
            remaining: 900,
            used: 100,
            percentRemaining: 90,
            percentUsed: 10,
            unlimited: false,
            overageCount: 0,
            overagePermitted: false,
            quotaId: null,
          },
          completions: {
            entitlement: 1000,
            remaining: 800,
            used: 200,
            percentRemaining: 80,
            percentUsed: 20,
            unlimited: false,
            overageCount: 0,
            overagePermitted: false,
            quotaId: null,
          },
        },
        lastUpdated: Date.now(),
      };
      expect(getProviderMinQuota('github-copilot', quota)).toBe(50);
    });

    it('returns null when GHCP quota fetch failed', () => {
      const quota: GhcpQuotaResult = {
        success: false,
        planType: null,
        quotaResetDate: null,
        snapshots: {
          premiumInteractions: {
            entitlement: 0,
            remaining: 0,
            used: 0,
            percentRemaining: 0,
            percentUsed: 0,
            unlimited: false,
            overageCount: 0,
            overagePermitted: false,
            quotaId: null,
          },
          chat: {
            entitlement: 0,
            remaining: 0,
            used: 0,
            percentRemaining: 0,
            percentUsed: 0,
            unlimited: false,
            overageCount: 0,
            overagePermitted: false,
            quotaId: null,
          },
          completions: {
            entitlement: 0,
            remaining: 0,
            used: 0,
            percentRemaining: 0,
            percentUsed: 0,
            unlimited: false,
            overageCount: 0,
            overagePermitted: false,
            quotaId: null,
          },
        },
        lastUpdated: Date.now(),
        error: 'Failed',
      };
      expect(getProviderMinQuota('ghcp', quota)).toBeNull();
    });
  });

  describe('unknown provider', () => {
    it('returns null for unknown provider', () => {
      const quota: QuotaResult = { success: true, models: [], lastUpdated: Date.now() };
      expect(getProviderMinQuota('unknown', quota)).toBeNull();
    });

    it('returns null for empty provider name', () => {
      const quota: QuotaResult = { success: true, models: [], lastUpdated: Date.now() };
      expect(getProviderMinQuota('', quota)).toBeNull();
    });
  });
});

describe('getProviderResetTime', () => {
  describe('agy provider', () => {
    it('returns earliest reset time from Claude models', () => {
      const models: ModelQuota[] = [
        {
          name: 'claude-opus-4',
          displayName: 'Claude Opus 4',
          percentage: 85,
          resetTime: '2026-01-30T14:00:00Z',
        },
        {
          name: 'claude-sonnet-4',
          displayName: 'Claude Sonnet 4',
          percentage: 92,
          resetTime: '2026-01-30T10:00:00Z',
        },
        {
          name: 'gemini-2.5-flash',
          displayName: 'Gemini 2.5 Flash',
          percentage: 100,
          resetTime: '2026-01-30T12:00:00Z',
        },
      ];
      const quota: QuotaResult = { success: true, models, lastUpdated: Date.now() };
      expect(getProviderResetTime('agy', quota)).toBe('2026-01-30T10:00:00Z');
    });

    it('returns null when quota is null', () => {
      expect(getProviderResetTime('agy', null)).toBeNull();
    });

    it('returns null when success is false', () => {
      const quota: QuotaResult = {
        success: false,
        models: [],
        lastUpdated: Date.now(),
        error: 'Failed',
      };
      expect(getProviderResetTime('agy', quota)).toBeNull();
    });

    it('returns null when quota is wrong type', () => {
      const quota: CodexQuotaResult = {
        success: true,
        windows: [],
        planType: 'free',
        lastUpdated: Date.now(),
      };
      expect(getProviderResetTime('agy', quota)).toBeNull();
    });
  });

  describe('codex provider', () => {
    it('returns earliest reset time from windows', () => {
      const windows: CodexQuotaWindow[] = [
        {
          label: 'Primary',
          usedPercent: 20,
          remainingPercent: 80,
          resetAfterSeconds: 3600,
          resetAt: '2026-01-30T14:00:00Z',
        },
        {
          label: 'Secondary',
          usedPercent: 65,
          remainingPercent: 35,
          resetAfterSeconds: 7200,
          resetAt: '2026-01-30T10:00:00Z',
        },
      ];
      const quota: CodexQuotaResult = {
        success: true,
        windows,
        planType: 'free',
        lastUpdated: Date.now(),
      };
      expect(getProviderResetTime('codex', quota)).toBe('2026-01-30T10:00:00Z');
    });

    it('returns null when quota is null', () => {
      expect(getProviderResetTime('codex', null)).toBeNull();
    });

    it('returns null when success is false', () => {
      const quota: CodexQuotaResult = {
        success: false,
        windows: [],
        planType: null,
        lastUpdated: Date.now(),
        error: 'Failed',
      };
      expect(getProviderResetTime('codex', quota)).toBeNull();
    });

    it('returns null when quota is wrong type', () => {
      const quota: QuotaResult = { success: true, models: [], lastUpdated: Date.now() };
      expect(getProviderResetTime('codex', quota)).toBeNull();
    });
  });

  describe('gemini provider', () => {
    it('returns earliest reset time from buckets', () => {
      const buckets: GeminiCliBucket[] = [
        {
          id: 'gemini-flash-series::input',
          label: 'Gemini Flash Series',
          tokenType: 'input',
          remainingFraction: 0.95,
          remainingPercent: 95,
          resetTime: '2026-01-30T12:00:00Z',
          modelIds: ['gemini-2.5-flash'],
        },
        {
          id: 'gemini-pro-series::input',
          label: 'Gemini Pro Series',
          tokenType: 'input',
          remainingFraction: 0.45,
          remainingPercent: 45,
          resetTime: '2026-01-30T06:00:00Z',
          modelIds: ['gemini-2.5-pro'],
        },
      ];
      const quota: GeminiCliQuotaResult = {
        success: true,
        buckets,
        projectId: 'test',
        lastUpdated: Date.now(),
      };
      expect(getProviderResetTime('gemini', quota)).toBe('2026-01-30T06:00:00Z');
    });

    it('returns null when quota is null', () => {
      expect(getProviderResetTime('gemini', null)).toBeNull();
    });

    it('returns null when success is false', () => {
      const quota: GeminiCliQuotaResult = {
        success: false,
        buckets: [],
        projectId: null,
        lastUpdated: Date.now(),
        error: 'Failed',
      };
      expect(getProviderResetTime('gemini', quota)).toBeNull();
    });

    it('returns null when quota is wrong type', () => {
      const quota: QuotaResult = { success: true, models: [], lastUpdated: Date.now() };
      expect(getProviderResetTime('gemini', quota)).toBeNull();
    });
  });

  describe('ghcp provider', () => {
    it('returns quota reset date', () => {
      const quota: GhcpQuotaResult = {
        success: true,
        planType: 'individual',
        quotaResetDate: '2026-01-31T00:00:00Z',
        snapshots: {
          premiumInteractions: {
            entitlement: 300,
            remaining: 120,
            used: 180,
            percentRemaining: 40,
            percentUsed: 60,
            unlimited: false,
            overageCount: 0,
            overagePermitted: false,
            quotaId: null,
          },
          chat: {
            entitlement: 1000,
            remaining: 900,
            used: 100,
            percentRemaining: 90,
            percentUsed: 10,
            unlimited: false,
            overageCount: 0,
            overagePermitted: false,
            quotaId: null,
          },
          completions: {
            entitlement: 5000,
            remaining: 2500,
            used: 2500,
            percentRemaining: 50,
            percentUsed: 50,
            unlimited: false,
            overageCount: 0,
            overagePermitted: false,
            quotaId: null,
          },
        },
        lastUpdated: Date.now(),
      };
      expect(getProviderResetTime('ghcp', quota)).toBe('2026-01-31T00:00:00Z');
      expect(getProviderResetTime('github-copilot', quota)).toBe('2026-01-31T00:00:00Z');
    });

    it('returns null when GHCP quota fetch failed', () => {
      const quota: GhcpQuotaResult = {
        success: false,
        planType: null,
        quotaResetDate: null,
        snapshots: {
          premiumInteractions: {
            entitlement: 0,
            remaining: 0,
            used: 0,
            percentRemaining: 0,
            percentUsed: 0,
            unlimited: false,
            overageCount: 0,
            overagePermitted: false,
            quotaId: null,
          },
          chat: {
            entitlement: 0,
            remaining: 0,
            used: 0,
            percentRemaining: 0,
            percentUsed: 0,
            unlimited: false,
            overageCount: 0,
            overagePermitted: false,
            quotaId: null,
          },
          completions: {
            entitlement: 0,
            remaining: 0,
            used: 0,
            percentRemaining: 0,
            percentUsed: 0,
            unlimited: false,
            overageCount: 0,
            overagePermitted: false,
            quotaId: null,
          },
        },
        lastUpdated: Date.now(),
        error: 'Failed',
      };
      expect(getProviderResetTime('ghcp', quota)).toBeNull();
    });
  });

  describe('unknown provider', () => {
    it('returns null for unknown provider', () => {
      const quota: QuotaResult = { success: true, models: [], lastUpdated: Date.now() };
      expect(getProviderResetTime('unknown', quota)).toBeNull();
    });

    it('returns null for empty provider name', () => {
      const quota: QuotaResult = { success: true, models: [], lastUpdated: Date.now() };
      expect(getProviderResetTime('', quota)).toBeNull();
    });
  });
});

describe('getQuotaFailureInfo', () => {
  it('maps reauth failures to a clear reauth badge and technical detail', () => {
    const quota: CodexQuotaResult = {
      success: false,
      windows: [],
      planType: null,
      lastUpdated: Date.now(),
      error: 'Codex token expired or invalid',
      needsReauth: true,
      httpStatus: 401,
      errorCode: 'reauth_required',
      errorDetail: '{"detail":"session expired"}',
    };

    expect(getQuotaFailureInfo(quota)).toEqual({
      label: 'Re-auth required',
      summary: 'Codex token expired or invalid',
      actionHint: 'Token expired. Re-authenticate this account.',
      technicalDetail: 'HTTP 401 | reauth_required',
      rawDetail: '{"detail":"session expired"}',
      tone: 'warning',
    });
  });

  it('maps 402 workspace failures to a workspace badge and actionable hint', () => {
    const quota: CodexQuotaResult = {
      success: false,
      windows: [],
      planType: null,
      lastUpdated: Date.now(),
      error: 'Workspace deactivated (HTTP 402)',
      httpStatus: 402,
      errorCode: 'deactivated_workspace',
      errorDetail: '{"detail":{"code":"deactivated_workspace"}}',
    };

    expect(getQuotaFailureInfo(quota)).toEqual({
      label: 'Workspace access denied',
      summary: 'Workspace deactivated (HTTP 402)',
      actionHint: 'Account lacks workspace access.',
      technicalDetail: 'HTTP 402 | deactivated_workspace',
      rawDetail: '{"detail":{"code":"deactivated_workspace"}}',
      tone: 'warning',
    });
  });

  it('maps retryable network failures to a temporary badge', () => {
    const quota: GeminiCliQuotaResult = {
      success: false,
      buckets: [],
      projectId: null,
      lastUpdated: Date.now(),
      error: 'Network timeout while fetching quota',
      errorCode: 'network_timeout',
      retryable: true,
      errorDetail: 'ETIMEDOUT',
    };

    expect(getQuotaFailureInfo(quota)).toEqual({
      label: 'Temporary issue',
      summary: 'Network timeout while fetching quota',
      actionHint: 'Transient error. Usually resolves quickly.',
      technicalDetail: 'network_timeout',
      rawDetail: 'ETIMEDOUT',
      tone: 'warning',
    });
  });

  it('returns null when quota fetch succeeded', () => {
    const quota: QuotaResult = {
      success: true,
      models: [],
      lastUpdated: Date.now(),
    };

    expect(getQuotaFailureInfo(quota)).toBeNull();
  });

  it('suppresses raw detail when it only duplicates the summary', () => {
    const quota: CodexQuotaResult = {
      success: false,
      windows: [],
      planType: null,
      lastUpdated: Date.now(),
      error: 'Quota fetch failed',
      errorDetail: 'Quota fetch failed',
    };

    expect(getQuotaFailureInfo(quota)).toEqual({
      label: 'Temporary issue',
      summary: 'Quota fetch failed',
      actionHint: 'Transient error. Usually resolves quickly.',
      technicalDetail: null,
      rawDetail: null,
      tone: 'warning',
    });
  });
});
