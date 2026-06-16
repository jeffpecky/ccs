import { OAuthTraceEvent, OAuthTracePhase } from './trace-events';

export type FailureBranchId =
  | 'URL_NOT_DISPLAYED'
  | 'BROWSER_NOT_OPENED'
  | 'CALLBACK_NEVER_OBSERVED'
  | 'BINARY_ERROR_EXIT'
  | 'TOKEN_FILE_MISSING_POST_EXIT'
  | 'TIMEOUT'
  | 'SESSION_CANCELLED'
  | 'TOKEN_EXCHANGE_REJECTED'
  | 'PASTE_INVALID'
  | 'GEMINI_PLUS_MISSING_CRED'
  | 'AGY_RESPONSIBILITY_DECLINED'
  | 'UNKNOWN';

export interface DiagnosisResult {
  branchId: FailureBranchId;
  data: Record<string, unknown>;
}

const BROWSER_OPEN_HEURISTIC_MS = 5000;

/**
 * Pure function: read a recorder snapshot and decide which failure branch fits best.
 * No side effects, no console writes.
 */
export function diagnoseFailure(snapshot: OAuthTraceEvent[]): DiagnosisResult {
  if (snapshot.length === 0) {
    return { branchId: 'UNKNOWN', data: {} };
  }

  const has = (phase: OAuthTracePhase) => snapshot.some((e) => e.phase === phase);
  const last = (phase: OAuthTracePhase) => [...snapshot].reverse().find((e) => e.phase === phase);
  const lastError = [...snapshot].reverse().find((e) => e.phase === OAuthTracePhase.Error);

  // Provider gate aborts (highest priority — explicit error code)
  if (lastError?.error?.code === 'GEMINI_PLUS_MISSING_CRED') {
    return { branchId: 'GEMINI_PLUS_MISSING_CRED', data: lastError.data ?? {} };
  }
  if (lastError?.error?.code === 'AGY_RESPONSIBILITY_DECLINED') {
    return { branchId: 'AGY_RESPONSIBILITY_DECLINED', data: lastError.data ?? {} };
  }
  if (lastError?.error?.code === 'CALLBACK_REJECTED') {
    return {
      branchId: 'TOKEN_EXCHANGE_REJECTED',
      data: { upstreamError: lastError.error.message, ...(lastError.data ?? {}) },
    };
  }

  if (has(OAuthTracePhase.PasteCallbackInvalid)) {
    const ev = last(OAuthTracePhase.PasteCallbackInvalid);
    return { branchId: 'PASTE_INVALID', data: ev?.data ?? {} };
  }

  if (has(OAuthTracePhase.Cancelled)) {
    return { branchId: 'SESSION_CANCELLED', data: {} };
  }

  if (has(OAuthTracePhase.Timeout)) {
    const ev = last(OAuthTracePhase.Timeout);
    return { branchId: 'TIMEOUT', data: ev?.data ?? {} };
  }

  const exitEv = last(OAuthTracePhase.BinaryExit);
  if (exitEv) {
    const code = (exitEv.data?.code as number | undefined) ?? null;
    if (code !== null && code !== 0) {
      return {
        branchId: 'BINARY_ERROR_EXIT',
        data: {
          code,
          stderrTail: exitEv.data?.stderrTail ?? '',
        },
      };
    }
  }

  // exit=0 (or no exit) plus token-file states
  if (has(OAuthTracePhase.TokenFileMissing)) {
    return { branchId: 'TOKEN_FILE_MISSING_POST_EXIT', data: {} };
  }

  if (!has(OAuthTracePhase.AuthUrlDisplayed)) {
    return { branchId: 'URL_NOT_DISPLAYED', data: {} };
  }

  // URL was displayed: did browser open within heuristic window?
  if (!has(OAuthTracePhase.BrowserOpened)) {
    const urlEv = last(OAuthTracePhase.AuthUrlDisplayed);
    const lastTs = snapshot[snapshot.length - 1].ts;
    if (urlEv && lastTs - urlEv.ts >= BROWSER_OPEN_HEURISTIC_MS) {
      return { branchId: 'BROWSER_NOT_OPENED', data: {} };
    }
  }

  if (
    has(OAuthTracePhase.BrowserOpened) &&
    !has(OAuthTracePhase.CallbackObservedHeuristic) &&
    has(OAuthTracePhase.BinaryExit)
  ) {
    return { branchId: 'CALLBACK_NEVER_OBSERVED', data: {} };
  }

  return { branchId: 'UNKNOWN', data: {} };
}

export interface FormatErrorOptions {
  verbose: boolean;
  platform: NodeJS.Platform;
  callbackPort: number | null;
  provider: string;
}

/**
 * Map a diagnosed branch to user-facing message lines (ASCII only, no emojis).
 * Always ends with a concrete next-step command.
 */
export function formatErrorMessage(result: DiagnosisResult, opts: FormatErrorOptions): string[] {
  const { branchId, data } = result;
  const { provider, callbackPort, platform, verbose } = opts;
  const lines: string[] = [];

  switch (branchId) {
    case 'URL_NOT_DISPLAYED':
      lines.push('OAuth URL was never produced.');
      lines.push('The CLIProxy binary may have failed to start or exited too early.');
      lines.push(`Try: Authenticate ${provider} from the dashboard with verbose logging`);
      break;

    case 'BROWSER_NOT_OPENED':
      lines.push('OAuth URL was displayed but the browser did not open.');
      lines.push('Copy the URL above and open it manually in any browser.');
      break;

    case 'CALLBACK_NEVER_OBSERVED':
      lines.push(
        `Browser completed login but no callback reached localhost:${callbackPort ?? '?'}.`
      );
      lines.push('Common cause: firewall, antivirus, or browser on a different machine.');
      lines.push(`Try paste-callback mode: ccs ${provider} --auth --no-browser`);
      if (platform === 'win32' && callbackPort) {
        lines.push('On Windows, try as Administrator:');
        lines.push(
          `  netsh advfirewall firewall add rule name="CCS OAuth" dir=in action=allow protocol=TCP localport=${callbackPort}`
        );
      }
      break;

    case 'BINARY_ERROR_EXIT': {
      const code = (data['code'] as number | undefined) ?? '?';
      lines.push(`CLIProxy binary exited with code ${code}.`);
      const tail = String(data['stderrTail'] ?? '').trim();
      if (tail) lines.push(`  ${tail}`);
      lines.push(`Try: Authenticate ${provider} from the dashboard`);
      break;
    }

    case 'TOKEN_FILE_MISSING_POST_EXIT':
      lines.push('Authentication appeared to succeed but no token file was created.');
      lines.push('Update CLIProxy and retry: Update from the dashboard settings');
      break;

    case 'TIMEOUT': {
      const min = data['timeoutMs'] ? Math.round((data['timeoutMs'] as number) / 60000) : '?';
      lines.push(`OAuth flow timed out after ${min} minutes.`);
      lines.push(`Re-run and complete login faster: Authenticate ${provider} from the dashboard`);
      break;
    }

    case 'SESSION_CANCELLED':
      lines.push('OAuth flow was cancelled.');
      break;

    case 'TOKEN_EXCHANGE_REJECTED':
      lines.push(
        `Token exchange rejected by provider: ${String(data['upstreamError'] ?? 'unknown')}.`
      );
      lines.push(`Try: Authenticate ${provider} from the dashboard with verbose logging`);
      break;

    case 'PASTE_INVALID':
      lines.push(`Pasted callback URL invalid: ${String(data['reason'] ?? 'unknown')}.`);
      lines.push('Re-run and paste the full URL after browser login.');
      break;

    case 'GEMINI_PLUS_MISSING_CRED':
      lines.push('Gemini-plus OAuth credentials missing.');
      lines.push('See: docs/providers/gemini.md');
      break;

    case 'AGY_RESPONSIBILITY_DECLINED':
      lines.push('Antigravity responsibility prompt was declined.');
      lines.push(`Re-run and accept to proceed: ccs ${provider} --auth`);
      break;

    case 'UNKNOWN':
    default:
      lines.push('Token not found after authentication');
      lines.push('Common causes:');
      lines.push('  1. OAuth session timed out');
      lines.push('  2. Callback server could not receive the redirect');
      lines.push('  3. Browser did not redirect to localhost properly');
      lines.push(`Try: Authenticate ${provider} from the dashboard with verbose logging`);
      break;
  }

  if (verbose) {
    lines.push('');
    lines.push('Run with --verbose for the trace summary.');
  }

  return lines;
}
