/**
 * Migration Manager
 *
 * Handles migration from legacy JSON config (v1) to unified YAML config (v2).
 * Features:
 * - Automatic backup before migration
 * - Rollback support
 * - Settings file reference preservation (*.settings.json)
 * - Cache file restructuring
 *
 * Design: Settings remain in *.settings.json files (matching Claude's pattern)
 * while config.yaml stores references to these files.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getCcsDir } from '../utils/config-manager';
import { expandPath } from '../utils/helpers';
import { resolveAliasToCanonical } from '../utils/profile-compat';
import type { ProfileConfig, AccountConfig, CLIProxyVariantConfig } from './unified-config-types';
import { createEmptyUnifiedConfig } from './unified-config-types';
import { CLIPROXY_PROVIDER_IDS } from '../cliproxy/provider-capabilities';
import { saveUnifiedConfig, hasUnifiedConfig, loadUnifiedConfig } from './unified-config-loader';
import { isValidContextGroupName, normalizeContextGroupName } from '../auth/account-context';
import { isSharedResourceMode, resolveSharedResourcePolicy } from '../auth/shared-resource-policy';
import { infoBox, warn } from '../utils/ui';

const BACKUP_DIR_PREFIX = 'backup-v1-';

function resolveCanonicalPath(targetPath: string): string {
  try {
    return fs.realpathSync.native(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function isPathWithinDirectory(candidatePath: string, rootPath: string): boolean {
  const normalizedCandidate = path.resolve(candidatePath);
  const normalizedRoot = path.resolve(rootPath);
  const relative = path.relative(normalizedRoot, normalizedCandidate);

  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveManagedBackupPath(backupPath: string): string | null {
  const resolvedInput = path.resolve(backupPath);
  const baseName = path.basename(resolvedInput);

  if (!baseName.startsWith(BACKUP_DIR_PREFIX)) {
    return null;
  }

  try {
    const stats = fs.lstatSync(resolvedInput);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      return null;
    }
  } catch {
    return null;
  }

  const canonicalCcsDir = resolveCanonicalPath(getCcsDir());
  const canonicalBackupPath = resolveCanonicalPath(resolvedInput);

  if (!isPathWithinDirectory(canonicalBackupPath, canonicalCcsDir)) {
    return null;
  }

  if (path.dirname(canonicalBackupPath) !== canonicalCcsDir) {
    return null;
  }

  return canonicalBackupPath;
}

/**
 * Migration result with details about what was migrated.
 */
export interface MigrationResult {
  success: boolean;
  backupPath?: string;
  error?: string;
  migratedFiles: string[];
  warnings: string[];
}

/**
 * Check if migration from v1 to v2 is needed.
 */
export function needsMigration(): boolean {
  const ccsDir = getCcsDir();
  const hasOldConfig = fs.existsSync(path.join(ccsDir, 'config.json'));
  const hasNewConfig = hasUnifiedConfig();

  return hasOldConfig && !hasNewConfig;
}

/**
 * Pre-loaded config data for TOCTOU-safe migration checks.
 * Read once, use for both check and migration.
 */
export interface MigrationCheckData {
  legacyConfig: Record<string, unknown> | null;
  unifiedConfig: ReturnType<typeof loadUnifiedConfig>;
  needsMigration: boolean;
}

/**
 * Load config files once for TOCTOU-safe migration operations.
 * Returns data that can be passed to migration functions.
 */
export function loadMigrationCheckData(): MigrationCheckData {
  const ccsDir = getCcsDir();
  const configJsonPath = path.join(ccsDir, 'config.json');

  const legacyConfig = fs.existsSync(configJsonPath) ? readJsonSafe(configJsonPath) : null;
  const unifiedConfig = loadUnifiedConfig();

  // Determine if migration is needed
  let needsMigration = false;

  if (legacyConfig?.profiles && typeof legacyConfig.profiles === 'object' && unifiedConfig) {
    const legacyProfiles = legacyConfig.profiles as Record<string, unknown>;
    const unifiedProfiles = unifiedConfig.profiles ?? {};
    for (const profileName of Object.keys(legacyProfiles)) {
      const targetProfileName = resolveAliasToCanonical(profileName);
      if (!unifiedProfiles[targetProfileName]) {
        needsMigration = true;
        break;
      }
    }
  }

  return { legacyConfig, unifiedConfig, needsMigration };
}

/**
 * Check if there are legacy profiles that haven't been migrated to config.yaml.
 * This catches the case where config.yaml exists but is empty/missing profiles
 * that are still in config.json.
 *
 * Used by autoMigrate() to trigger inline migration when needed.
 * (Fix for issue #195 - GLM auth persistence regression)
 *
 * Note: For TOCTOU-safe operations, use loadMigrationCheckData() instead.
 */
export function needsProfileMigration(): boolean {
  const data = loadMigrationCheckData();
  return data.needsMigration;
}

/**
 * Get list of backup directories.
 */
export function getBackupDirectories(): string[] {
  const ccsDir = getCcsDir();
  if (!fs.existsSync(ccsDir)) return [];

  return fs
    .readdirSync(ccsDir)
    .filter((name) => name.startsWith(BACKUP_DIR_PREFIX))
    .map((name) => path.join(ccsDir, name))
    .filter((backupPath) => resolveManagedBackupPath(backupPath) !== null)
    .sort()
    .reverse(); // Most recent first
}

/**
 * Perform migration from v1 to v2 format.
 */
export async function migrate(dryRun = false): Promise<MigrationResult> {
  const ccsDir = getCcsDir();
  const migratedFiles: string[] = [];
  const warnings: string[] = [];

  try {
    // 1. Create backup
    const timestamp = new Date().toISOString().split('T')[0];
    const backupDir = path.join(ccsDir, `${BACKUP_DIR_PREFIX}${timestamp}`);

    if (!dryRun) {
      await createBackup(ccsDir, backupDir);
    }

    // 2. Read old configs
    const oldConfig = readJsonSafe(path.join(ccsDir, 'config.json'));
    const oldProfiles = readJsonSafe(path.join(ccsDir, 'profiles.json'));

    // 3. Build unified config
    const unifiedConfig = createEmptyUnifiedConfig();

    // Set default if exists
    if (oldProfiles?.default && typeof oldProfiles.default === 'string') {
      unifiedConfig.default = oldProfiles.default;
    }

    // 4. Migrate accounts from profiles.json
    if (oldProfiles?.profiles) {
      for (const [name, meta] of Object.entries(oldProfiles.profiles)) {
        const metadata = meta as Record<string, unknown>;
        const rawContextMode = metadata.context_mode;
        const rawContextGroup = metadata.context_group;
        const rawContinuityMode = metadata.continuity_mode;
        const contextMode = rawContextMode === 'shared' ? 'shared' : 'isolated';
        const continuityMode =
          contextMode === 'shared' && rawContinuityMode === 'deeper' ? 'deeper' : 'standard';
        let contextGroup: string | undefined;
        if (typeof rawContextGroup === 'string' && rawContextGroup.trim().length > 0) {
          const normalizedGroup = normalizeContextGroupName(rawContextGroup);
          if (isValidContextGroupName(normalizedGroup)) {
            contextGroup = normalizedGroup;
          } else {
            warnings.push(
              `Skipped invalid context group for account "${name}": "${rawContextGroup}" (fallback to default shared group)`
            );
          }
        }
        const account: AccountConfig = {
          created: (metadata.created as string) || new Date().toISOString(),
          last_used: (metadata.last_used as string) || null,
          context_mode: contextMode,
          context_group: contextMode === 'shared' ? contextGroup : undefined,
          continuity_mode: contextMode === 'shared' ? continuityMode : undefined,
        };
        const resourcePolicy = resolveSharedResourcePolicy({
          shared_resource_mode: metadata.shared_resource_mode,
          bare: metadata.bare,
        });
        if (resourcePolicy.mode === 'profile-local') {
          account.shared_resource_mode = 'profile-local';
          account.bare = true;
        } else if (isSharedResourceMode(metadata.shared_resource_mode)) {
          account.shared_resource_mode = 'shared';
        }
        unifiedConfig.accounts[name] = account;
      }
      migratedFiles.push('profiles.json → config.yaml.accounts');
    }

    // 5. Migrate CLIProxy variants from config.json
    if (oldConfig?.cliproxy) {
      for (const [name, variantData] of Object.entries(oldConfig.cliproxy)) {
        const oldVariant = variantData as Record<string, unknown>;
        const variant: CLIProxyVariantConfig = {
          provider: oldVariant.provider as CLIProxyVariantConfig['provider'],
        };

        if (oldVariant.account) {
          variant.account = oldVariant.account as string;
        }

        // Keep reference to existing settings file
        if (oldVariant.settings) {
          variant.settings = oldVariant.settings as string;
        }

        unifiedConfig.cliproxy.variants[name] = variant;
      }
      migratedFiles.push('config.json.cliproxy → config.yaml.cliproxy.variants');
    }

    // 6. Migrate API profiles from config.json
    // Keep settings in *.settings.json files (matching Claude's ~/.claude/settings.json pattern)
    // config.yaml only stores reference to the settings file
    if (oldConfig?.profiles) {
      for (const [name, settingsPath] of Object.entries(oldConfig.profiles)) {
        const sourceName = name.trim();
        const targetName = resolveAliasToCanonical(sourceName);
        const pathStr = settingsPath as string;
        const expandedPath = expandPath(pathStr);

        const canonicalEntryValue = (oldConfig.profiles as Record<string, unknown>)[targetName];
        const canonicalPathFromLegacyConfig =
          sourceName !== targetName && typeof canonicalEntryValue === 'string'
            ? canonicalEntryValue
            : undefined;

        // Deterministic priority: explicit canonical profile wins over legacy alias rename.
        if (canonicalPathFromLegacyConfig !== undefined) {
          if (canonicalPathFromLegacyConfig !== pathStr) {
            warnings.push(
              `Skipped ${sourceName}: canonical profile "${targetName}" exists in config.json with different settings (${canonicalPathFromLegacyConfig})`
            );
          }
          continue;
        }

        // Verify settings file exists
        if (!fs.existsSync(expandedPath)) {
          warnings.push(`Skipped ${sourceName}: settings file not found at ${pathStr}`);
          continue;
        }

        if (unifiedConfig.profiles[targetName]) {
          const existing = unifiedConfig.profiles[targetName].settings;
          if (existing !== pathStr) {
            warnings.push(
              `Skipped ${sourceName}: target profile "${targetName}" already exists with different settings (${existing})`
            );
          }
          continue;
        }

        // Store reference to settings file (keep using ~ for portability)
        const profile: ProfileConfig = {
          type: 'api',
          settings: pathStr,
        };
        unifiedConfig.profiles[targetName] = profile;
        migratedFiles.push(
          `config.json.profiles.${sourceName} → config.yaml.profiles.${targetName} (settings: ${pathStr})`
        );
        if (targetName !== sourceName) {
          warnings.push(
            `Renamed legacy API profile "${sourceName}" to "${targetName}" (Kimi API profile is now km)`
          );
        }
      }
    }

    // 6b. Migrate built-in CLIProxy OAuth profile settings (gemini, codex, agy, qwen, iflow)
    // Keep settings in *.settings.json files - only record reference in config.yaml
    // This matches Claude's ~/.claude/settings.json pattern for user familiarity
    const builtInProviders = [...CLIPROXY_PROVIDER_IDS];
    for (const provider of builtInProviders) {
      const settingsFile = `${provider}.settings.json`;
      const settingsPath = path.join(ccsDir, settingsFile);

      if (fs.existsSync(settingsPath)) {
        // Create variant with reference to settings file
        const variant: CLIProxyVariantConfig = {
          provider: provider as CLIProxyVariantConfig['provider'],
          settings: `~/.ccs/${settingsFile}`,
        };

        unifiedConfig.cliproxy.variants[provider] = variant;
        migratedFiles.push(`${settingsFile} → config.yaml.cliproxy.variants.${provider}`);
      }
    }

    // 7. Write new config FIRST (before moving files - H8 fix)
    // Note: Settings remain in *.settings.json files, config.yaml only stores references
    if (!dryRun) {
      saveUnifiedConfig(unifiedConfig);
    }

    // 8. Migrate cache files AFTER config is saved (H8: prevents inconsistent state)
    if (!dryRun) {
      const cacheDir = path.join(ccsDir, 'cache');
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      if (moveIfExists(path.join(ccsDir, 'usage-cache.json'), path.join(cacheDir, 'usage.json'))) {
        migratedFiles.push('usage-cache.json → cache/usage.json');
      }

      if (
        moveIfExists(
          path.join(ccsDir, 'update-check.json'),
          path.join(cacheDir, 'update-check.json')
        )
      ) {
        migratedFiles.push('update-check.json → cache/update-check.json');
      }
    }

    return {
      success: true,
      backupPath: dryRun ? undefined : backupDir,
      migratedFiles,
      warnings,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      migratedFiles,
      warnings,
    };
  }
}

/**
 * Rollback migration by restoring from backup.
 */
export async function rollback(backupPath: string): Promise<boolean> {
  const ccsDir = getCcsDir();
  const managedBackupPath = resolveManagedBackupPath(backupPath);

  if (!managedBackupPath) {
    console.error(`[X] Invalid backup path: ${backupPath}`);
    return false;
  }

  try {
    // Remove new config files
    const configYaml = path.join(ccsDir, 'config.yaml');
    const cacheDir = path.join(ccsDir, 'cache');

    if (fs.existsSync(configYaml)) fs.unlinkSync(configYaml);

    // Restore cache files to original locations
    if (fs.existsSync(cacheDir)) {
      moveIfExists(path.join(cacheDir, 'usage.json'), path.join(ccsDir, 'usage-cache.json'));
      moveIfExists(
        path.join(cacheDir, 'update-check.json'),
        path.join(ccsDir, 'update-check.json')
      );

      // Remove cache dir if empty
      const remaining = fs.readdirSync(cacheDir);
      if (remaining.length === 0) {
        fs.rmdirSync(cacheDir);
      }
    }

    // Restore files from backup
    const files = fs.readdirSync(managedBackupPath);
    for (const file of files) {
      fs.copyFileSync(path.join(managedBackupPath, file), path.join(ccsDir, file));
    }

    return true;
  } catch (err) {
    console.error(`[X] Rollback failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    return false;
  }
}

// --- Helper Functions ---

/**
 * Read JSON file safely, returning null on error or if file doesn't exist.
 */
function readJsonSafe(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Move file if it exists. Returns true if moved, false if source didn't exist.
 */
function moveIfExists(from: string, to: string): boolean {
  if (fs.existsSync(from)) {
    fs.renameSync(from, to);
    return true;
  }
  return false;
}

/**
 * Create backup of all v1 config files.
 */
async function createBackup(srcDir: string, backupDir: string): Promise<void> {
  // Check if backup already exists (prevent overwriting)
  if (fs.existsSync(backupDir)) {
    // Add timestamp suffix to make unique
    const suffix = Date.now().toString(36);
    const uniqueBackupDir = `${backupDir}-${suffix}`;
    fs.mkdirSync(uniqueBackupDir, { recursive: true });
    await performBackup(srcDir, uniqueBackupDir);
    return;
  }

  fs.mkdirSync(backupDir, { recursive: true });
  await performBackup(srcDir, backupDir);
}

async function performBackup(srcDir: string, backupDir: string): Promise<void> {
  const filesToBackup = ['config.json', 'profiles.json', 'usage-cache.json', 'update-check.json'];

  // Also backup *.settings.json files
  const allFiles = fs.readdirSync(srcDir);
  const settingsFiles = allFiles.filter((f) => f.endsWith('.settings.json'));
  filesToBackup.push(...settingsFiles);

  for (const file of filesToBackup) {
    const src = path.join(srcDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(backupDir, file));
    }
  }
}

/**
 * Auto-migrate on first run after update.
 * Silent if already migrated or no config exists.
 * Shows friendly message with backup location on success.
 *
 * Also handles inline profile migration when config.yaml exists but is missing
 * profiles from config.json (Fix for issue #195).
 */
export async function autoMigrate(): Promise<void> {
  // Skip in test environment
  if (process.env.NODE_ENV === 'test' || process.env.CCS_SKIP_MIGRATION === '1') {
    return;
  }

  // Check if full migration is needed (no config.yaml exists)
  if (needsMigration()) {
    const result = await migrate(false);

    if (result.success) {
      console.log('');
      console.log(infoBox('Migrated to unified config (config.yaml)', 'SUCCESS'));
      console.log(`  Backup: ${result.backupPath}`);
      console.log(`  Items:  ${result.migratedFiles.length} migrated`);
      if (result.warnings.length > 0) {
        for (const warning of result.warnings) {
          console.log(warn(warning));
        }
      }
      console.log(`  Rollback: Roll back from the dashboard settings`);
      console.log('');
    } else {
      console.log('');
      console.log(infoBox('Migration failed - using legacy config', 'WARNING'));
      console.log(`  Error: ${result.error}`);
      console.log('  Retry: Migrate from the dashboard settings');
      console.log('');
    }
    return;
  }

  // Check if inline profile migration is needed (config.yaml exists but missing profiles)
  // CRIT-2: Load data once and pass to migrateProfilesToUnified to avoid TOCTOU race
  const migrationData = loadMigrationCheckData();
  if (migrationData.needsMigration) {
    const result = await migrateProfilesToUnified(migrationData);
    if (result.success && result.migratedFiles.length > 0) {
      console.log('');
      console.log(infoBox('Migrated legacy profiles to config.yaml', 'SUCCESS'));
      console.log(`  Profiles: ${result.migratedFiles.join(', ')}`);
      // H7: Show collision warnings if any
      if (result.warnings.length > 0) {
        for (const warning of result.warnings) {
          console.log(warn(warning));
        }
      }
      console.log('');
    }
  }
}

/**
 * Migrate only profiles from config.json to existing config.yaml.
 * Used when config.yaml exists but is missing profiles.
 *
 * @param preloadedData - Optional pre-loaded config data from loadMigrationCheckData()
 *                        for TOCTOU-safe operations. If not provided, reads configs fresh.
 */
async function migrateProfilesToUnified(
  preloadedData?: MigrationCheckData
): Promise<MigrationResult> {
  const ccsDir = getCcsDir();
  const migratedFiles: string[] = [];
  const warnings: string[] = [];

  try {
    // Use preloaded data if available (CRIT-2: TOCTOU fix)
    const oldConfig = preloadedData?.legacyConfig ?? readJsonSafe(path.join(ccsDir, 'config.json'));
    const unifiedConfig = preloadedData?.unifiedConfig ?? loadUnifiedConfig();

    if (!oldConfig?.profiles || !unifiedConfig) {
      return { success: true, migratedFiles, warnings };
    }

    let modified = false;

    // Migrate API profiles from config.json
    for (const [name, settingsPath] of Object.entries(oldConfig.profiles)) {
      const sourceName = name.trim();
      const targetName = resolveAliasToCanonical(sourceName);
      const pathStr = settingsPath as string;

      const canonicalEntryValue = (oldConfig.profiles as Record<string, unknown>)[targetName];
      const canonicalPathFromLegacyConfig =
        sourceName !== targetName && typeof canonicalEntryValue === 'string'
          ? canonicalEntryValue
          : undefined;

      // Deterministic priority: explicit canonical profile wins over legacy alias rename.
      if (canonicalPathFromLegacyConfig !== undefined) {
        if (canonicalPathFromLegacyConfig !== pathStr) {
          warnings.push(
            `Skipped ${sourceName}: canonical profile "${targetName}" exists in config.json with different settings (${canonicalPathFromLegacyConfig})`
          );
        }
        continue;
      }

      // H7: Detect collision - profile exists in both configs
      if (unifiedConfig.profiles[targetName]) {
        // Check if settings differ (potential data loss)
        const existingSettings = unifiedConfig.profiles[targetName].settings;
        if (existingSettings && existingSettings !== pathStr) {
          warnings.push(
            `Profile "${targetName}" exists in both configs with different settings - keeping existing (${existingSettings}), skipping legacy ${sourceName} (${pathStr})`
          );
        }
        continue;
      }

      const expandedPath = expandPath(pathStr);

      // Verify settings file exists
      if (!fs.existsSync(expandedPath)) {
        warnings.push(`Skipped ${sourceName}: settings file not found at ${pathStr}`);
        continue;
      }

      // Store reference to settings file
      unifiedConfig.profiles[targetName] = {
        type: 'api',
        settings: pathStr,
      };
      migratedFiles.push(targetName);
      if (targetName !== sourceName) {
        warnings.push(
          `Renamed legacy API profile "${sourceName}" to "${targetName}" (Kimi API profile is now km)`
        );
      }
      modified = true;
    }

    // Save if modified
    if (modified) {
      saveUnifiedConfig(unifiedConfig);
    }

    return { success: true, migratedFiles, warnings };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      migratedFiles,
      warnings,
    };
  }
}
