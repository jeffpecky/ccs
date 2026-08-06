import { spawn } from 'child_process';

import type { CursorConfig } from '../config/unified-config-types';

import { fail, info, ok } from '../utils/ui';
import { stripClaudeCodeEnv } from '../utils/shell-executor';
import { checkAuthStatus } from './cursor-auth';
import { isDaemonRunning, startDaemon } from './cursor-daemon';
import { getCursorDaemonToken } from './cursor-daemon-auth';
import { getGlobalEnvConfig } from '../config/config-loader-facade';

export function generateCursorEnv(
  config: CursorConfig,
  daemonToken: string,
  claudeConfigDir?: string
): Record<string, string> {
  const opusModel = config.opus_model || config.model;
  const sonnetModel = config.sonnet_model || config.model;
  const haikuModel = config.haiku_model || config.model;

  return {
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${config.port}`,
    ANTHROPIC_AUTH_TOKEN: daemonToken,
    ANTHROPIC_MODEL: config.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: opusModel,
    ANTHROPIC_DEFAULT_SONNET_MODEL: sonnetModel,
    ANTHROPIC_SMALL_FAST_MODEL: haikuModel,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: haikuModel,
    DISABLE_NON_ESSENTIAL_MODEL_CALLS: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    ...(claudeConfigDir ? { CLAUDE_CONFIG_DIR: claudeConfigDir } : {}),
  };
}

export async function executeCursorProfile(
  config: CursorConfig,
  claudeArgs: string[],
  claudeConfigDir?: string,
  claudeCliPath = 'claude'
): Promise<number> {
  if (!config.enabled) {
    console.error(fail('Cursor integration is not enabled.'));
    console.error('');
    console.error('Enable it first: ccs legacy cursor enable');
    return 1;
  }

  const authStatus = checkAuthStatus();
  if (!authStatus.authenticated) {
    console.error(fail('Cursor credentials not found.'));
    console.error('');
    console.error('Authenticate first: ccs legacy cursor auth');
    return 1;
  }
  if (authStatus.expired) {
    console.error(fail('Cursor credentials have expired.'));
    console.error('');
    console.error('Refresh them with: ccs legacy cursor auth');
    return 1;
  }

  const daemonToken = getCursorDaemonToken();

  let daemonRunning = await isDaemonRunning(config.port, daemonToken);
  if (!daemonRunning) {
    if (config.auto_start) {
      console.log(info('Starting cursor daemon...'));
      const result = await startDaemon({
        port: config.port,
        ghost_mode: config.ghost_mode,
        daemon_token: daemonToken,
      });
      if (!result.success) {
        console.error(fail(`Failed to start cursor daemon: ${result.error}`));
        return 1;
      }
      console.log(ok(`Daemon started on port ${config.port}`));
      daemonRunning = true;
    } else {
      console.error(fail('Cursor daemon is not running.'));
      console.error('');
      console.error('Start the daemon:');
      console.error('  ccs legacy cursor start');
      console.error('Or enable auto_start in the Cursor config section.');
      return 1;
    }
  }

  const cursorEnv = generateCursorEnv(config, daemonToken, claudeConfigDir);
  const globalEnvConfig = getGlobalEnvConfig();
  const globalEnv = globalEnvConfig.enabled ? globalEnvConfig.env : {};
  const env = stripClaudeCodeEnv({
    ...process.env,
    ...globalEnv,
    ...cursorEnv,
    CCS_PROFILE_TYPE: 'cursor',
  });

  console.log(info(`Using Cursor proxy (model: ${config.model})`));
  console.log('');

  return new Promise((resolve) => {
    const proc = spawn(claudeCliPath, claudeArgs, {
      stdio: 'inherit',
      env,
      shell: process.platform === 'win32',
    });

    proc.on('close', (code) => {
      resolve(code ?? 0);
    });

    proc.on('error', (err) => {
      console.error(fail(`Failed to start Claude: ${err.message}`));
      resolve(1);
    });
  });
}
