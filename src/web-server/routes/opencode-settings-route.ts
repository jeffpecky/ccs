/**
 * OpenCode Settings Route
 *
 * Reads/writes ~/.config/opencode/opencode.json for OpenCode CLI.
 * Handles active model, sub-agent model, endpoint, API key.
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const router = Router();

// ==================== Helpers ====================

function expandHome(filePath: string): string {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    const expanded = expandHome(filePath);
    if (!fs.existsSync(expanded)) return null;
    const content = fs.readFileSync(expanded, 'utf-8');
    // Strip comments for JSONC tolerance
    const stripped = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, data: Record<string, unknown>): void {
  const expanded = expandHome(filePath);
  const dir = path.dirname(expanded);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(expanded, JSON.stringify(data, null, 2), 'utf-8');
}

// ==================== Route Handlers ====================

/**
 * GET /api/cli-tools/opencode-settings
 * Read current OpenCode config from ~/.config/opencode/opencode.json
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const configPath = '~/.config/opencode/opencode.json';
    const config = readJsonFile(configPath);

    if (!config) {
      res.json({
        installed: false,
        config: null,
        configured: false,
      });
      return;
    }

    const provider = (config.provider as Record<string, unknown>) || {};
    const ccsProvider = provider.ccs as Record<string, unknown> | undefined;
    const options = (ccsProvider?.options as Record<string, string>) || {};

    const activeModel = (config.model as string) || '';
    const configured = Boolean(options.baseURL);

    // Check for sub-agent config
    const agentConfig = (config.agent as Record<string, unknown>) || {};
    const explorer = agentConfig.explorer as Record<string, unknown> | undefined;
    const subagentModel = (explorer?.model as string) || '';

    res.json({
      installed: true,
      configPath: expandHome(configPath),
      configured,
      config: {
        model: activeModel.replace(/^ccs\//, ''),
        baseUrl: options.baseURL || '',
        apiKey: options.apiKey || '',
        subagentModel: subagentModel.replace(/^ccs\//, ''),
      },
    });
  } catch (error) {
    console.error('[opencode-settings] GET error:', (error as Error).message);
    res.status(500).json({ error: 'Failed to read OpenCode config' });
  }
});

/**
 * POST /api/cli-tools/opencode-settings
 * Write OpenCode config to ~/.config/opencode/opencode.json
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    // Accept either individual fields or raw env object
    let { model, baseUrl, apiKey, subagentModel, env: rawEnv } = req.body;

    // If raw env object provided, extract values from it
    if (rawEnv && typeof rawEnv === 'object') {
      baseUrl = rawEnv.ANTHROPIC_BASE_URL || rawEnv.OPENCODE_BASE_URL || '';
      apiKey = rawEnv.ANTHROPIC_AUTH_TOKEN || rawEnv.OPENCODE_API_KEY || '';
      model = rawEnv.ANTHROPIC_MODEL || rawEnv.OPENCODE_MODEL || '';
      subagentModel = rawEnv.ANTHROPIC_DEFAULT_SONNET_MODEL || rawEnv.OPENCODE_SUB_AGENT_MODEL || '';
    }

    if (!model) {
      res.status(400).json({ error: 'model is required' });
      return;
    }

    const configPath = expandHome('~/.config/opencode/opencode.json');
    const existing = readJsonFile(configPath) || {};

    const providerName = 'ccs';
    const effectiveBaseUrl = baseUrl || 'http://127.0.0.1:8317/v1';

    // Build provider config
    if (!existing.provider || typeof existing.provider !== 'object') {
      existing.provider = {};
    }
    const providers = existing.provider as Record<string, unknown>;

    providers[providerName] = {
      npm: '@ai-sdk/openai-compatible',
      options: {
        baseURL: effectiveBaseUrl,
        apiKey: apiKey || 'no-key',
      },
      models: {
        [model]: {
          name: model,
          attachmentModel: 'google/gemini-3.1-flash-lite-preview',
          reasoning: false,
          temperature: 0.7,
        },
      },
    };

    // Set active model
    existing.model = `${providerName}/${model}`;

    // Set sub-agent config
    if (subagentModel) {
      if (!existing.agent || typeof existing.agent !== 'object') {
        existing.agent = {};
      }
      const agent = existing.agent as Record<string, unknown>;
      agent.explorer = {
        description: 'Fast explorer subagent for codebase navigation',
        mode: 'subagent',
        model: `${providerName}/${subagentModel}`,
      };
    }

    writeJsonFile(configPath, existing);

    res.json({
      success: true,
      configPath,
      config: { model, baseUrl: effectiveBaseUrl, subagentModel: subagentModel || '' },
    });
  } catch (error) {
    console.error('[opencode-settings] POST error:', (error as Error).message);
    res.status(500).json({ error: 'Failed to write OpenCode config' });
  }
});

/**
 * DELETE /api/cli-tools/opencode-settings
 * Remove CCS provider from ~/.config/opencode/opencode.json
 */
router.delete('/', async (_req: Request, res: Response) => {
  try {
    const configPath = expandHome('~/.config/opencode/opencode.json');
    const existing = readJsonFile(configPath);

    if (!existing) {
      res.json({ success: true, message: 'No config file found' });
      return;
    }

    // Remove CCS provider
    const providers = (existing.provider as Record<string, unknown>) || {};
    delete providers.ccs;

    // Reset model if it was pointing to CCS
    if (typeof existing.model === 'string' && existing.model.startsWith('ccs/')) {
      delete existing.model;
    }

    // Remove CCS sub-agent config
    const agent = (existing.agent as Record<string, unknown>) || {};
    const explorer = agent.explorer as Record<string, unknown> | undefined;
    if (explorer && typeof explorer.model === 'string' && explorer.model.startsWith('ccs/')) {
      delete agent.explorer;
    }

    writeJsonFile(configPath, existing);

    res.json({ success: true, message: 'OpenCode config reset' });
  } catch (error) {
    console.error('[opencode-settings] DELETE error:', (error as Error).message);
    res.status(500).json({ error: 'Failed to reset OpenCode config' });
  }
});

export default router;
