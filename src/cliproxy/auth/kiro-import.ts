/**
 * Kiro Import Helper
 *
 * Imports Kiro token from Kiro IDE when OAuth callback redirects to IDE instead of CLI.
 * Spawns cli-proxy-api-plus --kiro-import to import token from Kiro IDE's storage.
 */

import { spawn } from 'child_process';
import { info, ok, fail } from '../../utils/ui';
import { ensureCLIProxyBinary } from '../binary-manager';
import { generateConfig } from '../config/config-generator';
import { getProviderTokenDir } from './token-manager';

export interface KiroImportResult {
  success: boolean;
  provider?: string;
  email?: string;
  error?: string;
}

/**
 * Try to import Kiro token from Kiro IDE
 * Uses cli-proxy-api-plus --kiro-import flag
 */
export async function tryKiroImport(tokenDir: string, verbose = false): Promise<KiroImportResult> {
  const log = (msg: string) => {
    if (verbose) console.error(`[kiro-import] ${msg}`);
  };

  try {
    log('Ensuring CLIProxy binary is available...');
    const binaryPath = await ensureCLIProxyBinary(verbose, { skipAutoUpdate: true });
    const configPath = generateConfig('kiro');

    log(`Binary: ${binaryPath}`);
    log(`Config: ${configPath}`);
    log(`Token dir: ${tokenDir}`);

    return new Promise<KiroImportResult>((resolve) => {
      const args = ['--config', configPath, '--kiro-import'];

      log(`Running: ${binaryPath} ${args.join(' ')}`);

      const proc = spawn(binaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CLI_PROXY_AUTH_DIR: tokenDir },
      });

      let stdout = '';
      let stderr = '';
      let resolved = false;

      const safeResolve = (result: KiroImportResult) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutId);
        resolve(result);
      };

      proc.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        stdout += output;
        log(`stdout: ${output.trim()}`);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        stderr += output;
        log(`stderr: ${output.trim()}`);
      });

      proc.on('exit', (code) => {
        log(`Exit code: ${code}`);

        if (code === 0) {
          // Parse output for provider info
          const providerMatch = stdout.match(/Provider:\s*(\w+)/i);
          const emailMatch = stdout.match(/email[:\s]+([^\s,)]+)/i);
          const successMatch =
            stdout.includes('Kiro token import successful') ||
            stdout.includes('Imported Kiro token') ||
            stdout.includes('Authentication saved');

          if (successMatch) {
            safeResolve({
              success: true,
              provider: providerMatch?.[1],
              email: emailMatch?.[1],
            });
          } else {
            safeResolve({
              success: false,
              error: 'Import completed but token not confirmed',
            });
          }
        } else {
          const errorLine = stderr.trim().split('\n')[0] || stdout.trim().split('\n')[0];
          safeResolve({
            success: false,
            error: errorLine || `Exit code ${code}`,
          });
        }
      });

      proc.on('error', (error) => {
        log(`Process error: ${error.message}`);
        safeResolve({
          success: false,
          error: error.message,
        });
      });

      // Timeout after 30 seconds
      const timeoutId = setTimeout(() => {
        if (!resolved && !proc.killed) {
          proc.kill();
          safeResolve({
            success: false,
            error: 'Import timed out after 30 seconds',
          });
        }
      }, 30000);
    });
  } catch (error) {
    log(`Error: ${(error as Error).message}`);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Import Kiro token with user-facing output
 * Shows progress and result to user
 */
export async function importKiroToken(verbose = false): Promise<boolean> {
  const tokenDir = getProviderTokenDir('kiro');

  console.log('');
  console.log(info('Importing token from Kiro IDE...'));

  const result = await tryKiroImport(tokenDir, verbose);

  if (result.success) {
    const providerInfo = result.provider ? ` (Provider: ${result.provider})` : '';
    console.log(ok(`Imported Kiro token from IDE${providerInfo}`));
    return true;
  }

  console.log(fail(`Import failed: ${result.error}`));
  console.log('');
  console.log('Make sure you are logged into Kiro IDE first:');
  console.log('  1. Open Kiro IDE');
  console.log('  2. Sign in with your AWS/Google account');
  console.log('  3. Run: Import Kiro token from the dashboard');

  return false;
}
