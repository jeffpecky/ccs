/**
 * Codex local quota collector (zero network).
 *
 * Codex writes a `rate_limits` object into its rollout session logs
 * (~/.codex/sessions/<y>/<m>/<d>/rollout-*.jsonl). We read the most recent
 * session's last non-null rate_limits to surface the user's Codex subscription
 * quota WITHOUT any network call — pure local file read.
 *
 * Exec-mode sessions often never emit rate_limits (the field stays null); in
 * that case we return null so the bar simply omits the Codex row rather than
 * inventing a fake one.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveCodexConfigPaths } from '../services/codex-dashboard-service';

/** Normalized Codex quota snapshot from a local session log. */
export interface CodexLocalQuota {
  /** Remaining percentage (0-100): min across primary/secondary windows. */
  quotaPercentage: number;
  /** ISO timestamp of the soonest window reset, null if unknown. */
  nextReset: string | null;
  /** plan_type from the session (e.g. "pro"/"plus"), null if absent. */
  tier: string | null;
  /** True when the source file is older than the freshness window. */
  stale: boolean;
}

/** Injectable seams for deterministic tests (no real fs / no tail subprocess). */
export interface CodexLocalQuotaDeps {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  existsSyncImpl?: (p: string) => boolean;
  readdirImpl?: (dir: string) => fs.Dirent[];
  statMtimeMsImpl?: (p: string) => number;
  /** Returns the last N lines of a file (default: Bun tail). */
  tailLinesImpl?: (file: string, lines: number) => Promise<string[]>;
  now?: number;
}

/** Lines to scan from the tail; rate_limits sits near the end of a session. */
const TAIL_LINES = 200;

/** A source older than this is reported stale (but still emitted). */
const STALE_AFTER_MS = 5 * 60 * 1000;

interface CodexRateWindow {
  usedPercent: number;
  resetsAtSeconds: number | null;
}

interface CodexRateLimits {
  primary: CodexRateWindow | null;
  secondary: CodexRateWindow | null;
  planType: string | null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseWindow(value: unknown): CodexRateWindow | null {
  const obj = asObject(value);
  if (!obj) return null;
  const usedPercent = asFiniteNumber(obj['used_percent']);
  if (usedPercent === null) return null;
  return {
    usedPercent,
    resetsAtSeconds: asFiniteNumber(obj['resets_at']),
  };
}

/**
 * Extract a non-null rate_limits object from a parsed JSONL line.
 * rate_limits lives under `payload` in the token_count event.
 */
function extractRateLimits(line: string): CodexRateLimits | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const root = asObject(parsed);
  if (!root) return null;

  const payload = asObject(root['payload']) ?? root;
  const rateLimits = asObject(payload['rate_limits']);
  if (!rateLimits) return null;

  const primary = parseWindow(rateLimits['primary']);
  const secondary = parseWindow(rateLimits['secondary']);
  // A rate_limits object with neither window carries no usable signal.
  if (!primary && !secondary) return null;

  const planType =
    typeof rateLimits['plan_type'] === 'string' && rateLimits['plan_type'].trim().length > 0
      ? (rateLimits['plan_type'] as string).trim()
      : null;

  return { primary, secondary, planType };
}

/** Recursive rollout-*.jsonl walker, lexicographically sorted (ISO ts in name). */
function collectRolloutFiles(
  dir: string,
  existsImpl: (p: string) => boolean,
  readdirImpl: (d: string) => fs.Dirent[]
): string[] {
  if (!existsImpl(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirImpl(dir)) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectRolloutFiles(entryPath, existsImpl, readdirImpl));
      continue;
    }
    if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
      files.push(entryPath);
    }
  }
  return files.sort();
}

/**
 * Default tail using Bun.spawn (macOS-safe: no tac, no GNU timeout).
 * Reads the last `lines` lines so we never load a huge session into memory.
 */
async function defaultTailLines(file: string, lines: number): Promise<string[]> {
  const proc = Bun.spawn(['tail', `-${lines}`, file], {
    stdout: 'pipe',
    stderr: 'ignore',
  });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return text.split('\n').filter((l) => l.trim().length > 0);
}

function computeQuotaPercentage(rate: CodexRateLimits): number {
  const remaining: number[] = [];
  if (rate.primary) remaining.push(100 - rate.primary.usedPercent);
  if (rate.secondary) remaining.push(100 - rate.secondary.usedPercent);
  // Clamp into [0,100] to guard against odd upstream values.
  return Math.max(0, Math.min(100, Math.min(...remaining)));
}

function computeNextReset(rate: CodexRateLimits): string | null {
  const resets: number[] = [];
  if (rate.primary?.resetsAtSeconds !== null && rate.primary?.resetsAtSeconds !== undefined) {
    resets.push(rate.primary.resetsAtSeconds);
  }
  if (rate.secondary?.resetsAtSeconds !== null && rate.secondary?.resetsAtSeconds !== undefined) {
    resets.push(rate.secondary.resetsAtSeconds);
  }
  if (resets.length === 0) return null;
  return new Date(Math.min(...resets) * 1000).toISOString();
}

/**
 * Read the latest Codex session's most recent rate_limits and normalize it.
 * Returns null when no session carries a usable rate_limits object.
 */
export async function getCodexLocalQuota(
  deps: CodexLocalQuotaDeps = {}
): Promise<CodexLocalQuota | null> {
  const existsImpl = deps.existsSyncImpl ?? fs.existsSync;
  const readdirImpl =
    deps.readdirImpl ?? ((dir: string) => fs.readdirSync(dir, { withFileTypes: true }));
  const statMtimeMsImpl = deps.statMtimeMsImpl ?? ((p: string) => fs.statSync(p).mtimeMs);
  const tailLinesImpl = deps.tailLinesImpl ?? defaultTailLines;
  const now = deps.now ?? Date.now();

  const { baseDir } = resolveCodexConfigPaths({ env: deps.env, homeDir: deps.homeDir });
  const sessionsDir = path.join(baseDir, 'sessions');

  const rolloutFiles = collectRolloutFiles(sessionsDir, existsImpl, readdirImpl);
  if (rolloutFiles.length === 0) return null;

  // Filename carries an ISO timestamp, so the lexicographically-last file is
  // the most recent session.
  const latest = rolloutFiles[rolloutFiles.length - 1];

  let lines: string[];
  try {
    lines = await tailLinesImpl(latest, TAIL_LINES);
  } catch {
    return null;
  }

  // Iterate backwards for the most recent non-null rate_limits.
  let rate: CodexRateLimits | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const found = extractRateLimits(lines[i]);
    if (found) {
      rate = found;
      break;
    }
  }
  if (!rate) return null;

  let stale = false;
  try {
    stale = now - statMtimeMsImpl(latest) > STALE_AFTER_MS;
  } catch {
    // Unknown mtime -> treat as fresh; the data itself is still valid.
    stale = false;
  }

  return {
    quotaPercentage: computeQuotaPercentage(rate),
    nextReset: computeNextReset(rate),
    tier: rate.planType,
    stale,
  };
}
