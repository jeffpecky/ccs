/**
 * Small helpers for consistent CLI option extraction.
 */

export interface ExtractedOption {
  found: boolean;
  value?: string;
  missingValue: boolean;
  remainingArgs: string[];
}

export interface ExtractOptionOptions {
  /**
   * Allow values that start with "-" when they are not recognized flags.
   * Useful for model IDs or other arbitrary strings.
   */
  allowDashValue?: boolean;
  /**
   * Allow values that start with "--" when allowDashValue is enabled.
   * Keep this opt-in narrow so unknown long flags are still rejected by default.
   */
  allowLongDashValue?: boolean;
  /**
   * Known flags for the current command. Used with allowDashValue to avoid
   * treating a real flag token as a value.
   */
  knownFlags?: readonly string[];
}

export interface ScanCommandArgsOptions {
  knownFlags: readonly string[];
  valueFlags?: readonly string[];
  allowDashValue?: boolean;
}

export interface ScannedCommandArgs {
  positionals: string[];
  unknownFlags: string[];
}

function findInlineOption(arg: string, flag: string): string | undefined {
  const prefix = `${flag}=`;
  return arg.startsWith(prefix) ? arg.slice(prefix.length) : undefined;
}

function isKnownFlagToken(token: string, knownFlags: readonly string[] | undefined): boolean {
  if (!knownFlags || knownFlags.length === 0) {
    return false;
  }

  return knownFlags.some((flag) => token === flag || token.startsWith(`${flag}=`));
}

function findMatchingFlagToken(
  token: string,
  knownFlags: readonly string[] | undefined
): string | undefined {
  if (!knownFlags || knownFlags.length === 0) {
    return undefined;
  }

  return knownFlags.find((flag) => token === flag || token.startsWith(`${flag}=`));
}

/**
 * Extract a single-value option and remove it from args.
 * Supports `--flag value` and `--flag=value` forms.
 */
export function extractOption(
  args: string[],
  flags: readonly string[],
  options: ExtractOptionOptions = {}
): ExtractedOption {
  const remaining = [...args];
  const allowDashValue = options.allowDashValue ?? false;
  const allowLongDashValue = options.allowLongDashValue ?? false;

  for (let i = 0; i < remaining.length; i++) {
    const token = remaining[i];

    for (const flag of flags) {
      if (token === flag) {
        const next = remaining[i + 1];
        if (!next) {
          remaining.splice(i, 1);
          return { found: true, missingValue: true, remainingArgs: remaining };
        }

        const nextLooksLikeFlag = next.startsWith('-');
        const nextLooksLikeLongFlag = next.startsWith('--');
        const nextIsKnownFlag = isKnownFlagToken(next, options.knownFlags);
        const canTreatAsDashValue =
          allowDashValue && !nextIsKnownFlag && (!nextLooksLikeLongFlag || allowLongDashValue);
        if (nextLooksLikeFlag && !canTreatAsDashValue) {
          remaining.splice(i, 1);
          return { found: true, missingValue: true, remainingArgs: remaining };
        }

        remaining.splice(i, 2);
        return {
          found: true,
          value: next,
          missingValue: false,
          remainingArgs: remaining,
        };
      }

      const inlineValue = findInlineOption(token, flag);
      if (inlineValue !== undefined) {
        remaining.splice(i, 1);
        if (!inlineValue.trim()) {
          return { found: true, missingValue: true, remainingArgs: remaining };
        }
        return {
          found: true,
          value: inlineValue,
          missingValue: false,
          remainingArgs: remaining,
        };
      }
    }
  }

  return { found: false, missingValue: false, remainingArgs: remaining };
}

/** Returns true if any of the provided boolean flags are present. */
export function hasAnyFlag(args: string[], flags: readonly string[]): boolean {
  const truthyValues = new Set(['1', 'true', 'yes', 'on']);
  return args.some((arg) =>
    flags.some((flag) => {
      if (arg === flag) {
        return true;
      }

      const prefix = `${flag}=`;
      if (!arg.startsWith(prefix)) {
        return false;
      }

      const value = arg.slice(prefix.length).trim().toLowerCase();
      return truthyValues.has(value);
    })
  );
}

export function scanCommandArgs(
  args: string[],
  options: ScanCommandArgsOptions
): ScannedCommandArgs {
  const positionals: string[] = [];
  const unknownFlags: string[] = [];
  const allowDashValue = options.allowDashValue ?? false;
  const valueFlags = new Set(options.valueFlags ?? []);

  for (let i = 0; i < args.length; i++) {
    const token = args[i];

    if (token === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }

    if (token === '-' || !token.startsWith('-')) {
      positionals.push(token);
      continue;
    }

    const matchedFlag = findMatchingFlagToken(token, options.knownFlags);
    if (!matchedFlag) {
      unknownFlags.push(token);
      continue;
    }

    if (!valueFlags.has(matchedFlag) || token.includes('=')) {
      continue;
    }

    const next = args[i + 1];
    if (!next) {
      continue;
    }

    const nextLooksLikeFlag = next.startsWith('-');
    const nextLooksLikeLongFlag = next.startsWith('--');
    const nextIsKnownFlag = isKnownFlagToken(next, options.knownFlags);
    if (!nextLooksLikeFlag || (allowDashValue && !nextIsKnownFlag && !nextLooksLikeLongFlag)) {
      i++;
    }
  }

  return { positionals, unknownFlags };
}
