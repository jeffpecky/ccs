/**
 * Tests for executor option-value parsing.
 *
 * readOptionValue/hasGitLabTokenLoginFlag live in arg-parser.ts (the
 * old execClaudeWithCLIProxy CLI wrapper was removed when the executor moved
 * to dashboard-driven startup).
 */

import { describe, expect, it } from 'bun:test';
import { hasGitLabTokenLoginFlag, readOptionValue } from '../arg-parser';

describe('readOptionValue', () => {
  it('parses split-token option values', () => {
    expect(
      readOptionValue(
        ['--kiro-idc-start-url', 'https://d-123.awsapps.com/start'],
        '--kiro-idc-start-url'
      )
    ).toEqual({
      present: true,
      value: 'https://d-123.awsapps.com/start',
      missingValue: false,
    });
  });

  it('parses equals-form option values', () => {
    expect(readOptionValue(['--kiro-idc-flow=device'], '--kiro-idc-flow')).toEqual({
      present: true,
      value: 'device',
      missingValue: false,
    });
  });

  it('marks empty or missing values as invalid', () => {
    expect(readOptionValue(['--kiro-idc-region'], '--kiro-idc-region')).toEqual({
      present: true,
      value: undefined,
      missingValue: true,
    });
    expect(readOptionValue(['--kiro-idc-flow='], '--kiro-idc-flow')).toEqual({
      present: true,
      value: undefined,
      missingValue: true,
    });
  });

  it('treats both GitLab token-login flags as enabled', () => {
    expect(hasGitLabTokenLoginFlag(['--gitlab-token-login'])).toBe(true);
    expect(hasGitLabTokenLoginFlag(['--token-login'])).toBe(true);
    expect(hasGitLabTokenLoginFlag(['--gitlab-url', 'https://gitlab.example.com'])).toBe(false);
  });
});
