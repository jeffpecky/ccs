/**
 * Auto-recovery for missing or corrupted configuration
 * Lazy initialization: Creates ~/.ccs/ structure on first CLI run
 * Mirrors postinstall.js behavior for package managers that skip lifecycle scripts (e.g., bun)
 */

import * as fs from 'fs';
import * as path from 'path';
import { info } from '../utils/ui';
import { getCcsHome } from '../utils/config-manager';
import { createEmptyUnifiedConfig, UNIFIED_CONFIG_VERSION } from '../config/unified-config-types';
import {
  getCcsDir,
  hasUnifiedConfig,
  loadUnifiedConfig,
  saveConfig,
} from '../config/config-loader-facade';

/**
 * Recovery Manager Class
 */
class RecoveryManager {
  private readonly homedir: string;
  private readonly ccsDir: string;
  private readonly claudeDir: string;
  private readonly sharedDir: string;
  private readonly completionsDir: string;
  private recovered: string[];

  constructor() {
    this.homedir = getCcsHome();
    this.ccsDir = getCcsDir();
    this.claudeDir = path.join(this.homedir, '.claude');
    this.sharedDir = path.join(this.ccsDir, 'shared');
    this.completionsDir = path.join(this.ccsDir, 'completions');
    this.recovered = [];
  }

  /**
   * Ensure ~/.ccs/ directory exists
   */
  ensureCcsDirectory(): boolean {
    if (!fs.existsSync(this.ccsDir)) {
      fs.mkdirSync(this.ccsDir, { recursive: true, mode: 0o755 });
      this.recovered.push(`Created ${this.ccsDir} directory`);
      return true;
    }
    return false;
  }

  /**
   * Remove a dangling symlink so recovery can recreate the directory.
   * Mirrors scripts/postinstall.js behavior for skipped lifecycle installs.
   */
  private removeIfBrokenSymlink(targetPath: string): boolean {
    try {
      const stats = fs.lstatSync(targetPath);
      if (!stats.isSymbolicLink()) {
        return false;
      }

      try {
        fs.statSync(targetPath);
        return false;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT' && code !== 'ENOTDIR') {
          return false;
        }

        fs.unlinkSync(targetPath);
        this.recovered.push(`Removed broken symlink: ${targetPath}`);
        return true;
      }
    } catch {
      return false;
    }
  }

  private inspectDirectoryPath(
    targetPath: string
  ): { state: 'ready' } | { state: 'missing' } | { state: 'invalid'; reason: string } {
    try {
      const stats = fs.lstatSync(targetPath);

      if (stats.isSymbolicLink()) {
        try {
          return fs.statSync(targetPath).isDirectory()
            ? { state: 'ready' }
            : { state: 'invalid', reason: 'symlink target is not a directory' };
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          return code === 'ENOENT' || code === 'ENOTDIR'
            ? { state: 'missing' }
            : {
                state: 'invalid',
                reason: `symlink target is not accessible (${code || 'unknown'})`,
              };
        }
      }

      return stats.isDirectory()
        ? { state: 'ready' }
        : { state: 'invalid', reason: 'existing path is not a directory' };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === 'ENOENT'
        ? { state: 'missing' }
        : { state: 'invalid', reason: `could not inspect path (${code || 'unknown'})` };
    }
  }

  /**
   * Ensure ~/.ccs/config.yaml exists with defaults
   * This is the primary config format (YAML unified config)
   */
  ensureConfigYaml(): boolean {
    // Skip if config.yaml already exists AND is valid
    if (hasUnifiedConfig()) {
      // Verify it's loadable (not corrupted)
      const loaded = loadUnifiedConfig();
      if (loaded !== null) {
        return false; // Config exists and is valid
      }
      // Config exists but is corrupted - will be recreated below
      this.recovered.push(`Detected corrupted ${this.ccsDir}/config.yaml`);
    }

    // Check for legacy config.json - if exists, let autoMigrate handle it
    const legacyConfigPath = path.join(this.ccsDir, 'config.json');
    if (fs.existsSync(legacyConfigPath)) {
      // Legacy config exists - autoMigrate() in ccs.ts will handle migration
      return false;
    }

    // Create fresh config.yaml with defaults
    const config = createEmptyUnifiedConfig();
    config.version = UNIFIED_CONFIG_VERSION;

    try {
      saveConfig(config);
      this.recovered.push(`Created ${this.ccsDir}/config.yaml`);
      return true;
    } catch (_saveErr) {
      // Fallback: create minimal config.json for backward compat
      try {
        const fallbackConfig = { profiles: {} };
        const tmpPath = `${legacyConfigPath}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(fallbackConfig, null, 2) + '\n', 'utf8');
        fs.renameSync(tmpPath, legacyConfigPath);
        this.recovered.push(`Created ${this.ccsDir}/config.json (fallback)`);
        return true;
      } catch (_fallbackErr) {
        // Both writes failed - log but don't crash
        this.recovered.push('Failed to create config file (permission issue?)');
        return false;
      }
    }
  }

  /**
   * Ensure ~/.claude/settings.json exists
   */
  ensureClaudeSettings(): boolean {
    const claudeSettingsPath = path.join(this.claudeDir, 'settings.json');

    // Create ~/.claude/ if missing
    if (!fs.existsSync(this.claudeDir)) {
      fs.mkdirSync(this.claudeDir, { recursive: true, mode: 0o755 });
      this.recovered.push(`Created ${this.claudeDir} directory`);
    }

    // Create settings.json if missing
    if (!fs.existsSync(claudeSettingsPath)) {
      const tmpPath = `${claudeSettingsPath}.tmp`;
      fs.writeFileSync(tmpPath, '{}\n', 'utf8');
      fs.renameSync(tmpPath, claudeSettingsPath);

      this.recovered.push(`Created ${claudeSettingsPath}`);
      return true;
    }

    return false;
  }

  /**
   * Ensure ~/.ccs/shared/ directory structure exists
   */
  ensureSharedDirectories(): boolean {
    let created = false;

    this.removeIfBrokenSymlink(this.sharedDir);
    const sharedState = this.inspectDirectoryPath(this.sharedDir);

    // Create shared directory
    if (sharedState.state === 'missing') {
      fs.mkdirSync(this.sharedDir, { recursive: true, mode: 0o755 });
      this.recovered.push(`Created ${this.sharedDir}`);
      created = true;
    } else if (sharedState.state === 'invalid') {
      this.recovered.push(`Skipped ${this.sharedDir}: ${sharedState.reason}`);
      return created;
    }

    // Create subdirectories
    const subdirs = ['commands', 'skills', 'agents', 'plugins'];
    for (const subdir of subdirs) {
      const subdirPath = path.join(this.sharedDir, subdir);
      this.removeIfBrokenSymlink(subdirPath);
      const subdirState = this.inspectDirectoryPath(subdirPath);

      if (subdirState.state === 'missing') {
        fs.mkdirSync(subdirPath, { recursive: true, mode: 0o755 });
        created = true;
        continue;
      }

      if (subdirState.state === 'invalid') {
        this.recovered.push(`Skipped ${subdirPath}: ${subdirState.reason}`);
      }
    }

    return created;
  }

  /**
   * Install shell completion files
   */
  ensureShellCompletions(): boolean {
    // Find the scripts/completion directory relative to this module
    // In dist: dist/management/recovery-manager.js → scripts/completion
    // In src: src/management/recovery-manager.ts → scripts/completion
    const possiblePaths = [
      path.join(__dirname, '..', '..', 'scripts', 'completion'), // from dist/management/
      path.join(__dirname, '..', '..', '..', 'scripts', 'completion'), // alternative
    ];

    let scriptsCompletionDir: string | null = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        scriptsCompletionDir = p;
        break;
      }
    }

    if (!scriptsCompletionDir) {
      // Completion scripts not found - skip silently (may be installed differently)
      return false;
    }

    // Create completions directory
    if (!fs.existsSync(this.completionsDir)) {
      fs.mkdirSync(this.completionsDir, { recursive: true, mode: 0o755 });
    }

    const files = ['ccs.bash', 'ccs.zsh', 'ccs.fish', 'ccs.ps1'];
    let installed = false;

    for (const file of files) {
      const src = path.join(scriptsCompletionDir, file);
      const dest = path.join(this.completionsDir, file);

      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
        installed = true;
      }
    }

    if (installed) {
      this.recovered.push(`Installed shell completions to ${this.completionsDir}`);
    }

    return installed;
  }

  /**
   * Run all recovery operations (lazy initialization)
   * Mirrors postinstall.js behavior
   *
   * NOTE: GLM/Kimi profiles are NOT auto-created.
   * Users should create them via the dashboard settings or the UI.
   */
  recoverAll(): boolean {
    this.recovered = [];

    // Core directories
    this.ensureCcsDirectory();
    this.ensureSharedDirectories();
    this.ensureClaudeSettings();

    // Config files - use YAML as primary format
    this.ensureConfigYaml();

    // Shell completions
    this.ensureShellCompletions();

    return this.recovered.length > 0;
  }

  /**
   * Get recovery summary
   */
  getRecoverySummary(): string[] {
    return this.recovered;
  }

  /**
   * Show recovery hints
   */
  showRecoveryHints(): void {
    if (this.recovered.length === 0) return;

    console.log('');
    console.log(info('Auto-recovery completed:'));
    this.recovered.forEach((msg) => console.log(`    - ${msg}`));

    // Show login hint if created Claude settings
    if (this.recovered.some((msg) => msg.includes('settings.json') && msg.includes('.claude'))) {
      console.log('');
      console.log(info('Next step: Login to Claude CLI'));
      console.log('    Run: claude /login');
    }

    console.log('');
  }
}

export default RecoveryManager;
