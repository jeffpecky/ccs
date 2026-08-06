/**
 * Copilot Executor
 *
 * Main execution flow for running Claude Code with copilot-api proxy.
 * Uses local installation from ~/.ccs/copilot/ (managed by copilot-package-manager).
 */

import { spawn } from 'child_process';
import { CopilotConfig } from '../config/unified-config-types';

import { checkAuthStatus, isCopilotApiInstalled } from './copilot-auth';
import { isDaemonRunning, startDaemon } from './copilot-daemon';
import { ensureCopilotApi } from './copilot-package-manager';
import { normalizeCopilotConfigWithWarnings } from './copilot-model-normalizer';
import { CopilotStatus } from './types';
import { fail, info, ok, warn } from '../utils/ui';
import { stripClaudeCodeEnv } from '../utils/shell-executor';
import { createLogger } from '../services/logging';
import { getGlobalEnvConfig } from '../config/config-loader-facade';

const logger = createLogger('copilot:executor');

/**
 * Get full copilot status (auth + daemon).
 */
export async function getCopilotStatus(config: CopilotConfig): Promise<CopilotStatus> {
  const normalizedConfig = normalizeCopilotConfigWithWarnings(config).config;
  const [auth, daemonRunning] = await Promise.all([
    checkAuthStatus(),
    isDaemonRunning(normalizedConfig.port),
  ]);

  return {
    auth,
    daemon: {
      running: daemonRunning,
      port: normalizedConfig.port,
    },
  };
}

/**
 * Generate environment variables for Claude Code to use copilot-api.
 * Uses model mapping for opus/sonnet/haiku tiers if configured.
 */
export function generateCopilotEnv(
  config: CopilotConfig,
  claudeConfigDir?: string
): Record<string, string> {
  const normalizedConfig = normalizeCopilotConfigWithWarnings(config).config;

  const opusModel = normalizedConfig.opus_model || normalizedConfig.model;
  const sonnetModel = normalizedConfig.sonnet_model || normalizedConfig.model;
  const haikuModel = normalizedConfig.haiku_model || normalizedConfig.model;

  return {
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${normalizedConfig.port}`,
    ANTHROPIC_AUTH_TOKEN: 'dummy',
    ANTHROPIC_MODEL: normalizedConfig.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: opusModel,
    ANTHROPIC_DEFAULT_SONNET_MODEL: sonnetModel,
    ANTHROPIC_SMALL_FAST_MODEL: haikuModel,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: haikuModel,
    DISABLE_NON_ESSENTIAL_MODEL_CALLS: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    ...(claudeConfigDir ? { CLAUDE_CONFIG_DIR: claudeConfigDir } : {}),
  };
}

/**
 * Execute Claude Code with copilot-api proxy.
 *
 * @param config Copilot configuration
 * @param claudeArgs Arguments to pass to Claude CLI
 * @returns Exit code
 */
export async function executeCopilotProfile(
  config: CopilotConfig,
  claudeArgs: string[],
  claudeConfigDir?: string,
  claudeCliPath: string = 'claude'
): Promise<number> {
  const { config: normalizedConfig, warnings } = normalizeCopilotConfigWithWarnings(config);

  logger.stage('intake', 'copilot.execute.start', 'Starting Copilot profile execution', {
    provider: 'copilot',
    model: normalizedConfig.model,
    port: normalizedConfig.port,
  });

  if (warnings.length > 0) {
    warnings.forEach(({ message }) => console.log(warn(message)));
    console.log(
      warn('Configure from the dashboard settings and save the Copilot section to persist these replacements.')
    );
    console.log('');
  }

  // Ensure copilot-api is installed (auto-install if missing, auto-update if outdated)
  try {
    await ensureCopilotApi();
  } catch (error) {
    console.error(fail('Failed to install copilot-api.'));
    console.error('');
    console.error(`Error: ${(error as Error).message}`);
    console.error('');
    console.error('Try installing manually:');
    console.error('  npm install -g copilot-api');
    return 1;
  }

  // Check if copilot-api is installed (should be after ensureCopilotApi)
  if (!isCopilotApiInstalled()) {
    console.error(fail('copilot-api is not installed.'));
    console.error('');
    console.error('Install/repair by running: Start Copilot from the dashboard');
    return 1;
  }

  // Check authentication
  const authStatus = await checkAuthStatus();
  logger.stage('auth', 'copilot.execute.auth_check', 'Checked Copilot auth status', {
    provider: 'copilot',
    authenticated: authStatus.authenticated,
  });
  if (!authStatus.authenticated) {
    console.error(fail('Not authenticated with GitHub.'));
    console.error('');
    console.error('Run: npx copilot-api auth');
    console.error('Or:  Authenticate Copilot from the dashboard');
    return 1;
  }

  // Check if daemon is running or needs to be started
  let daemonRunning = await isDaemonRunning(normalizedConfig.port);

  if (!daemonRunning) {
    if (normalizedConfig.auto_start) {
      console.log(info('Starting copilot-api daemon...'));
      const result = await startDaemon(normalizedConfig);
      if (!result.success) {
        console.error(fail(`Failed to start daemon: ${result.error}`));
        return 1;
      }
      console.log(ok(`Daemon started on port ${normalizedConfig.port}`));
      daemonRunning = true;
    } else {
      console.error(fail('copilot-api daemon is not running.'));
      console.error('');
      console.error('Start the daemon:');
      console.error('  Start Copilot from the dashboard');
      console.error('Fallback manual command:');
      console.error(`  npx copilot-api start --port ${normalizedConfig.port}`);
      console.error('');
      console.error('Or enable auto_start in config:');
      console.error('  Configure from the dashboard settings (then enable auto_start in Copilot section)');
      return 1;
    }
  }

  // Generate environment for Claude
  const copilotEnv = generateCopilotEnv(normalizedConfig, claudeConfigDir);

  // Get global env vars (DISABLE_TELEMETRY, etc.) for third-party profiles
  const globalEnvConfig = getGlobalEnvConfig();
  const globalEnv = globalEnvConfig.enabled ? globalEnvConfig.env : {};

  const env = stripClaudeCodeEnv({
    ...process.env,
    ...globalEnv,
    ...copilotEnv,
    CCS_PROFILE_TYPE: 'copilot',
  });

  console.log(info(`Using GitHub Copilot proxy (model: ${normalizedConfig.model})`));
  console.log('');

  // Spawn Claude CLI
  const spawnStartedAt = Date.now();
  return new Promise((resolve) => {
    logger.stage('dispatch', 'copilot.execute.spawn', 'Spawning Claude via Copilot proxy', {
      provider: 'copilot',
      argCount: claudeArgs.length,
    });

    const proc = spawn(claudeCliPath, claudeArgs, {
      stdio: 'inherit',
      env,
      shell: process.platform === 'win32',
    });

    proc.on('close', (code) => {
      logger.stage(
        'respond',
        'copilot.execute.exit',
        'Claude process exited (Copilot)',
        { provider: 'copilot', exitCode: code },
        { latencyMs: Date.now() - spawnStartedAt }
      );
      resolve(code ?? 0);
    });

    proc.on('error', (err) => {
      logger.stage(
        'cleanup',
        'copilot.execute.error',
        'Failed to spawn Claude (Copilot)',
        { provider: 'copilot' },
        {
          level: 'error',
          latencyMs: Date.now() - spawnStartedAt,
          error: { name: err.name, message: err.message },
        }
      );
      console.error(fail(`Failed to start Claude: ${err.message}`));
      resolve(1);
    });
  });
}
