/**
 * Claude Launcher — Concern H
 *
 * Handles final argument assembly, trace context injection, Windows shell
 * escaping, spawning the Claude CLI process, starting the runtime quota
 * monitor, and wiring up cleanup handlers.
 */

import { spawn, ChildProcess } from 'child_process';
import * as os from 'os';
import { escapeShellArg, getWindowsEscapedCommandShell } from '../../utils/shell-executor';
import { getProviderSettingsPath } from '../config/config-generator';

import { appendBrowserToolArgs } from '../../utils/browser';
import { getDefaultAccount } from '../accounts/account-manager';
import { CLIProxyProvider, ExecutorConfig } from '../types';
import { CodexReasoningProxy } from '../ai-providers/codex-reasoning-proxy';
import { ToolSanitizationProxy } from '../proxy/tool-sanitization-proxy';
import { HttpsTunnelProxy } from '../proxy/https-tunnel-proxy';
import { setupCleanupHandlers } from './session-bridge';
import { resolveRuntimeQuotaMonitorProviders } from './account-resolution';
import {
  isClaudeSubcommandInvocation,
  stripClaudeCodeFeatureBlockingEnv,
  stripClaudeSubcommandSessionArgs,
  stripSubcommandBlockingEnv,
} from '../../utils/claude-subcommand-detector';

export interface ClaudeLaunchContext {
  /** Path to the Claude CLI executable */
  claudeCli: string;
  /** Pre-filtered Claude args (CCS flags already stripped) */
  claudeArgs: string[];
  /** Fully assembled environment variables (without trace additions) */
  env: NodeJS.ProcessEnv;
  /** Resolved executor config */
  cfg: ExecutorConfig;
  /** Active CLIProxy provider */
  provider: CLIProxyProvider;
  /** Providers derived from composite tiers (empty for simple providers) */
  compositeProviders: CLIProxyProvider[];
  /** Whether local OAuth was skipped (remote proxy auth in use) */
  skipLocalAuth: boolean;
  /** Session ID for cleanup tracking */
  sessionId: string | undefined;

  /** Browser runtime environment variables (undefined if browser not active) */
  browserRuntimeEnv: NodeJS.ProcessEnv | undefined;
  /** Inherited Claude config dir for continuity */
  inheritedClaudeConfigDir: string | undefined;
  /** Active Codex reasoning proxy (if any) */
  codexReasoningProxy: CodexReasoningProxy | null;
  /** Active tool sanitization proxy (if any) */
  toolSanitizationProxy: ToolSanitizationProxy | null;
  /** Active HTTPS tunnel proxy (if any) */
  httpsTunnel: HttpsTunnelProxy | null;
  /** Whether verbose logging is enabled */
  verbose: boolean;
}

/**
 * Assemble final Claude CLI arguments, inject trace context, spawn the process,
 * start the runtime quota monitor, and wire cleanup handlers.
 *
 * @returns The spawned ChildProcess for the Claude CLI.
 */
export async function launchClaude(context: ClaudeLaunchContext): Promise<ChildProcess> {
  const {
    claudeCli,
    claudeArgs,
    env,
    cfg,
    provider,
    compositeProviders,
    skipLocalAuth,
    sessionId,
    browserRuntimeEnv,
    codexReasoningProxy,
    toolSanitizationProxy,
    httpsTunnel,
    verbose,
  } = context;

  const isWindows = process.platform === 'win32';
  const needsShell = isWindows && /\.(cmd|bat|ps1)$/i.test(claudeCli);

  const settingsPath = cfg.customSettingsPath
    ? cfg.customSettingsPath.replace(/^~/, os.homedir())
    : getProviderSettingsPath(provider);

  // Claude subcommands (agents, doctor, mcp, ...) don't accept `--settings` —
  // its presence flips `agents` into list mode instead of opening the
  // interactive agent view. Provider routing still flows via env vars.
  // Issue #1218.
  const isSubcommand = isClaudeSubcommandInvocation(claudeArgs);
  const claudeSessionArgs = isSubcommand
    ? stripClaudeSubcommandSessionArgs(claudeArgs)
    : claudeArgs;

  // Assemble final args: browser tools → settings
  const browserArgs = browserRuntimeEnv
    ? appendBrowserToolArgs(claudeSessionArgs)
    : claudeSessionArgs;
  const launchArgs = isSubcommand
    ? browserArgs
    : ['--settings', settingsPath, ...browserArgs];

  let tracedEnv = stripClaudeCodeFeatureBlockingEnv({ ...env });
  // Strip telemetry-disable env vars for subcommands; otherwise Claude's
  // `agents`/`mcp`/... TUIs silently fall back to non-interactive list mode.
  // Issue #1218.
  if (isSubcommand) tracedEnv = stripSubcommandBlockingEnv(tracedEnv);

  // Spawn: Windows .cmd/.bat/.ps1 need shell escaping; all others spawn directly
  let claude: ChildProcess;
  if (needsShell) {
    const cmdString = [claudeCli, ...launchArgs].map(escapeShellArg).join(' ');
    claude = spawn(cmdString, {
      stdio: 'inherit',
      windowsHide: true,
      shell: getWindowsEscapedCommandShell(),
      env: tracedEnv,
    });
  } else {
    claude = spawn(claudeCli, launchArgs, {
      stdio: 'inherit',
      windowsHide: true,
      env: tracedEnv,
    });
  }

  // Start runtime quota monitor (adaptive polling during session)
  if (!skipLocalAuth) {
    const { startQuotaMonitor } = await import('../quota/quota-manager');
    for (const monitorProvider of resolveRuntimeQuotaMonitorProviders(
      provider,
      compositeProviders
    )) {
      const monitorAccount = getDefaultAccount(monitorProvider);
      if (monitorAccount) {
        startQuotaMonitor(monitorProvider, monitorAccount.id);
      }
    }
  }

  // Wire cleanup handlers (process exit, SIGINT, SIGTERM, proxy teardown)
  setupCleanupHandlers(
    claude,
    sessionId,
    cfg.port,
    codexReasoningProxy,
    toolSanitizationProxy,
    httpsTunnel,
    verbose
  );

  return claude;
}
