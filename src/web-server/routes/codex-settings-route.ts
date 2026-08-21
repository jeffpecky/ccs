/**
 * Codex CLI Settings Route
 *
 * Reads/writes ~/.codex/config.toml and ~/.codex/auth.json for Codex CLI.
 * Handles main model, sub-agent model, endpoint, API key.
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

function readFile(filePath: string): string | null {
  try {
    const expanded = expandHome(filePath);
    if (!fs.existsSync(expanded)) return null;
    return fs.readFileSync(expanded, 'utf-8');
  } catch {
    return null;
  }
}

function writeFile(filePath: string, content: string): void {
  const expanded = expandHome(filePath);
  const dir = path.dirname(expanded);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(expanded, content, 'utf-8');
}

function writeJsonFile(filePath: string, data: Record<string, unknown>): void {
  writeFile(filePath, JSON.stringify(data, null, 2));
}

// ==================== Simple TOML Builder ====================

interface CodexConfig {
  model: string;
  modelProvider: string;
  baseUrl: string;
  wireApi: string;
  subagentModel: string;
}

function buildCodexToml(config: CodexConfig): string {
  const lines: string[] = [];

  lines.push(`model = "${config.model}"`);
  lines.push(`model_provider = "${config.modelProvider}"`);
  lines.push('');
  lines.push(`[model_providers.${config.modelProvider}]`);
  lines.push(`name = "CCS"`);
  lines.push(`base_url = "${config.baseUrl}"`);
  lines.push(`wire_api = "${config.wireApi}"`);

  if (config.subagentModel) {
    lines.push('');
    lines.push('[agents.subagent]');
    lines.push(`model = "${config.subagentModel}"`);
  }

  return lines.join('\n') + '\n';
}

// ==================== Route Handlers ====================

/**
 * GET /api/cli-tools/codex-settings
 * Read current Codex config from ~/.codex/config.toml + auth.json
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const configPath = '~/.codex/config.toml';
    const authPath = '~/.codex/auth.json';

    const configContent = readFile(configPath);
    const authContent = readFile(authPath);

    if (!configContent) {
      res.json({
        installed: false,
        config: null,
        configured: false,
      });
      return;
    }

    // Parse simple TOML fields
    const modelMatch = configContent.match(/^model\s*=\s*"([^"]+)"/m);
    const baseUrlMatch = configContent.match(/base_url\s*=\s*"([^"]+)"/m);
    const subagentMatch = configContent.match(/\[agents\.subagent\]\s*\nmodel\s*=\s*"([^"]+)"/m);

    let apiKey = '';
    if (authContent) {
      try {
        const auth = JSON.parse(authContent);
        apiKey = auth.OPENAI_API_KEY || '';
      } catch {
        // ignore parse errors
      }
    }

    const configured = Boolean(baseUrlMatch?.[1]);

    res.json({
      installed: true,
      configPath: expandHome(configPath),
      authPath: expandHome(authPath),
      configured,
      config: {
        model: modelMatch?.[1] || '',
        baseUrl: baseUrlMatch?.[1] || '',
        apiKey,
        subagentModel: subagentMatch?.[1] || '',
      },
    });
  } catch (error) {
    console.error('[codex-settings] GET error:', (error as Error).message);
    res.status(500).json({ error: 'Failed to read Codex config' });
  }
});

/**
 * POST /api/cli-tools/codex-settings
 * Write Codex config to ~/.codex/config.toml + ~/.codex/auth.json
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    // Accept either individual fields or raw env object
    let { model, baseUrl, apiKey, subagentModel, wireApi, env: rawEnv } = req.body;

    // If raw env object provided, extract values from it
    if (rawEnv && typeof rawEnv === 'object') {
      baseUrl = rawEnv.ANTHROPIC_BASE_URL || rawEnv.OPENAI_BASE_URL || '';
      apiKey = rawEnv.ANTHROPIC_AUTH_TOKEN || rawEnv.OPENAI_API_KEY || '';
      model = rawEnv.ANTHROPIC_MODEL || rawEnv.OPENAI_MODEL || '';
      subagentModel = rawEnv.ANTHROPIC_DEFAULT_SONNET_MODEL || rawEnv.OPENAI_SUB_AGENT_MODEL || '';
    }

    if (!model) {
      res.status(400).json({ error: 'model is required' });
      return;
    }

    const providerName = 'ccs';
    const effectiveBaseUrl = baseUrl || 'http://127.0.0.1:8317/v1';
    const effectiveWireApi = wireApi || 'responses';

    // Build TOML
    const toml = buildCodexToml({
      model,
      modelProvider: providerName,
      baseUrl: effectiveBaseUrl,
      wireApi: effectiveWireApi,
      subagentModel: subagentModel || '',
    });

    // Write config.toml
    writeFile('~/.codex/config.toml', toml);

    // Write auth.json
    if (apiKey) {
      writeJsonFile('~/.codex/auth.json', {
        auth_mode: 'apikey',
        OPENAI_API_KEY: apiKey,
      });
    }

    res.json({
      success: true,
      configPath: expandHome('~/.codex/config.toml'),
      authPath: expandHome('~/.codex/auth.json'),
      config: { model, baseUrl: effectiveBaseUrl, subagentModel: subagentModel || '' },
    });
  } catch (error) {
    console.error('[codex-settings] POST error:', (error as Error).message);
    res.status(500).json({ error: 'Failed to write Codex config' });
  }
});

/**
 * DELETE /api/cli-tools/codex-settings
 * Remove 9Router/CCS config from ~/.codex/config.toml + auth.json
 */
router.delete('/', async (_req: Request, res: Response) => {
  try {
    const configPath = expandHome('~/.codex/config.toml');
    const authPath = expandHome('~/.codex/auth.json');

    // Remove config.toml
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }

    // Remove auth.json
    if (fs.existsSync(authPath)) {
      fs.unlinkSync(authPath);
    }

    res.json({ success: true, message: 'Codex config reset' });
  } catch (error) {
    console.error('[codex-settings] DELETE error:', (error as Error).message);
    res.status(500).json({ error: 'Failed to reset Codex config' });
  }
});

export default router;
