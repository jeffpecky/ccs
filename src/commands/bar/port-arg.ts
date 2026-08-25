/**
 * Shared `--port N` / `--launch-id <id>` flag parsing for the `ccs bar`
 * command family.
 *
 * `present` distinguishes "flag not given" from "flag given with a bad value"
 * so launch can reject typos loudly instead of silently falling back to the
 * default port list.
 */

import { isValidLaunchId } from './bar-paths';

export interface PortFlag {
  /** True when `--port` appears in args at all. */
  present: boolean;
  /** The parsed port (1-65535), or null when absent or invalid. */
  port: number | null;
}

export interface LaunchIdFlag {
  /** True when `--launch-id` appears in args at all. */
  present: boolean;
  /** The validated launch id, or null when absent or malformed. */
  launchId: string | null;
}

const KNOWN_VALUE_OPTIONS = new Set(['--port', '--launch-id']);

export function validatePortArgs(args: string[]): string | null {
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!KNOWN_VALUE_OPTIONS.has(arg)) return `Unknown option: ${arg}`;
    if (seen.has(arg)) return `Duplicate option: ${arg}`;
    seen.add(arg);
    const raw = args[index + 1];
    if (raw === undefined) return `Missing value for ${arg}`;
    index += 1;
  }
  return null;
}

export function parsePortFlag(args: string[]): PortFlag {
  const idx = args.indexOf('--port');
  if (idx === -1) return { present: false, port: null };
  const raw = args[idx + 1];
  if (raw === undefined || !/^[1-9]\d{0,4}$/.test(raw)) {
    return { present: true, port: null };
  }
  const n = Number(raw);
  const valid = Number.isSafeInteger(n) && n <= 65535;
  return { present: true, port: valid ? n : null };
}

export function parseLaunchIdFlag(args: string[]): LaunchIdFlag {
  const idx = args.indexOf('--launch-id');
  if (idx === -1) return { present: false, launchId: null };
  const raw = args[idx + 1];
  if (raw === undefined) return { present: true, launchId: null };
  return { present: true, launchId: isValidLaunchId(raw) ? raw : null };
}
