import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const STEERING_PROMPT_SNIPPET = 'prefer the CCS MCP tool ImageAnalysis instead of Read';
setDefaultTimeout(30000);

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCcs(args: string[], env: NodeJS.ProcessEnv): RunResult {
  const ccsEntry = path.join(process.cwd(), 'src', 'ccs.ts');
  const result = spawnSync(process.execPath, [ccsEntry, ...args], {
    encoding: 'utf8',
    env,
    timeout: 20000,
  });

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

describe('settings profile ImageAnalysis launch', () => {
  let tmpHome = '';
  let ccsDir = '';
  let settingsPath = '';
  let fakeClaudePath = '';
  let claudeArgsLogPath = '';
  let claudeEnvLogPath = '';
  let baseEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    if (process.platform === 'win32') {
      return;
    }

    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-image-analysis-launch-'));
    ccsDir = path.join(tmpHome, '.ccs');
    settingsPath = path.join(ccsDir, 'glm.settings.json');
    fakeClaudePath = path.join(tmpHome, 'fake-claude.sh');
    claudeArgsLogPath = path.join(tmpHome, 'claude-args.txt');
    claudeEnvLogPath = path.join(tmpHome, 'claude-env.txt');

    fs.mkdirSync(ccsDir, { recursive: true });
    fs.writeFileSync(
      path.join(ccsDir, 'config.json'),
      JSON.stringify({ profiles: { glm: settingsPath } }, null, 2) + '\n'
    );
    fs.writeFileSync(
      path.join(ccsDir, 'config.yaml'),
      [
        'version: 12',
        'websearch:',
        '  enabled: false',
        'image_analysis:',
        '  enabled: true',
        '  timeout: 60',
        '  fallback_backend: agy',
        '  provider_models:',
        '    agy: gemini-3-1-flash-preview',
        'cliproxy:',
        '  auth:',
        '    api_key: current-token',
        '',
      ].join('\n'),
      'utf8'
    );
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          env: {
            ANTHROPIC_BASE_URL: 'https://api.z.ai/api/provider/agy',
            ANTHROPIC_AUTH_TOKEN: 'stale-token',
            ANTHROPIC_MODEL: 'glm-5',
          },
        },
        null,
        2
      ) + '\n'
    );

    fs.writeFileSync(
      fakeClaudePath,
      `#!/bin/sh
printf "%s\n" "$@" > "${claudeArgsLogPath}"
{
  printf "currentProvider=%s\n" "$CCS_CURRENT_PROVIDER"
  printf "skip=%s\n" "$CCS_IMAGE_ANALYSIS_SKIP"
  printf "skipHook=%s\n" "$CCS_IMAGE_ANALYSIS_SKIP_HOOK"
  printf "runtimeApiKey=%s\n" "$CCS_IMAGE_ANALYSIS_RUNTIME_API_KEY"
  printf "runtimeBaseUrl=%s\n" "$CCS_IMAGE_ANALYSIS_RUNTIME_BASE_URL"
  printf "runtimePath=%s\n" "$CCS_IMAGE_ANALYSIS_RUNTIME_PATH"
} > "${claudeEnvLogPath}"
exit 0
`,
      { encoding: 'utf8', mode: 0o755 }
    );
    fs.chmodSync(fakeClaudePath, 0o755);

    baseEnv = {
      ...process.env,
      CI: '1',
      NO_COLOR: '1',
      CCS_HOME: tmpHome,
      CCS_CLAUDE_PATH: fakeClaudePath,
      CCS_DEBUG: '1',
    };
  });

  afterEach(() => {
    if (process.platform === 'win32') {
      return;
    }

    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('keeps launch non-fatal when the shared Read-hook fallback cannot be prepared', () => {
    if (process.platform === 'win32') return;

    fs.writeFileSync(path.join(ccsDir, 'hooks'), 'not-a-directory', 'utf8');

    const result = runCcs(['glm', 'smoke'], baseEnv);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('could not prepare the local ImageAnalysis tool');
    expect(fs.existsSync(claudeArgsLogPath)).toBe(true);
    const launchedArgs = fs.readFileSync(claudeArgsLogPath, 'utf8');
    expect(launchedArgs).toContain('--append-system-prompt');
    expect(launchedArgs).toContain(STEERING_PROMPT_SNIPPET);
  });

  it('keeps launch non-fatal when Image Analysis is disabled', () => {
    if (process.platform === 'win32') return;

    fs.writeFileSync(
      path.join(ccsDir, 'config.yaml'),
      'version: 12\nwebsearch:\n  enabled: false\nimage_analysis:\n  enabled: false\n',
      'utf8'
    );
    fs.writeFileSync(path.join(ccsDir, 'hooks'), 'not-a-directory', 'utf8');

    const result = runCcs(['glm', 'smoke'], baseEnv);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('could not prepare the local ImageAnalysis tool');
    expect(fs.existsSync(claudeArgsLogPath)).toBe(true);
    const launchedArgs = fs.readFileSync(claudeArgsLogPath, 'utf8');
    expect(launchedArgs).not.toContain(STEERING_PROMPT_SNIPPET);
  });

  it('falls back to native Read when the ImageAnalysis MCP runtime cannot be provisioned', () => {
    if (process.platform === 'win32') return;

    fs.writeFileSync(path.join(tmpHome, '.claude.json'), '{not-json', 'utf8');

    const result = runCcs(['glm', 'smoke'], baseEnv);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('could not prepare the local ImageAnalysis tool');
    const launchedArgs = fs.readFileSync(claudeArgsLogPath, 'utf8');
    const launchedEnv = fs.readFileSync(claudeEnvLogPath, 'utf8');
    expect(launchedArgs).not.toContain(STEERING_PROMPT_SNIPPET);
    expect(launchedEnv).toContain('skip=1');
    expect(launchedEnv).not.toContain('runtimeApiKey=current-token');
    expect(launchedEnv).not.toContain('runtimeBaseUrl=https://api.z.ai');
    expect(launchedEnv).not.toContain('runtimePath=/api/provider/agy');
  });

  it('suppresses stale CCS image hooks during a healthy MCP-first launch', () => {
    if (process.platform === 'win32') return;

    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          env: {
            ANTHROPIC_BASE_URL: 'https://api.z.ai/api/provider/agy',
            ANTHROPIC_AUTH_TOKEN: 'stale-token',
            ANTHROPIC_MODEL: 'glm-5',
          },
          hooks: {
            PreToolUse: [
              {
                matcher: 'Read',
                hooks: [
                  {
                    type: 'command',
                    command: 'node "/home/kai/.ccs/hooks/image-analyzer-transformer.cjs"',
                    timeout: 65000,
                  },
                ],
              },
            ],
          },
        },
        null,
        2
      ) + '\n'
    );

    const result = runCcs(['glm', 'smoke'], baseEnv);

    expect(result.status).toBe(0);
    const launchedArgs = fs.readFileSync(claudeArgsLogPath, 'utf8');
    const launchedEnv = fs.readFileSync(claudeEnvLogPath, 'utf8');
    const persistedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      hooks?: { PreToolUse?: Array<{ matcher?: string }> };
    };

    expect(launchedArgs).toContain(STEERING_PROMPT_SNIPPET);
    expect(launchedEnv).toContain('skipHook=1');
    expect(
      persistedSettings.hooks?.PreToolUse?.some((hook) => hook.matcher === 'Read') ?? false
    ).toBe(false);
  });

  it('keeps the legacy hook available when MCP provisioning fails', () => {
    if (process.platform === 'win32') return;

    fs.writeFileSync(path.join(tmpHome, '.claude.json'), '{not-json', 'utf8');

    const result = runCcs(['glm', 'smoke'], baseEnv);

    expect(result.status).toBe(0);
    const launchedEnv = fs.readFileSync(claudeEnvLogPath, 'utf8');
    const persistedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as {
      hooks?: { PreToolUse?: Array<{ matcher?: string }> };
    };

    expect(launchedEnv).not.toContain('skipHook=1');
    expect(persistedSettings.hooks?.PreToolUse?.some((hook) => hook.matcher === 'Read')).toBe(
      true
    );
  });

  it('pins bridge-backed image analysis to the current CLIProxy auth token', () => {
    if (process.platform === 'win32') return;

    const result = runCcs(['glm', 'smoke'], baseEnv);

    expect(result.status).toBe(0);
    expect(fs.existsSync(claudeEnvLogPath)).toBe(true);
    const launchedEnv = fs.readFileSync(claudeEnvLogPath, 'utf8');
    expect(launchedEnv).not.toContain('stale-token');
    expect(launchedEnv).not.toContain('runtimeApiKey=stale-token');
  });

  it('pins direct settings image analysis to the current local CLIProxy auth token', () => {
    if (process.platform === 'win32') return;

    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          env: {
            ANTHROPIC_BASE_URL: 'https://api.z.ai/v1',
            ANTHROPIC_AUTH_TOKEN: 'stale-token',
            ANTHROPIC_MODEL: 'glm-5',
          },
        },
        null,
        2
      ) + '\n'
    );

    const result = runCcs(['glm', 'smoke'], baseEnv);

    expect(result.status).toBe(0);
    expect(fs.existsSync(claudeEnvLogPath)).toBe(true);
    const launchedEnv = fs.readFileSync(claudeEnvLogPath, 'utf8');
    expect(launchedEnv).not.toContain('stale-token');
    expect(launchedEnv).not.toContain('runtimeApiKey=stale-token');
  });
});
