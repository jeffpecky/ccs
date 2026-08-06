/**
 * Config Routes - Unified config management and migration
 */

import { Router, Request, Response } from 'express';
import * as fs from 'fs';

import {
  needsMigration,
  migrate,
  rollback,
  getBackupDirectories,
  resolveManagedBackupPath,
} from '../../config/migration-manager';
import type { UnifiedConfig } from '../../config/unified-config-types';
import { isUnifiedConfig } from '../../config/unified-config-types';
import {
  DEFAULT_ACCOUNT_CONTINUITY_MODE,
  isValidContextGroupName,
  normalizeContextGroupName,
} from '../../auth/account-context';
import { DEFAULT_CLIPROXY_SERVER_CONFIG } from '../../config/unified-config-types';
import { requireLocalAccessWhenAuthDisabled } from '../middleware/auth-middleware';
import { isSensitiveKey } from '../../utils/sensitive-keys';
import {
  getConfigFormat,
  getConfigYamlPath,
  hasUnifiedConfig,
  loadUnifiedConfig,
  mutateConfig,
} from '../../config/config-loader-facade';

const router = Router();
const LOCAL_CONFIG_ERROR =
  'Local configuration endpoints require localhost access when dashboard auth is disabled.';
const REDACTED_SECRET_VALUE = '[redacted]';
const RAW_YAML_REDACTED_PATHS = new Set([
  'cliproxy.auth.api_key',
  'cliproxy.auth.management_secret',
  'cliproxy_server.remote.auth_token',
  'cliproxy_server.remote.management_key',
  'dashboard_auth.password_hash',
]);

router.use((req: Request, res: Response, next) => {
  if (requireLocalAccessWhenAuthDisabled(req, res, LOCAL_CONFIG_ERROR)) {
    next();
  }
});

function redactSecretValue(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return value.length > 0 ? REDACTED_SECRET_VALUE : value;
}

function sanitizeUnifiedConfigForDashboard(config: UnifiedConfig): UnifiedConfig {
  return {
    ...config,
    global_env: config.global_env
      ? {
          ...config.global_env,
          env: Object.fromEntries(
            Object.entries(config.global_env.env).map(([key, value]) => [
              key,
              isSensitiveKey(key) && value ? REDACTED_SECRET_VALUE : value,
            ])
          ),
        }
      : config.global_env,
    cliproxy: {
      ...config.cliproxy,
      auth: sanitizeCliproxyAuthConfig(config.cliproxy.auth),
      variants: Object.fromEntries(
        Object.entries(config.cliproxy.variants).map(([variantName, variantConfig]) => [
          variantName,
          sanitizeCliproxyVariantAuth(variantConfig),
        ])
      ),
    },
    cliproxy_server: config.cliproxy_server
      ? {
          ...config.cliproxy_server,
          remote: {
            ...config.cliproxy_server.remote,
            auth_token: redactSecretValue(config.cliproxy_server.remote.auth_token) ?? '',
            management_key: redactSecretValue(config.cliproxy_server.remote.management_key),
          },
        }
      : config.cliproxy_server,
    dashboard_auth: config.dashboard_auth
      ? {
          ...config.dashboard_auth,
          password_hash: redactSecretValue(config.dashboard_auth.password_hash) ?? '',
        }
      : config.dashboard_auth,
  };
}

function sanitizeCliproxyAuthConfig(
  auth: UnifiedConfig['cliproxy']['auth']
): UnifiedConfig['cliproxy']['auth'] {
  if (!auth) {
    return auth;
  }

  return {
    ...auth,
    api_key: redactSecretValue(auth.api_key),
    management_secret: redactSecretValue(auth.management_secret),
  };
}

function sanitizeCliproxyVariantAuth(
  variantConfig: UnifiedConfig['cliproxy']['variants'][string]
): UnifiedConfig['cliproxy']['variants'][string] {
  return {
    ...variantConfig,
    auth: sanitizeCliproxyAuthConfig(variantConfig.auth),
  };
}

function normalizeYamlKey(rawKey: string): string {
  const key = rawKey.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    return key.slice(1, -1);
  }
  return key;
}

function splitYamlScalarAndComment(valuePortion: string): {
  value: string;
  comment: string;
} {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < valuePortion.length; index += 1) {
    const char = valuePortion[index];

    if (char === "'" && !inDoubleQuote) {
      if (inSingleQuote && valuePortion[index + 1] === "'") {
        index += 1;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote && valuePortion[index - 1] !== '\\') {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (
      char === '#' &&
      !inSingleQuote &&
      !inDoubleQuote &&
      (index === 0 || /\s/.test(valuePortion[index - 1]))
    ) {
      const prefix = valuePortion.slice(0, index);
      const spacing = prefix.match(/\s*$/)?.[0] ?? '';
      return {
        value: prefix.trimEnd(),
        comment: `${spacing}${valuePortion.slice(index)}`,
      };
    }
  }

  return {
    value: valuePortion.trimEnd(),
    comment: '',
  };
}

function redactYamlScalarLine(line: string): string {
  const match = line.match(/^(\s*[^:#][^:]*:\s*)(.*)$/);
  if (!match) {
    return line;
  }

  const [, prefix, rawTail] = match;
  const leadingSpacing = rawTail.match(/^\s*/)?.[0] ?? '';
  const { value, comment } = splitYamlScalarAndComment(rawTail.slice(leadingSpacing.length));
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0 || trimmedValue === '""' || trimmedValue === "''") {
    return line;
  }

  const quote =
    trimmedValue.startsWith('"') && trimmedValue.endsWith('"')
      ? '"'
      : trimmedValue.startsWith("'") && trimmedValue.endsWith("'")
        ? "'"
        : '';
  const redactedValue = quote ? `${quote}${REDACTED_SECRET_VALUE}${quote}` : REDACTED_SECRET_VALUE;

  return `${prefix}${leadingSpacing}${redactedValue}${comment}`;
}

function isYamlBlockScalarIndicator(value: string): boolean {
  const trimmedValue = value.trim();
  if (!(trimmedValue.startsWith('|') || trimmedValue.startsWith('>'))) {
    return false;
  }

  const indicators = trimmedValue.slice(1);
  if (indicators.length === 0) {
    return true;
  }

  if (indicators.length > 2) {
    return false;
  }

  let sawChompingIndicator = false;
  let sawIndentIndicator = false;

  for (const indicator of indicators) {
    if ((indicator === '+' || indicator === '-') && !sawChompingIndicator) {
      sawChompingIndicator = true;
      continue;
    }

    if (/[1-9]/.test(indicator) && !sawIndentIndicator) {
      sawIndentIndicator = true;
      continue;
    }

    return false;
  }

  return true;
}

function shouldRedactRawYamlPath(pathKeys: string[]): boolean {
  if (
    pathKeys.length === 3 &&
    pathKeys[0] === 'global_env' &&
    pathKeys[1] === 'env' &&
    isSensitiveKey(pathKeys[2])
  ) {
    return true;
  }

  if (
    pathKeys.length === 3 &&
    pathKeys[0] === 'cliproxy' &&
    pathKeys[1] === 'auth' &&
    (pathKeys[2] === 'api_key' || pathKeys[2] === 'management_secret')
  ) {
    return true;
  }

  if (
    pathKeys.length === 5 &&
    pathKeys[0] === 'cliproxy' &&
    pathKeys[1] === 'variants' &&
    pathKeys[3] === 'auth' &&
    (pathKeys[4] === 'api_key' || pathKeys[4] === 'management_secret')
  ) {
    return true;
  }

  return RAW_YAML_REDACTED_PATHS.has(pathKeys.join('.'));
}

function redactRawConfigYamlForDashboard(content: string): string {
  const stack: Array<{ indent: number; key: string }> = [];
  const redactedLines: string[] = [];
  const lines = content.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const mappingMatch = line.match(/^(\s*)([^:#][^:]*):(.*)$/);
    if (!mappingMatch) {
      redactedLines.push(line);
      continue;
    }

    const [, indentText, rawKey, rawTail] = mappingMatch;
    if (rawKey.trimStart().startsWith('-')) {
      redactedLines.push(line);
      continue;
    }

    const indent = indentText.length;
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    stack.push({ indent, key: normalizeYamlKey(rawKey) });
    const currentPath = stack.map((entry) => entry.key);

    if (!shouldRedactRawYamlPath(currentPath)) {
      redactedLines.push(line);
      continue;
    }

    const redactedLine = redactYamlScalarLine(line);
    redactedLines.push(redactedLine);

    const leadingSpacing = rawTail.match(/^\s*/)?.[0] ?? '';
    const { value } = splitYamlScalarAndComment(rawTail.slice(leadingSpacing.length));
    const trimmedValue = value.trim();

    if (!isYamlBlockScalarIndicator(trimmedValue)) {
      continue;
    }

    while (index + 1 < lines.length) {
      const nextLine = lines[index + 1];
      if (nextLine.trim().length === 0) {
        index += 1;
        continue;
      }

      const nextIndent = nextLine.match(/^\s*/)?.[0].length ?? 0;
      if (nextIndent <= indent) {
        break;
      }

      index += 1;
    }
  }

  return redactedLines.join('\n');
}

function restoreRedactedSecretValue(
  currentValue: string | undefined,
  nextValue: string | undefined
): string | undefined {
  if (nextValue === undefined || nextValue === REDACTED_SECRET_VALUE) {
    return currentValue;
  }

  return nextValue;
}

function mergeGlobalEnvConfig(
  currentConfig: UnifiedConfig,
  nextConfig: Partial<UnifiedConfig>
): UnifiedConfig['global_env'] {
  const nextGlobalEnv = nextConfig.global_env;
  if (!nextGlobalEnv) {
    return currentConfig.global_env;
  }

  const currentEnv = currentConfig.global_env?.env ?? {};
  const nextEnv = nextGlobalEnv.env;

  return {
    enabled: nextGlobalEnv.enabled ?? currentConfig.global_env?.enabled ?? true,
    env:
      nextEnv === undefined
        ? currentEnv
        : Object.fromEntries(
            Object.entries(nextEnv).map(([key, value]) => {
              if (value === REDACTED_SECRET_VALUE && isSensitiveKey(key)) {
                return [key, currentEnv[key] ?? value];
              }
              return [key, value];
            })
          ),
  };
}

function mergeCliproxyServerConfig(
  currentConfig: UnifiedConfig,
  nextConfig: Partial<UnifiedConfig>
): UnifiedConfig['cliproxy_server'] {
  const nextServer = nextConfig.cliproxy_server;
  if (!nextServer) {
    return currentConfig.cliproxy_server;
  }

  const nextRemote = nextServer.remote;
  const currentServer = currentConfig.cliproxy_server ?? DEFAULT_CLIPROXY_SERVER_CONFIG;

  return {
    remote:
      nextRemote === undefined
        ? currentServer.remote
        : {
            ...nextRemote,
            auth_token:
              restoreRedactedSecretValue(currentServer.remote.auth_token, nextRemote.auth_token) ??
              '',
            management_key: restoreRedactedSecretValue(
              currentServer.remote.management_key,
              nextRemote.management_key
            ),
          },
    fallback: nextServer.fallback ?? currentServer.fallback,
    local: nextServer.local ?? currentServer.local,
  };
}

function mergeDashboardAuthConfig(
  currentConfig: UnifiedConfig,
  nextConfig: Partial<UnifiedConfig>
): UnifiedConfig['dashboard_auth'] {
  const nextAuth = nextConfig.dashboard_auth;
  if (!nextAuth) {
    return currentConfig.dashboard_auth;
  }

  return {
    ...nextAuth,
    password_hash:
      restoreRedactedSecretValue(
        currentConfig.dashboard_auth?.password_hash,
        nextAuth.password_hash
      ) ?? '',
  };
}

function mergeCliproxyAuthField(
  currentValue: string | undefined,
  nextAuth: NonNullable<UnifiedConfig['cliproxy']['auth']>,
  key: 'api_key' | 'management_secret'
): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(nextAuth, key)) {
    return undefined;
  }

  return restoreRedactedSecretValue(currentValue, nextAuth[key]);
}

function mergeCliproxyAuthConfig(
  currentAuth: UnifiedConfig['cliproxy']['auth'],
  nextAuth: UnifiedConfig['cliproxy']['auth']
): UnifiedConfig['cliproxy']['auth'] {
  if (!nextAuth) {
    return currentAuth;
  }

  const mergedAuth = { ...nextAuth };
  const apiKey = mergeCliproxyAuthField(currentAuth?.api_key, nextAuth, 'api_key');
  const managementSecret = mergeCliproxyAuthField(
    currentAuth?.management_secret,
    nextAuth,
    'management_secret'
  );

  if (apiKey === undefined) {
    delete mergedAuth.api_key;
  } else {
    mergedAuth.api_key = apiKey;
  }

  if (managementSecret === undefined) {
    delete mergedAuth.management_secret;
  } else {
    mergedAuth.management_secret = managementSecret;
  }

  return Object.keys(mergedAuth).length > 0 ? mergedAuth : undefined;
}

function mergeCliproxyVariantConfig(
  currentVariant: UnifiedConfig['cliproxy']['variants'][string] | undefined,
  nextVariant: UnifiedConfig['cliproxy']['variants'][string]
): UnifiedConfig['cliproxy']['variants'][string] {
  const mergedVariant = { ...nextVariant };
  const mergedAuth = mergeCliproxyAuthConfig(currentVariant?.auth, nextVariant.auth);

  if (mergedAuth === undefined) {
    delete mergedVariant.auth;
  } else {
    mergedVariant.auth = mergedAuth;
  }

  return mergedVariant;
}

function mergeCliproxyConfig(
  currentConfig: UnifiedConfig,
  nextConfig: Partial<UnifiedConfig>
): UnifiedConfig['cliproxy'] {
  const nextCliproxy = nextConfig.cliproxy;
  if (!nextCliproxy) {
    return currentConfig.cliproxy;
  }

  const mergedCliproxy = {
    ...nextCliproxy,
    variants:
      nextCliproxy.variants === undefined
        ? currentConfig.cliproxy.variants
        : Object.fromEntries(
            Object.entries(nextCliproxy.variants).map(([variantName, nextVariant]) => [
              variantName,
              mergeCliproxyVariantConfig(currentConfig.cliproxy.variants[variantName], nextVariant),
            ])
          ),
  };
  const mergedAuth = mergeCliproxyAuthConfig(currentConfig.cliproxy.auth, nextCliproxy.auth);

  if (mergedAuth === undefined) {
    delete mergedCliproxy.auth;
  } else {
    mergedCliproxy.auth = mergedAuth;
  }

  return mergedCliproxy;
}

function validateAndNormalizeAccountContextMetadata(config: unknown): string | null {
  if (typeof config !== 'object' || config === null) {
    return 'Invalid config payload';
  }

  const candidate = config as Record<string, unknown>;
  const accounts = candidate.accounts;
  if (accounts === undefined) {
    return null;
  }

  if (typeof accounts !== 'object' || accounts === null || Array.isArray(accounts)) {
    return 'Invalid config.accounts: expected object';
  }

  for (const [accountName, accountValue] of Object.entries(accounts as Record<string, unknown>)) {
    if (typeof accountValue !== 'object' || accountValue === null || Array.isArray(accountValue)) {
      return `Invalid config.accounts.${accountName}: expected object`;
    }

    const account = accountValue as Record<string, unknown>;
    const mode = account.context_mode;
    const group = account.context_group;
    const continuity = account.continuity_mode;

    if (mode !== undefined && mode !== 'isolated' && mode !== 'shared') {
      return `Invalid config.accounts.${accountName}.context_mode: expected isolated|shared`;
    }

    if (group !== undefined && typeof group !== 'string') {
      return `Invalid config.accounts.${accountName}.context_group: expected string`;
    }

    if (continuity !== undefined && continuity !== 'standard' && continuity !== 'deeper') {
      return `Invalid config.accounts.${accountName}.continuity_mode: expected standard|deeper`;
    }

    if (mode !== 'shared' && group !== undefined) {
      return `Invalid config.accounts.${accountName}: context_group requires context_mode=shared`;
    }

    if (mode !== 'shared' && continuity !== undefined) {
      return `Invalid config.accounts.${accountName}: continuity_mode requires context_mode=shared`;
    }

    if (mode === 'shared' && typeof group === 'string' && group.trim().length > 0) {
      const normalizedGroup = normalizeContextGroupName(group);
      if (!isValidContextGroupName(normalizedGroup)) {
        return `Invalid config.accounts.${accountName}.context_group`;
      }
      account.context_group = normalizedGroup;
    }

    if (mode === 'shared') {
      account.continuity_mode =
        continuity === 'deeper' ? 'deeper' : DEFAULT_ACCOUNT_CONTINUITY_MODE;
    }

    if (mode === 'shared' && typeof group === 'string' && group.trim().length === 0) {
      return `Invalid config.accounts.${accountName}.context_group: shared mode requires a non-empty value`;
    }

    if (mode === 'isolated' && group !== undefined) {
      delete account.context_group;
    }

    if (mode === 'isolated' && continuity !== undefined) {
      delete account.continuity_mode;
    }
  }

  return null;
}

/**
 * GET /api/config/format - Return current config format and migration status
 */
router.get('/format', (_req: Request, res: Response): void => {
  try {
    res.json({
      format: getConfigFormat(),
      migrationNeeded: needsMigration(),
      backups: getBackupDirectories(),
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/config - Return unified config (excludes secrets)
 */
router.get('/', (_req: Request, res: Response): void => {
  if (!hasUnifiedConfig()) {
    res.status(400).json({ error: 'Unified config not enabled' });
    return;
  }

  const config = loadUnifiedConfig();
  if (!config) {
    res.status(500).json({ error: 'Failed to load config' });
    return;
  }

  res.json(sanitizeUnifiedConfigForDashboard(config));
});

/**
 * GET /api/config/raw - Return raw YAML content for display
 */
router.get('/raw', (_req: Request, res: Response): void => {
  const yamlPath = getConfigYamlPath();
  if (!fs.existsSync(yamlPath)) {
    res.status(404).json({ error: 'Config file not found' });
    return;
  }

  try {
    const content = fs.readFileSync(yamlPath, 'utf8');
    res.type('text/plain').send(redactRawConfigYamlForDashboard(content));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * PUT /api/config - Update unified config
 */
router.put('/', (req: Request, res: Response): void => {
  const config = req.body as Partial<UnifiedConfig>;

  if (!isUnifiedConfig(config)) {
    res.status(400).json({ error: 'Invalid config format' });
    return;
  }

  const accountContextError = validateAndNormalizeAccountContextMetadata(config);
  if (accountContextError) {
    res.status(400).json({ error: accountContextError });
    return;
  }

  try {
    mutateConfig((currentConfig) => {
      if ('setup_completed' in config) {
        currentConfig.setup_completed = config.setup_completed;
      }

      if ('default' in config) {
        currentConfig.default = config.default;
      }

      if (config.accounts !== undefined) {
        currentConfig.accounts = config.accounts;
      }

      if (config.profiles !== undefined) {
        currentConfig.profiles = config.profiles;
      }

      if (config.cliproxy !== undefined) {
        currentConfig.cliproxy = mergeCliproxyConfig(currentConfig, config);
      }

      if (config.proxy !== undefined) {
        currentConfig.proxy = config.proxy;
      }

      if (config.preferences !== undefined) {
        currentConfig.preferences = config.preferences;
      }

      if (config.continuity !== undefined) {
        currentConfig.continuity = config.continuity;
      }

      if (config.copilot !== undefined) {
        currentConfig.copilot = config.copilot;
      }

      if (config.cursor !== undefined) {
        currentConfig.cursor = config.cursor;
      }

      if (config.quota_management !== undefined) {
        currentConfig.quota_management = config.quota_management;
      }

      if (config.thinking !== undefined) {
        currentConfig.thinking = config.thinking;
      }

      if (config.global_env !== undefined) {
        currentConfig.global_env = mergeGlobalEnvConfig(currentConfig, config);
      }

      if (config.cliproxy_server !== undefined) {
        currentConfig.cliproxy_server = mergeCliproxyServerConfig(currentConfig, config);
      }

      if (config.dashboard_auth !== undefined) {
        currentConfig.dashboard_auth = mergeDashboardAuthConfig(currentConfig, config);
      }
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/config/migrate - Trigger migration from JSON to YAML
 */
router.post('/migrate', async (req: Request, res: Response): Promise<void> => {
  try {
    const dryRun = req.query.dryRun === 'true';
    if (!needsMigration()) {
      res.json({
        success: true,
        migratedFiles: [],
        warnings: [],
        alreadyMigrated: true,
      });
      return;
    }
    const result = await migrate(dryRun);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /api/config/rollback - Rollback migration to JSON format
 */
router.post('/rollback', async (req: Request, res: Response): Promise<void> => {
  try {
    const { backupPath } = req.body;

    if (!backupPath || typeof backupPath !== 'string') {
      res.status(400).json({ error: 'Missing required field: backupPath' });
      return;
    }

    const managedBackupPath = resolveManagedBackupPath(backupPath);
    if (!managedBackupPath) {
      res.status(400).json({
        error: 'Invalid backupPath. Must reference a managed CCS migration backup directory.',
      });
      return;
    }

    const success = await rollback(managedBackupPath);
    res.json({ success });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
