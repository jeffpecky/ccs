/**
 * Factory Droid CLI Settings Route
 *
 * Reads/writes ~/.factory-droid/config.json for Factory Droid CLI.
 * Handles custom_models array format.
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

function writeJsonFile(filePath: string, data: unknown): void {
  writeFile(filePath, JSON.stringify(data, null, 2));
}

// ==================== Route Handlers ====================

/**
 * GET /api/cli-tools/factory-droid-settings
 * Read current Factory Droid config from ~/.factory-droid/config.json
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const configPath = '~/.factory-droid/config.json';
    const configContent = readFile(configPath);

    if (!configContent) {
      res.json({
        installed: false,
        config: null,
        configured: false,
      });
      return;
    }

    let customModels: Array<{
      model: string;
      base_url: string;
      api_key: string;
      provider: string;
    }> = [];

    try {
      const config = JSON.parse(configContent);
      customModels = config.custom_models || [];
    } catch {
      // ignore parse errors
    }

    const configured = customModels.length > 0;

    res.json({
      installed: true,
      configPath: expandHome(configPath),
      configured,
      config: {
        custom_models: customModels,
      },
    });
  } catch (error) {
    console.error('[factory-droid-settings] GET error:', (error as Error).message);
    res.status(500).json({ error: 'Failed to read Factory Droid config' });
  }
});

/**
 * POST /api/cli-tools/factory-droid-settings
 * Write Factory Droid config to ~/.factory-droid/config.json
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { custom_models } = req.body;

    if (!Array.isArray(custom_models)) {
      res.status(400).json({ error: 'custom_models array is required' });
      return;
    }

    const config = { custom_models };

    writeJsonFile('~/.factory-droid/config.json', config);

    res.json({
      success: true,
      configPath: expandHome('~/.factory-droid/config.json'),
      config,
    });
  } catch (error) {
    console.error('[factory-droid-settings] POST error:', (error as Error).message);
    res.status(500).json({ error: 'Failed to write Factory Droid config' });
  }
});

/**
 * DELETE /api/cli-tools/factory-droid-settings
 * Remove Factory Droid config
 */
router.delete('/', async (_req: Request, res: Response) => {
  try {
    const configPath = expandHome('~/.factory-droid/config.json');

    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }

    res.json({ success: true, message: 'Factory Droid config reset' });
  } catch (error) {
    console.error('[factory-droid-settings] DELETE error:', (error as Error).message);
    res.status(500).json({ error: 'Failed to reset Factory Droid config' });
  }
});

export default router;
