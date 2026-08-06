/**
 * CLIProxy Variant Settings File Manager
 *
 * Handles creation of settings.json files for CLIProxy variants.
 * These files contain environment variables for Claude CLI integration.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CLIProxyProfileName } from '../../auth/profile-detector';

import { expandPath } from '../../utils/helpers';
import { getClaudeEnvVars, CLIPROXY_DEFAULT_PORT } from '../config/config-generator';
import { CLIProxyProvider } from '../types';
import { CompositeTierConfig } from '../../config/unified-config-types';
import { getEffectiveApiKey } from '../auth/auth-token-manager';
import { warn } from '../../utils/ui';
import { normalizeModelIdForProvider } from '../ai-providers/model-id-normalizer';
import { getCcsDir } from '../../config/config-loader-facade';

/** Environment settings structure */
interface SettingsEnv {
  [key: string]: string;
  ANTHROPIC_BASE_URL: string;
  ANTHROPIC_AUTH_TOKEN: string;
  ANTHROPIC_MODEL: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL: string;
}

interface SettingsFile {
  env: Record<string, string>;
  [key: string]: unknown;
}

function canonicalizeModelForProvider(
  provider: CLIProxyProfileName | undefined,
  model: string
): string {
  if (!provider) return model;
  return normalizeModelIdForProvider(model, provider);
}

/**
 * Build settings env object for a variant
 */
function buildSettingsEnv(
  provider: CLIProxyProfileName,
  model: string,
  port: number = CLIPROXY_DEFAULT_PORT
): SettingsEnv {
  const baseEnv = getClaudeEnvVars(provider as CLIProxyProvider, port);
  const normalizedModel = canonicalizeModelForProvider(provider, model);
  const defaultModel = normalizedModel;
  const opusModel = normalizedModel;
  const sonnetModel = normalizedModel;
  const haikuModel = canonicalizeModelForProvider(
    provider,
    baseEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL || model
  );

  return {
    ANTHROPIC_BASE_URL: baseEnv.ANTHROPIC_BASE_URL || '',
    ANTHROPIC_AUTH_TOKEN: baseEnv.ANTHROPIC_AUTH_TOKEN || '',
    ANTHROPIC_MODEL: defaultModel,
    ANTHROPIC_DEFAULT_OPUS_MODEL: opusModel,
    ANTHROPIC_DEFAULT_SONNET_MODEL: sonnetModel,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: haikuModel,
  };
}

/**
 * Ensure directory exists
 */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Write settings file atomically using temp file + rename.
 * The renameSync is atomic on POSIX systems, preventing partial writes on crash.
 */
function writeSettings(filePath: string, settings: SettingsFile): void {
  const tempPath = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tempPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  fs.renameSync(tempPath, filePath);
}

/**
 * Get settings file path for a variant
 */
export function getSettingsFilePath(provider: CLIProxyProfileName, name: string): string {
  const ccsDir = getCcsDir();
  return path.join(ccsDir, `${provider}-${name}.settings.json`);
}

/**
 * Get settings file name (without path)
 */
export function getSettingsFileName(provider: CLIProxyProfileName, name: string): string {
  return `${provider}-${name}.settings.json`;
}

/**
 * Get relative settings path with ~ prefix
 */
export function getRelativeSettingsPath(provider: CLIProxyProfileName, name: string): string {
  return `~/.ccs/${getSettingsFileName(provider, name)}`;
}

/**
 * Create settings.json file for CLIProxy variant (legacy mode)
 */
export function createSettingsFile(
  name: string,
  provider: CLIProxyProfileName,
  model: string,
  port: number = CLIPROXY_DEFAULT_PORT
): string {
  const ccsDir = getCcsDir();
  const settingsPath = getSettingsFilePath(provider, name);

  const settings: SettingsFile = {
    env: buildSettingsEnv(provider, model, port),
  };

  ensureDir(ccsDir);
  writeSettings(settingsPath, settings);

  return settingsPath;
}

/**
 * Create settings.json file for CLIProxy variant (unified mode)
 */
export function createSettingsFileUnified(
  name: string,
  provider: CLIProxyProfileName,
  model: string,
  port: number = CLIPROXY_DEFAULT_PORT
): string {
  const ccsDir = getCcsDir(); // Use centralized function for CCS_HOME support
  const settingsPath = path.join(ccsDir, getSettingsFileName(provider, name));

  const settings: SettingsFile = {
    env: buildSettingsEnv(provider, model, port),
  };

  ensureDir(ccsDir);
  writeSettings(settingsPath, settings);

  return settingsPath;
}

/**
 * Build settings env object for a composite variant.
 * Uses root URL (no /api/provider/ path) for model-based routing.
 */
function buildCompositeSettingsEnv(
  tiers: { opus: CompositeTierConfig; sonnet: CompositeTierConfig; haiku: CompositeTierConfig },
  defaultTier: 'opus' | 'sonnet' | 'haiku',
  port: number = CLIPROXY_DEFAULT_PORT
): SettingsEnv {
  const defaultModel = tiers[defaultTier].model;

  return {
    // Root URL — CLIProxyAPI routes based on model name, no provider prefix
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    ANTHROPIC_AUTH_TOKEN: getEffectiveApiKey(),
    ANTHROPIC_MODEL: defaultModel,
    ANTHROPIC_DEFAULT_OPUS_MODEL: tiers.opus.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: tiers.sonnet.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: tiers.haiku.model,
  };
}

/**
 * Create settings.json file for a composite variant.
 */
export function createCompositeSettingsFile(
  name: string,
  tiers: { opus: CompositeTierConfig; sonnet: CompositeTierConfig; haiku: CompositeTierConfig },
  defaultTier: 'opus' | 'sonnet' | 'haiku',
  port: number = CLIPROXY_DEFAULT_PORT,
  settingsPathOverride?: string
): string {
  const ccsDir = getCcsDir();
  const defaultSettingsPath = path.join(ccsDir, `composite-${name}.settings.json`);
  const settingsPath = settingsPathOverride
    ? (() => {
        const expanded = expandPath(settingsPathOverride);
        return path.isAbsolute(expanded) ? expanded : path.join(ccsDir, expanded);
      })()
    : defaultSettingsPath;
  const settingsDir = path.dirname(settingsPath);

  const coreEnv = buildCompositeSettingsEnv(tiers, defaultTier, port);
  let settings: SettingsFile = { env: coreEnv };

  // Preserve non-core env vars and non-env fields (hooks/presets/etc.) when regenerating.
  if (fs.existsSync(settingsPath)) {
    try {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      const parsed = JSON.parse(content) as SettingsFile;

      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const existingEnv =
          parsed.env && typeof parsed.env === 'object' && !Array.isArray(parsed.env)
            ? (parsed.env as Record<string, string>)
            : {};
        const {
          ANTHROPIC_BASE_URL: _baseUrl,
          ANTHROPIC_AUTH_TOKEN: _authToken,
          ANTHROPIC_MODEL: _model,
          ANTHROPIC_DEFAULT_OPUS_MODEL: _opus,
          ANTHROPIC_DEFAULT_SONNET_MODEL: _sonnet,
          ANTHROPIC_DEFAULT_HAIKU_MODEL: _haiku,
          ...extraEnv
        } = existingEnv;

        settings = {
          ...parsed,
          env: {
            ...extraEnv,
            ...coreEnv,
          },
        };
      }
    } catch {
      // Invalid JSON — overwrite with a clean settings object.
    }
  }

  ensureDir(settingsDir);
  writeSettings(settingsPath, settings);

  return settingsPath;
}

/**
 * Get relative settings path for a composite variant
 */
export function getCompositeRelativeSettingsPath(name: string): string {
  return `~/.ccs/composite-${name}.settings.json`;
}

/**
 * Delete settings file if it exists.
 * Uses expandPath() for cross-platform path handling.
 */
export function deleteSettingsFile(settingsPath: string): boolean {
  const resolvedPath = expandPath(settingsPath);
  if (fs.existsSync(resolvedPath)) {
    fs.unlinkSync(resolvedPath);
    return true;
  }
  return false;
}

/**
 * Update model in an existing settings file
 */
export function updateSettingsModel(
  settingsPath: string,
  model: string,
  provider?: CLIProxyProfileName,
  options?: {
    rewriteHaikuModel?: (model: string) => string;
  }
): void {
  const fileName = path.basename(settingsPath);
  if (fileName.startsWith('composite-')) {
    console.log(
      warn('Cannot update model for composite variant. Edit config.yaml tiers directly.')
    );
    return;
  }

  const resolvedPath = settingsPath.replace(/^~/, os.homedir());
  if (!fs.existsSync(resolvedPath)) {
    return;
  }

  try {
    const content = fs.readFileSync(resolvedPath, 'utf8');
    const settings = JSON.parse(content) as SettingsFile;

    if (model) {
      settings.env = settings.env || ({} as SettingsEnv);
      const normalizedModel = canonicalizeModelForProvider(provider, model);
      settings.env.ANTHROPIC_MODEL = normalizedModel;
      settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL = normalizedModel;
      settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL = normalizedModel;
      if (provider === 'codex' && settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL) {
        const normalizedHaikuModel = canonicalizeModelForProvider(
          provider,
          settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL
        );
        settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = options?.rewriteHaikuModel
          ? options.rewriteHaikuModel(normalizedHaikuModel)
          : normalizedHaikuModel;
      }
    } else {
      // Clear model settings to use defaults
      delete (settings.env as unknown as Record<string, string>).ANTHROPIC_MODEL;
    }

    const tempPath = `${resolvedPath}.tmp.${process.pid}`;
    fs.writeFileSync(tempPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    fs.renameSync(tempPath, resolvedPath);
  } catch {
    // Ignore errors - settings file may be invalid
  }
}

/**
 * Update provider + model core env vars in an existing single-provider settings file.
 * Preserves non-core env vars and top-level settings keys (hooks, presets, etc.).
 */
export function updateSettingsProviderAndModel(
  settingsPath: string,
  provider: CLIProxyProfileName,
  model: string,
  port: number = CLIPROXY_DEFAULT_PORT
): void {
  const resolvedPath = expandPath(settingsPath);
  const fileName = path.basename(resolvedPath);
  if (fileName.startsWith('composite-')) {
    console.log(
      warn('Cannot update provider/model for composite variant. Edit config.yaml tiers directly.')
    );
    return;
  }

  const coreEnv = buildSettingsEnv(provider, model, port);
  let settings: SettingsFile = { env: coreEnv };

  if (fs.existsSync(resolvedPath)) {
    try {
      const content = fs.readFileSync(resolvedPath, 'utf8');
      const parsed = JSON.parse(content) as SettingsFile;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const existingEnv =
          parsed.env && typeof parsed.env === 'object' && !Array.isArray(parsed.env)
            ? (parsed.env as Record<string, string>)
            : {};
        const {
          ANTHROPIC_BASE_URL: _baseUrl,
          ANTHROPIC_AUTH_TOKEN: _authToken,
          ANTHROPIC_MODEL: _model,
          ANTHROPIC_DEFAULT_OPUS_MODEL: _opus,
          ANTHROPIC_DEFAULT_SONNET_MODEL: _sonnet,
          ANTHROPIC_DEFAULT_HAIKU_MODEL: _haiku,
          ...extraEnv
        } = existingEnv;

        settings = {
          ...parsed,
          env: {
            ...extraEnv,
            ...coreEnv,
          },
        };
      }
    } catch {
      // Keep default and overwrite malformed file.
    }
  }

  ensureDir(path.dirname(resolvedPath));
  writeSettings(resolvedPath, settings);
}
