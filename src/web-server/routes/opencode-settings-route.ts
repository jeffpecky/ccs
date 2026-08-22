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
    const openaiProvider = provider.openai as Record<string, unknown> | undefined;
    const options = (openaiProvider?.options as Record<string, string>) || {};

    const activeModel = (config.model as string) || '';
    const configured = Boolean(options.baseURL);

    // Check for sub-agent config
    const agentConfig = (config.agent as Record<string, unknown>) || {};
    const explorer = agentConfig.explorer as Record<string, unknown> | undefined;
    const subagentModel = (explorer?.model as string) || '';

    // Return simple format for frontend
    res.json({
      installed: true,
      configPath: expandHome(configPath),
      configured,
      config: {
        baseUrl: options.baseURL || '',
        apiKey: options.apiKey || '',
        model: activeModel,
        subagentModel,
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
    let { model, baseUrl, apiKey, subagentModel, env: rawEnv } = req.body;

    if (rawEnv && typeof rawEnv === 'object') {
      baseUrl = rawEnv.OPENCODE_BASE_URL || '';
      apiKey = rawEnv.OPENCODE_API_KEY || '';
      model = rawEnv.OPENCODE_MODEL || '';
      subagentModel = rawEnv.OPENCODE_SUB_AGENT_MODEL || '';
    }

    if (!model) {
      res.status(400).json({ error: 'model is required' });
      return;
    }

    const configPath = expandHome('~/.config/opencode/opencode.json');
    const existing = readJsonFile(configPath) || {};

    const effectiveBaseUrl = baseUrl || 'http://127.0.0.1:8317/v1';

    // Build native OpenCode config format
    if (!existing.provider || typeof existing.provider !== 'object') {
      existing.provider = {};
    }
    const providers = existing.provider as Record<string, unknown>;

    providers.openai = {
      options: {
        baseURL: effectiveBaseUrl,
        apiKey: apiKey || 'sk-dummy',
      },
    };

    // Set active model
    existing.model = model;

    // Set sub-agent config
    if (subagentModel) {
      if (!existing.agent || typeof existing.agent !== 'object') {
        existing.agent = {};
      }
      const agent = existing.agent as Record<string, unknown>;
      agent.explorer = {
        description: 'Fast explorer subagent for codebase navigation',
        mode: 'subagent',
        model: subagentModel,
      };
    }

    writeJsonFile(configPath, existing);

    // Return simple format for frontend
    res.json({
      success: true,
      configPath,
      config: { baseUrl: effectiveBaseUrl, apiKey: apiKey || 'sk-dummy', model, subagentModel: subagentModel || '' },
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

    // Remove openai provider
    const providers = (existing.provider as Record<string, unknown>) || {};
    delete providers.openai;

    // Reset model if it was set
    if (typeof existing.model === 'string') {
      delete existing.model;
    }

    writeJsonFile(configPath, existing);

    res.json({ success: true, message: 'OpenCode config reset' });
  } catch (error) {
    console.error('[opencode-settings] DELETE error:', (error as Error).message);
    res.status(500).json({ error: 'Failed to reset OpenCode config' });
  }
});

export default router;
