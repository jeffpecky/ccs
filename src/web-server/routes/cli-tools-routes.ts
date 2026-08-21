/**
 * CLI Tools Routes
 *
 * API endpoints for managing CLI tool configurations.
 * Users can apply, view, and reset configs for supported CLI tools.
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getEffectiveApiKey } from '../../cliproxy/auth/auth-token-manager';
import { CLIPROXY_DEFAULT_PORT } from '../../cliproxy/config/port-manager';

const router = Router();

// ==================== Types ====================

export interface CLIToolConfig {
  /** Tool identifier */
  id: string;
  /** Display name */
  name: string;
  /** Description */
  description: string;
  /** Config type: env (env vars), custom (config file), guide (manual steps) */
  configType: 'env' | 'custom' | 'guide';
  /** Target config file paths */
  targetFiles?: string[];
  /** Environment variables to set */
  envVars?: Record<string, string>;
  /** Guide steps for manual configuration */
  guideSteps?: string[];
  /** Config template (JSON or TOML string) */
  configTemplate?: string;
}

// ==================== CLI Tool Definitions ====================

const CLI_TOOLS: CLIToolConfig[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Anthropic Claude Code CLI',
    configType: 'env',
    targetFiles: ['~/.claude/settings.json'],
    envVars: {
      ANTHROPIC_BASE_URL: '{{baseUrl}}',
      ANTHROPIC_AUTH_TOKEN: '{{apiKey}}',
    },
    configTemplate: JSON.stringify(
      {
        hasCompletedOnboarding: true,
        env: {
          ANTHROPIC_BASE_URL: '{{baseUrl}}',
          ANTHROPIC_AUTH_TOKEN: '{{apiKey}}',
        },
      },
      null,
      2
    ),
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    description: 'OpenCode CLI - AI coding assistant',
    configType: 'custom',
    targetFiles: ['~/.config/opencode/opencode.json'],
    configTemplate: JSON.stringify(
      {
        provider: {
          ccs: {
            npm: '@ai-sdk/openai-compatible',
            options: {
              baseURL: '{{baseUrl}}',
              apiKey: '{{apiKey}}',
            },
            models: {},
          },
        },
        model: 'ccs/',
      },
      null,
      2
    ),
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    description: 'OpenAI Codex CLI',
    configType: 'custom',
    targetFiles: ['~/.codex/config.toml', '~/.codex/auth.json'],
    configTemplate: `# CCS Configuration for Codex CLI
model = "provider/model-id"
model_provider = "ccs"

[model_providers.ccs]
name = "CCS"
base_url = "{{baseUrl}}"
wire_api = "responses"`,
  },
  {
    id: 'open-claw',
    name: 'Open Claw',
    description: 'Open Claw CLI - AI coding assistant',
    configType: 'env',
    targetFiles: ['~/.openclaw/config.json'],
    configTemplate: JSON.stringify(
      {
        baseUrl: '{{baseUrl}}',
        apiKey: '{{apiKey}}',
      },
      null,
      2
    ),
  },
  {
    id: 'claude-cowork',
    name: 'Claude Cowork',
    description: 'Claude Cowork - Collaborative AI coding',
    configType: 'env',
    targetFiles: ['~/.claude-cowork/config.json'],
    configTemplate: JSON.stringify(
      {
        baseUrl: '{{baseUrl}}',
        apiKey: '{{apiKey}}',
      },
      null,
      2
    ),
  },
  {
    id: 'hermes-agent',
    name: 'Hermes Agent',
    description: 'Hermes Agent - AI coding assistant',
    configType: 'env',
    targetFiles: ['~/.hermes-agent/config.json'],
    configTemplate: JSON.stringify(
      {
        baseUrl: '{{baseUrl}}',
        apiKey: '{{apiKey}}',
      },
      null,
      2
    ),
  },
  {
    id: 'factory-droid',
    name: 'Factory Droid',
    description: 'Factory Droid - AI coding assistant',
    configType: 'env',
    targetFiles: ['~/.factory-droid/config.json'],
    configTemplate: JSON.stringify(
      {
        baseUrl: '{{baseUrl}}',
        apiKey: '{{apiKey}}',
      },
      null,
      2
    ),
  },
  {
    id: 'cursor',
    name: 'Cursor',
    description: 'Cursor IDE - AI-first code editor',
    configType: 'env',
    targetFiles: ['~/.cursor/config.json'],
    configTemplate: JSON.stringify(
      {
        baseUrl: '{{baseUrl}}',
        apiKey: '{{apiKey}}',
      },
      null,
      2
    ),
  },
  {
    id: 'cline',
    name: 'Cline',
    description: 'Cline - AI coding assistant',
    configType: 'env',
    targetFiles: ['~/.cline/config.json'],
    configTemplate: JSON.stringify(
      {
        baseUrl: '{{baseUrl}}',
        apiKey: '{{apiKey}}',
      },
      null,
      2
    ),
  },
  {
    id: 'kilo-code',
    name: 'Kilo Code',
    description: 'Kilo Code - AI coding assistant',
    configType: 'env',
    targetFiles: ['~/.kilo-code/config.json'],
    configTemplate: JSON.stringify(
      {
        baseUrl: '{{baseUrl}}',
        apiKey: '{{apiKey}}',
      },
      null,
      2
    ),
  },
  {
    id: 'roo',
    name: 'Roo',
    description: 'Roo - AI coding assistant',
    configType: 'env',
    targetFiles: ['~/.roo/config.json'],
    configTemplate: JSON.stringify(
      {
        baseUrl: '{{baseUrl}}',
        apiKey: '{{apiKey}}',
      },
      null,
      2
    ),
  },
  {
    id: 'continue',
    name: 'Continue',
    description: 'Continue - AI coding assistant',
    configType: 'env',
    targetFiles: ['~/.continue/config.json'],
    configTemplate: JSON.stringify(
      {
        baseUrl: '{{baseUrl}}',
        apiKey: '{{apiKey}}',
      },
      null,
      2
    ),
  },
  {
    id: 'amp-cli',
    name: 'Amp CLI',
    description: 'Amp CLI - AI coding assistant',
    configType: 'env',
    targetFiles: ['~/.amp-cli/config.json'],
    configTemplate: JSON.stringify(
      {
        baseUrl: '{{baseUrl}}',
        apiKey: '{{apiKey}}',
      },
      null,
      2
    ),
  },
  {
    id: 'qwen-code',
    name: 'Qwen Code',
    description: 'Qwen Code - AI coding assistant',
    configType: 'env',
    targetFiles: ['~/.qwen-code/config.json'],
    configTemplate: JSON.stringify(
      {
        baseUrl: '{{baseUrl}}',
        apiKey: '{{apiKey}}',
      },
      null,
      2
    ),
  },
  {
    id: 'deepseek-tui',
    name: 'DeepSeek TUI',
    description: 'DeepSeek TUI - AI coding assistant',
    configType: 'env',
    targetFiles: ['~/.deepseek-tui/config.json'],
    configTemplate: JSON.stringify(
      {
        baseUrl: '{{baseUrl}}',
        apiKey: '{{apiKey}}',
      },
      null,
      2
    ),
  },
  {
    id: 'jcode',
    name: 'jcode',
    description: 'jcode - AI coding assistant',
    configType: 'env',
    targetFiles: ['~/.jcode/config.json'],
    configTemplate: JSON.stringify(
      {
        baseUrl: '{{baseUrl}}',
        apiKey: '{{apiKey}}',
      },
      null,
      2
    ),
  },
  {
    id: 'grok-build',
    name: 'Grok Build',
    description: 'Grok Build - AI coding assistant',
    configType: 'env',
    targetFiles: ['~/.grok-build/config.json'],
    configTemplate: JSON.stringify(
      {
        baseUrl: '{{baseUrl}}',
        apiKey: '{{apiKey}}',
      },
      null,
      2
    ),
  },
  {
    id: 'devin-cli',
    name: 'Devin CLI',
    description: 'Devin CLI - AI coding assistant',
    configType: 'env',
    targetFiles: ['~/.devin-cli/config.json'],
    configTemplate: JSON.stringify(
      {
        baseUrl: '{{baseUrl}}',
        apiKey: '{{apiKey}}',
      },
      null,
      2
    ),
  },
];

// ==================== Helper Functions ====================

function expandHome(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

function getProviderEndpoint(port: number = CLIPROXY_DEFAULT_PORT): string {
  return `http://127.0.0.1:${port}`;
}

function getApiKey(): string {
  return getEffectiveApiKey();
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

// ==================== Routes ====================

/**
 * GET /api/cli-tools
 * List all supported CLI tools with their status
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const port = CLIPROXY_DEFAULT_PORT;
    const baseUrl = getProviderEndpoint(port);
    const apiKey = getApiKey();

    const toolsWithStatus = await Promise.all(
      CLI_TOOLS.map(async (tool) => {
        const status = await getToolStatus(tool.id);
        const config = tool.configTemplate
          ? fillTemplate(tool.configTemplate, { baseUrl, apiKey })
          : undefined;

        return {
          ...tool,
          status,
          config,
          endpoint: baseUrl,
        };
      })
    );

    res.json({ tools: toolsWithStatus });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to list CLI tools' });
  }
});

/**
 * GET /api/cli-tools/:toolId/status
 * Check if a CLI tool is installed
 */
router.get('/:toolId/status', async (req: Request, res: Response) => {
  try {
    const { toolId } = req.params;
    const status = await getToolStatus(toolId);
    res.json({ toolId, status });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to check tool status' });
  }
});

/**
 * GET /api/cli-tools/:toolId/config
 * Get the configuration content for a CLI tool
 */
router.get('/:toolId/config', async (req: Request, res: Response) => {
  try {
    const { toolId } = req.params;
    const tool = CLI_TOOLS.find((t) => t.id === toolId);

    if (!tool) {
      res.status(404).json({ error: 'Tool not found' });
      return;
    }

    const port = CLIPROXY_DEFAULT_PORT;
    const baseUrl = getProviderEndpoint(port);
    const apiKey = getApiKey();

    const config = tool.configTemplate
      ? fillTemplate(tool.configTemplate, { baseUrl, apiKey })
      : undefined;

    res.json({
      toolId,
      config,
      targetFiles: tool.targetFiles?.map(expandHome),
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to get tool config' });
  }
});

/**
 * POST /api/cli-tools/:toolId/apply
 * Apply configuration for a CLI tool (write config files)
 */
router.post('/:toolId/apply', async (req: Request, res: Response) => {
  try {
    const { toolId } = req.params;
    const tool = CLI_TOOLS.find((t) => t.id === toolId);

    if (!tool) {
      res.status(404).json({ error: 'Tool not found' });
      return;
    }

    const port = CLIPROXY_DEFAULT_PORT;
    const baseUrl = getProviderEndpoint(port);
    const apiKey = getApiKey();

    if (!tool.configTemplate) {
      res.status(400).json({ error: 'Tool does not support auto-apply' });
      return;
    }

    const config = fillTemplate(tool.configTemplate, { baseUrl, apiKey });
    const results: Array<{ file: string; success: boolean; error?: string }> = [];

    if (tool.targetFiles) {
      for (const targetFile of tool.targetFiles) {
        const expandedPath = expandHome(targetFile);
        try {
          // Ensure directory exists
          const dir = path.dirname(expandedPath);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          // For Codex, handle multiple files
          if (toolId === 'codex' && targetFile.endsWith('.json')) {
            // Write auth.json
            const authConfig = JSON.stringify(
              { auth_mode: 'apikey', OPENAI_API_KEY: apiKey },
              null,
              2
            );
            fs.writeFileSync(expandedPath, authConfig, 'utf-8');
          } else {
            fs.writeFileSync(expandedPath, config, 'utf-8');
          }

          results.push({ file: expandedPath, success: true });
        } catch (err) {
          results.push({
            file: expandedPath,
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    }

    res.json({ toolId, results });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to apply tool config' });
  }
});

/**
 * POST /api/cli-tools/:toolId/reset
 * Reset configuration for a CLI tool (restore original config)
 */
router.post('/:toolId/reset', async (req: Request, res: Response) => {
  try {
    const { toolId } = req.params;
    const tool = CLI_TOOLS.find((t) => t.id === toolId);

    if (!tool) {
      res.status(404).json({ error: 'Tool not found' });
      return;
    }

    const results: Array<{ file: string; success: boolean; error?: string }> = [];

    if (tool.targetFiles) {
      for (const targetFile of tool.targetFiles) {
        const expandedPath = expandHome(targetFile);
        try {
          // Check if file exists before deleting
          if (fs.existsSync(expandedPath)) {
            // Create backup before deleting
            const backupPath = `${expandedPath}.backup`;
            fs.copyFileSync(expandedPath, backupPath);
            fs.unlinkSync(expandedPath);
            results.push({ file: expandedPath, success: true });
          } else {
            results.push({ file: expandedPath, success: true });
          }
        } catch (err) {
          results.push({
            file: expandedPath,
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    }

    res.json({ toolId, results });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to reset tool config' });
  }
});

// ==================== Helper: Get Tool Status ====================

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function getToolStatus(
  toolId: string
): Promise<'installed' | 'not-installed' | 'unknown'> {
  try {
    const isWindows = process.platform === 'win32';
    const binaryNames: Record<string, string[]> = {
      'claude-code': ['claude'],
      opencode: ['opencode'],
      codex: ['codex'],
    };

    const bins = binaryNames[toolId] || [];

    for (const bin of bins) {
      try {
        const command = isWindows ? `where ${bin}` : `which ${bin}`;
        // On Windows, add npm global path to PATH
        const env = isWindows
          ? { ...process.env, PATH: `${process.env.APPDATA}\\npm;${process.env.PATH}` }
          : process.env;
        await execAsync(command, { windowsHide: true, env });
        return 'installed';
      } catch {
        // Binary not found in PATH, continue to next check
      }
    }

    // Fallback: check if config file exists
    const configPaths: Record<string, string[]> = {
      'claude-code': [
        path.join(os.homedir(), '.claude', 'settings.json'),
      ],
      opencode: [
        path.join(os.homedir(), '.config', 'opencode', 'opencode.json'),
      ],
      codex: [
        path.join(os.homedir(), '.codex', 'config.toml'),
        path.join(os.homedir(), '.codex', 'auth.json'),
      ],
    };

    const paths = configPaths[toolId] || [];
    for (const configPath of paths) {
      if (fs.existsSync(configPath)) {
        return 'installed';
      }
    }

    return 'not-installed';
  } catch {
    return 'unknown';
  }
}

export default router;
