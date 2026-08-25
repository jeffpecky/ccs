import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigError } from '../../errors/error-types';
import { getServerPidPath, isValidLaunchId } from './bar-paths';

export interface BarServerProcessRecord {
  pid: number;
  birthIdentity: string;
  /**
   * Identity of the `ccs bar launch` attempt that owns this server, when one
   * exists. Foreground/direct serve runs have no launcher and omit it. Cleanup
   * that supplies a launchId only removes records stamped with the same id.
   */
  launchId?: string;
}

export type BarServerStopResult =
  | 'stopped'
  | 'stale'
  | 'stale-corrupt'
  | 'legacy-record'
  | 'invalid-record'
  | 'identity-mismatch'
  | 'permission-denied'
  | 'signal-failed'
  | 'timeout';

export interface BarServerStopDeps {
  getProcessBirthIdentity: (pid: number) => string | null;
  killProcess: (pid: number, signal: 'SIGTERM') => void;
  waitForProcessExit: (
    pid: number,
    birthIdentity: string,
    timeoutMs: number
  ) => Promise<'exited' | 'identity-mismatch' | 'timeout'>;
}

export interface ProcessExitWaitDeps {
  getProcessBirthIdentity: (pid: number) => string | null;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export function parseBarServerProcessRecord(raw: string): BarServerProcessRecord | null {
  try {
    const parsed = JSON.parse(raw) as Partial<BarServerProcessRecord>;
    const pid = parsed.pid;
    if (!Number.isSafeInteger(pid) || (pid ?? 0) <= 0) return null;
    if (typeof parsed.birthIdentity !== 'string' || parsed.birthIdentity.trim() === '') return null;
    const record: BarServerProcessRecord = { pid: pid as number, birthIdentity: parsed.birthIdentity };
    if (parsed.launchId !== undefined) {
      if (!isValidLaunchId(parsed.launchId)) return null;
      record.launchId = parsed.launchId;
    }
    return record;
  } catch {
    return null;
  }
}

export function parseLegacyServerPid(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return null;
  const pid = Number(trimmed);
  return Number.isSafeInteger(pid) ? pid : null;
}

export function serializeBarServerProcessRecord(record: BarServerProcessRecord): string {
  return JSON.stringify(record, null, 2);
}

/** Publish a lifecycle file atomically so readers never observe torn content. */
export function writeFileAtomic(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math
    .random()
    .toString(16)
    .slice(2)}`;
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, filePath);
}

export type RawProcessRecordKind = 'modern' | 'legacy' | 'corrupt';

/**
 * Classify raw server.pid content. `corrupt` covers torn writes and other
 * garbage that parses as neither a modern record nor a legacy integer PID.
 */
export function classifyRawProcessRecord(raw: string): RawProcessRecordKind {
  if (parseBarServerProcessRecord(raw) !== null) return 'modern';
  if (parseLegacyServerPid(raw) !== null) return 'legacy';
  return 'corrupt';
}

/**
 * Return the OS process birth marker for PID reuse protection. CCS Bar is a
 * macOS app, where `ps lstart` is stable for a process lifetime. Linux uses the
 * same portable ps surface in development and CI.
 */
export function getProcessBirthIdentity(pid: number): string | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === 'win32') {
      const output = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim();
      return output || null;
    }
    const output = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return output || null;
  } catch {
    return null;
  }
}

export async function waitForProcessExit(
  pid: number,
  birthIdentity: string,
  timeoutMs: number,
  deps: Partial<ProcessExitWaitDeps> = {}
): Promise<'exited' | 'identity-mismatch' | 'timeout'> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const getIdentity =
    deps.getProcessBirthIdentity ??
    (process.platform === 'win32'
      ? (targetPid: number) => {
          try {
            process.kill(targetPid, 0);
            return birthIdentity;
          } catch (err) {
            return (err as NodeJS.ErrnoException).code === 'ESRCH' ? null : birthIdentity;
          }
        }
      : getProcessBirthIdentity);

  const deadline = now() + timeoutMs;
  while (true) {
    const currentIdentity = getIdentity(pid);
    if (currentIdentity === null) return 'exited';
    if (currentIdentity !== birthIdentity) return 'identity-mismatch';
    const remaining = deadline - now();
    if (remaining <= 0) return 'timeout';
    await sleep(Math.min(100, remaining));
  }
}

export async function stopRecordedBarServer(
  rawRecord: string,
  deps: Partial<BarServerStopDeps> = {}
): Promise<{ result: BarServerStopResult; record: BarServerProcessRecord | null; error?: Error }> {
  const record = parseBarServerProcessRecord(rawRecord);
  if (record === null) {
    return {
      result: parseLegacyServerPid(rawRecord) === null ? 'invalid-record' : 'legacy-record',
      record: null,
    };
  }

  const getIdentity = deps.getProcessBirthIdentity ?? getProcessBirthIdentity;
  const killProcess =
    deps.killProcess ??
    (process.platform === 'win32'
      ? (pid: number) => {
          execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
            stdio: ['ignore', 'ignore', 'pipe'],
          });
        }
      : (pid: number, signal: 'SIGTERM') => process.kill(pid, signal));
  const waitForExit = deps.waitForProcessExit ?? waitForProcessExit;

  // Revalidate immediately before SIGTERM. A PID alone is unsafe because the OS
  // can reuse it after the recorded CCS Bar process exits.
  const currentIdentity = getIdentity(record.pid);
  if (currentIdentity === null) return { result: 'stale', record };
  if (currentIdentity !== record.birthIdentity) return { result: 'identity-mismatch', record };

  try {
    killProcess(record.pid, 'SIGTERM');
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return { result: 'stale', record };
    if (code === 'EPERM') return { result: 'permission-denied', record, error };
    return { result: 'signal-failed', record, error };
  }

  const waitResult = await waitForExit(record.pid, record.birthIdentity, 3_000);
  if (waitResult === 'exited') return { result: 'stopped', record };
  if (waitResult === 'identity-mismatch') return { result: 'identity-mismatch', record };
  return { result: 'timeout', record };
}

export interface ClaimedBarServerStopOutcome {
  result: BarServerStopResult | 'no-record';
  record: BarServerProcessRecord | null;
  legacyPid?: number;
  error?: Error;
  recoveryPath?: string;
}

function isErrno(err: unknown, code: string): boolean {
  return (err as NodeJS.ErrnoException).code === code;
}

function unlinkIfPresent(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (!isErrno(err, 'ENOENT')) throw err;
  }
}

function restoreClaimWithoutOverwrite(
  claimPath: string,
  canonicalPath: string
): string | undefined {
  try {
    fs.linkSync(claimPath, canonicalPath);
    unlinkIfPresent(claimPath);
    return undefined;
  } catch (err) {
    if (isErrno(err, 'EEXIST')) return claimPath;
    throw err;
  }
}

/**
 * Atomically claim server.pid before signaling. The serve process therefore
 * sees ENOENT during its signal handler and cannot unlink a new owner's record.
 */
export async function stopBarServerProcessFile(
  pidPath: string,
  deps: Partial<BarServerStopDeps> = {}
): Promise<ClaimedBarServerStopOutcome> {
  const claimPath = `${pidPath}.claim-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    fs.renameSync(pidPath, claimPath);
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return { result: 'no-record', record: null };
    throw err;
  }

  let rawRecord: string;
  try {
    rawRecord = fs.readFileSync(claimPath, 'utf8').trim();
  } catch (err) {
    const recoveryPath = restoreClaimWithoutOverwrite(claimPath, pidPath);
    return {
      result: 'invalid-record',
      record: null,
      error: err instanceof Error ? err : new Error(String(err)),
      recoveryPath,
    };
  }

  // Escape hatch: a torn or unparsable record names no verifiable process, so
  // no live owner can depend on it and our atomic writers never produce this
  // state. Remove it instead of wedging stop behind unrecoverable junk.
  if (classifyRawProcessRecord(rawRecord) === 'corrupt') {
    unlinkIfPresent(claimPath);
    return { result: 'stale-corrupt', record: null };
  }

  const outcome = await stopRecordedBarServer(rawRecord, deps);
  if (outcome.result === 'stopped' || outcome.result === 'stale') {
    unlinkIfPresent(claimPath);
    return outcome;
  }

  const recoveryPath = restoreClaimWithoutOverwrite(claimPath, pidPath);
  return {
    ...outcome,
    legacyPid:
      outcome.result === 'legacy-record'
        ? (parseLegacyServerPid(rawRecord) ?? undefined)
        : undefined,
    recoveryPath,
  };
}

/** Remove server.pid only when it still belongs to this exact serve process and launch. */
export function removeBarServerProcessRecordIfOwned(
  pidPath: string,
  expectedRecord: BarServerProcessRecord
): void {
  const claimPath = `${pidPath}.cleanup-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    fs.renameSync(pidPath, claimPath);
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return;
    throw err;
  }

  let claimedRecord: BarServerProcessRecord | null = null;
  try {
    claimedRecord = parseBarServerProcessRecord(fs.readFileSync(claimPath, 'utf8'));
  } catch {
    // Preserve unreadable state below.
  }

  const identityMatches =
    claimedRecord?.pid === expectedRecord.pid &&
    claimedRecord.birthIdentity === expectedRecord.birthIdentity;
  const launchMatches =
    expectedRecord.launchId === undefined || claimedRecord?.launchId === expectedRecord.launchId;
  if (identityMatches && launchMatches) {
    unlinkIfPresent(claimPath);
    return;
  }
  restoreClaimWithoutOverwrite(claimPath, pidPath);
}

export type StaleProcessClaimResult = 'absent' | 'claimed-stale' | 'preserved';

/**
 * Claim server.pid when it verifiably names a dead process (or is torn/unparsable
 * junk that cannot describe a live owner), so a fresh serve can publish its own
 * record without silently discarding live recovery state.
 *
 * The unlink itself follows the sibling rename-verify-restore pattern: the file
 * is renamed to a private claim path, the claimed bytes are re-read and must
 * still match what was judged stale (and liveness is re-verified), and anything
 * else is restored without overwriting a concurrent publisher's record. Legacy
 * integer records stay preserved for manual verification.
 */
export function claimStaleBarServerProcessRecord(
  pidPath: string,
  deps: Partial<Pick<BarServerStopDeps, 'getProcessBirthIdentity'>> = {}
): StaleProcessClaimResult {
  const getIdentity = deps.getProcessBirthIdentity ?? getProcessBirthIdentity;

  let raw: string;
  try {
    raw = fs.readFileSync(pidPath, 'utf8');
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return 'absent';
    throw err;
  }

  const kind = classifyRawProcessRecord(raw);
  if (kind === 'legacy') return 'preserved';
  const record = kind === 'modern' ? parseBarServerProcessRecord(raw) : null;
  if (record !== null && getIdentity(record.pid) !== null) return 'preserved';

  const claimPath = `${pidPath}.claim-${process.pid}-${Date.now()}-${Math
    .random()
    .toString(16)
    .slice(2)}`;
  try {
    fs.renameSync(pidPath, claimPath);
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return 'absent';
    throw err;
  }

  let claimedRaw: string | null = null;
  try {
    claimedRaw = fs.readFileSync(claimPath, 'utf8');
  } catch {
    claimedRaw = null;
  }
  const claimedUnchanged =
    claimedRaw !== null &&
    claimedRaw === raw &&
    (record === null || getIdentity(record.pid) === null);
  if (!claimedUnchanged) {
    // Someone else moved or replaced the record between our judgement and the
    // claim; never destroy state we did not verify.
    if (claimedRaw === null && !fs.existsSync(claimPath)) return 'absent';
    restoreClaimWithoutOverwrite(claimPath, pidPath);
    return 'preserved';
  }

  unlinkIfPresent(claimPath);
  return 'claimed-stale';
}

/** Claim stale discovery state so a replacement write can never be unlinked. */
export function removeBarDiscoveryIfNoProcess(barJsonPath: string, pidPath: string): boolean {
  const claimPath = `${barJsonPath}.cleanup-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    fs.renameSync(barJsonPath, claimPath);
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return true;
    throw err;
  }
  if (fs.existsSync(pidPath)) {
    restoreClaimWithoutOverwrite(claimPath, barJsonPath);
    return false;
  }
  unlinkIfPresent(claimPath);
  return true;
}

export async function stopDetachedBarServer(ccsDir: string): Promise<void> {
  const pidPath = getServerPidPath(ccsDir);
  try {
    const outcome = await stopBarServerProcessFile(pidPath);
    if (
      outcome.result !== 'stopped' &&
      outcome.result !== 'stale' &&
      outcome.result !== 'stale-corrupt'
    ) {
      throw new ConfigError(
        `Safe CCS Bar stop aborted (${outcome.result}); recovery state was preserved`,
        outcome.recoveryPath ?? pidPath
      );
    }
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(
      `Cannot safely stop CCS Bar process: ${err instanceof Error ? err.message : String(err)}`,
      pidPath
    );
  }
}
