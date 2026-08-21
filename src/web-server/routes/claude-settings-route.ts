/**
 * Claude Code Settings Route
 *
 * Reads/writes ~/.claude/settings.json for Claude Code CLI configuration.
 * Handles model mapping (Sonnet/Opus/Fable/Haiku), API key, endpoint, context window.
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
    return JSON.parse(content);
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

function removeKeys(obj: Record<string, unknown>, keys: string[]): void {
  for (const key of keys) {
    delete obj[key];
  }
}

// ==================== Route Handlers ====================

/**
 * GET /api/cli-tools/claude-settings
 * Read current Claude Code settings from ~/.claude/settings.json
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const settingsPath = '~/.claude/settings.json';
    const settings = readJsonFile(settingsPath);

    if (!settings) {
      res.json({
        installed: false,
        settings: null,
        configured: false,
      });
      return;
    }

    const env = (settings.env as Record<string, string>) || {};
    const configured = Boolean(env.ANTHROPIC_BASE_URL);

    res.json({
      installed: true,
      settingsPath: expandHome(settingsPath),
      configured,
      settings: {
        baseUrl: env.ANTHROPIC_BASE_URL || '',
        apiKey: env.ANTHROPIC_AUTH_TOKEN || '',
        sonnetModel: env.ANTHROPIC_DEFAULT_SONNET_MODEL || '',
        opusModel: env.ANTHROPIC_DEFAULT_OPUS_MODEL || '',
        fableModel: env.ANTHROPIC_DEFAULT_FABLE_MODEL || '',
        haikuModel: env.ANTHROPIC_DEFAULT_HAIKU_MODEL || '',
        contextWindow: env.CLAUDE_CODE_MAX_CONTEXT_TOKENS || '',
      },
    });
  } catch (error) {
    console.error('[claude-settings] GET error:', (error as Error).message);
    res.status(500).json({ error: 'Failed to read Claude settings' });
  }
});

/**
 * POST /api/cli-tools/claude-settings
 * Write Claude Code settings to ~/.claude/settings.json
 * Merges with existing settings, preserving non-9Router fields.
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    // Accept either individual fields or raw env object
    let {
      baseUrl,
      apiKey,
      sonnetModel,
      opusModel,
      fableModel,
      haikuModel,
      contextWindow,
      env: rawEnv,
    } = req.body;

    // If raw env object provided, extract values from it
    if (rawEnv && typeof rawEnv === 'object') {
      baseUrl = rawEnv.ANTHROPIC_BASE_URL || '';
      apiKey = rawEnv.ANTHROPIC_AUTH_TOKEN || '';
      sonnetModel = rawEnv.ANTHROPIC_DEFAULT_SONNET_MODEL || '';
      opusModel = rawEnv.ANTHROPIC_DEFAULT_OPUS_MODEL || '';
      fableModel = rawEnv.ANTHROPIC_DEFAULT_FABLE_MODEL || '';
      haikuModel = rawEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL || '';
      contextWindow = rawEnv.CLAUDE_CODE_MAX_CONTEXT_TOKENS || '';
    }

    const settingsPath = '~/.claude/settings.json';
    const existing = readJsonFile(settingsPath) || {};

    // Ensure env object exists
    if (!existing.env || typeof existing.env !== 'object') {
      existing.env = {};
    }
    const env = existing.env as Record<string, string>;

    // Set or remove env vars based on provided values
    if (baseUrl !== undefined) {
      if (baseUrl) {
        // Ensure /v1 suffix
        const url = baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`;
        env.ANTHROPIC_BASE_URL = url;
      } else {
        delete env.ANTHROPIC_BASE_URL;
      }
    }

    if (apiKey !== undefined) {
      if (apiKey) {
        env.ANTHROPIC_AUTH_TOKEN = apiKey;
      } else {
        delete env.ANTHROPIC_AUTH_TOKEN;
      }
    }

    // Model mappings — only set if value is non-empty, otherwise remove
    const modelFields: Array<{ key: string; value: string | undefined }> = [
      { key: 'ANTHROPIC_DEFAULT_SONNET_MODEL', value: sonnetModel },
      { key: 'ANTHROPIC_DEFAULT_OPUS_MODEL', value: opusModel },
      { key: 'ANTHROPIC_DEFAULT_FABLE_MODEL', value: fableModel },
      { key: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', value: haikuModel },
    ];

    for (const { key, value } of modelFields) {
      if (value !== undefined) {
        if (value) {
          env[key] = value;
        } else {
          delete env[key];
        }
      }
    }

    // Context window
    if (contextWindow !== undefined) {
      if (contextWindow) {
        env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = contextWindow;
      } else {
        delete env.CLAUDE_CODE_MAX_CONTEXT_TOKENS;
      }
    }

    // Mark onboarding as completed
    existing.hasCompletedOnboarding = true;

    // Write back
    writeJsonFile(settingsPath, existing);

    res.json({
      success: true,
      settingsPath: expandHome(settingsPath),
      settings: {
        baseUrl: env.ANTHROPIC_BASE_URL || '',
        apiKey: env.ANTHROPIC_AUTH_TOKEN || '',
        sonnetModel: env.ANTHROPIC_DEFAULT_SONNET_MODEL || '',
        opusModel: env.ANTHROPIC_DEFAULT_OPUS_MODEL || '',
        fableModel: env.ANTHROPIC_DEFAULT_FABLE_MODEL || '',
        haikuModel: env.ANTHROPIC_DEFAULT_HAIKU_MODEL || '',
        contextWindow: env.CLAUDE_CODE_MAX_CONTEXT_TOKENS || '',
      },
    });
  } catch (error) {
    console.error('[claude-settings] POST error:', (error as Error).message);
    res.status(500).json({ error: 'Failed to write Claude settings' });
  }
});

/**
 * DELETE /api/cli-tools/claude-settings
 * Remove 9Router-specific env keys from ~/.claude/settings.json
 */
router.delete('/', async (_req: Request, res: Response) => {
  try {
    const settingsPath = '~/.claude/settings.json';
    const existing = readJsonFile(settingsPath);

    if (!existing) {
      res.json({ success: true, message: 'No settings file found' });
      return;
    }

    const env = (existing.env as Record<string, string>) || {};

    // Remove 9Router-injected keys
    removeKeys(env, [
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_FABLE_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'CLAUDE_CODE_MAX_CONTEXT_TOKENS',
    ]);

    writeJsonFile(settingsPath, existing);

    res.json({ success: true, message: 'Claude settings reset' });
  } catch (error) {
    console.error('[claude-settings] DELETE error:', (error as Error).message);
    res.status(500).json({ error: 'Failed to reset Claude settings' });
  }
});

export default router;
