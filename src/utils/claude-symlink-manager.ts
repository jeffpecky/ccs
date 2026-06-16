/**
 * ClaudeSymlinkManager - Manages selective symlinks from ~/.ccs/.claude/ to ~/.claude/
 * v4.1.0: Selective symlinking for CCS items
 *
 * Purpose: Ship CCS items (.claude/) with package and symlink them to user's ~/.claude/
 * Architecture:
 *   - ~/.ccs/.claude/* (source, ships with CCS)
 *   - ~/.claude/* (target, gets selective symlinks)
 *   - ~/.ccs/shared/ (UNTOUCHED, existing profile mechanism)
 *
 * Symlink Chain:
 *   profile -> ~/.ccs/shared/ -> ~/.claude/ (which has symlinks to ~/.ccs/.claude/)
 */

import * as fs from 'fs';
import * as path from 'path';
import { ok, fail, warn, info, color } from './ui';
import { getCcsDir, getCcsHome } from './config-manager';

// Ora fallback type for when ora is not available
interface OraSpinner {
  text: string;
  succeed: (msg?: string) => void;
  fail: (msg?: string) => void;
  warn: (msg?: string) => void;
  info: (msg?: string) => void;
}

interface OraInstance {
  start: () => OraSpinner;
}

// Make ora optional (might not be available during npm install postinstall)
let ora: ((text: string) => OraInstance) | null = null;
try {
  const oraModule = require('ora');
  ora = oraModule.default || oraModule;
} catch {
  // ora not available, create fallback spinner that uses console.log with UI colors
  ora = function (text: string): OraInstance {
    return {
      start: () => ({
        succeed: (msg?: string) => console.log(msg || ok(text)),
        fail: (msg?: string) => console.log(msg || fail(text)),
        warn: (msg?: string) => console.log(msg || warn(text)),
        info: (msg?: string) => console.log(msg || info(text)),
        text: '',
      }),
    };
  };
}

interface CcsItem {
  source: string;
  target: string;
  type: 'file' | 'directory';
}

interface HealthCheckResult {
  healthy: boolean;
  issues: string[];
}

/**
 * ClaudeSymlinkManager - Manages selective symlinks from ~/.ccs/.claude/ to ~/.claude/
 */
export class ClaudeSymlinkManager {
  private homeDir: string;
  private ccsClaudeDir: string;
  private userClaudeDir: string;
  private ccsItems: CcsItem[];

  constructor() {
    // Use getCcsHome() for test isolation - respects CCS_HOME env var
    this.homeDir = getCcsHome();
    this.ccsClaudeDir = path.join(getCcsDir(), '.claude');
    this.userClaudeDir = path.join(this.homeDir, '.claude');

    // CCS items to symlink (selective, item-level)
    this.ccsItems = [
      { source: 'commands/ccs.md', target: 'commands/ccs.md', type: 'file' },
      { source: 'commands/ccs', target: 'commands/ccs', type: 'directory' },
      { source: 'skills/ccs-delegation', target: 'skills/ccs-delegation', type: 'directory' },
    ];
  }

  /**
   * Install CCS items to user's ~/.claude/ via selective symlinks
   * Safe: backs up existing files before creating symlinks
   */
  install(silent = false): void {
    const spinner = silent || !ora ? null : ora('Installing CCS items to ~/.claude/').start();

    // Ensure ~/.ccs/.claude/ exists (should be shipped with package)
    if (!fs.existsSync(this.ccsClaudeDir)) {
      const msg = 'CCS .claude/ directory not found, skipping symlink installation';
      if (spinner) {
        spinner.warn(warn(msg));
      } else {
        console.log(warn(msg));
      }
      return;
    }

    // Create ~/.claude/ if missing
    if (!fs.existsSync(this.userClaudeDir)) {
      if (!silent) {
        if (spinner) spinner.text = 'Creating ~/.claude/ directory';
      }
      fs.mkdirSync(this.userClaudeDir, { recursive: true, mode: 0o700 });
    }

    // Install each CCS item
    let installed = 0;
    for (const item of this.ccsItems) {
      if (!silent && spinner) {
        spinner.text = `Installing ${item.target}...`;
      }
      const result = this.installItem(item, silent);
      if (result) installed++;
    }

    const msg = `${installed}/${this.ccsItems.length} items installed to ~/.claude/`;
    if (spinner) {
      spinner.succeed(ok(msg));
    } else {
      console.log(ok(msg));
    }
  }

  /**
   * Install a single CCS item with conflict handling
   */
  private installItem(item: CcsItem, silent = false): boolean {
    const sourcePath = path.join(this.ccsClaudeDir, item.source);
    const targetPath = path.join(this.userClaudeDir, item.target);
    const targetDir = path.dirname(targetPath);

    // Ensure source exists
    if (!fs.existsSync(sourcePath)) {
      if (!silent) console.log(warn(`Source not found: ${item.source}, skipping`));
      return false;
    }

    // Create target parent directory if needed
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
    }

    // Check if target already exists
    if (fs.existsSync(targetPath)) {
      // Check if it's already the correct symlink
      if (this.isOurSymlink(targetPath, sourcePath)) {
        return true; // Already correct, counts as success
      }

      // On Windows, check if it's a valid copy (symlink fallback from previous sync)
      // This prevents creating duplicate backups on every sync
      if (process.platform === 'win32' && this.isCopiedItem(targetPath, sourcePath, item.type)) {
        // Remove existing copy and refresh with latest source content
        try {
          if (item.type === 'directory') {
            fs.rmSync(targetPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(targetPath);
          }
        } catch {
          // If removal fails, proceed to copy which will overwrite
        }
        return this.copyFallback(sourcePath, targetPath, item, silent);
      }

      // Backup existing file/directory (only for non-CCS items)
      this.backupItem(targetPath, silent);
    }

    // Create symlink
    try {
      const symlinkType = item.type === 'directory' ? 'dir' : 'file';
      fs.symlinkSync(sourcePath, targetPath, symlinkType);
      if (!silent) console.log(ok(`Symlinked ${item.target}`));
      return true;
    } catch (err) {
      // Windows fallback: copy instead of symlink when symlinks unavailable
      if (process.platform === 'win32') {
        return this.copyFallback(sourcePath, targetPath, item, silent);
      } else {
        const error = err as Error;
        if (!silent) console.log(warn(`Failed to symlink ${item.target}: ${error.message}`));
      }
      return false;
    }
  }

  /**
   * Windows fallback: copy files/directories when symlinks unavailable
   * Note: Changes won't auto-sync; user must sync from the dashboard settings after updates
   */
  private copyFallback(
    sourcePath: string,
    targetPath: string,
    item: CcsItem,
    silent = false
  ): boolean {
    try {
      if (item.type === 'directory') {
        // Copy directory recursively
        this.copyDirRecursive(sourcePath, targetPath);
      } else {
        // Copy single file
        fs.copyFileSync(sourcePath, targetPath);
      }
      if (!silent) {
        console.log(ok(`Copied ${item.target} (symlink unavailable)`));
        console.log(info("Sync from the dashboard settings after CCS updates to refresh"));
      }
      return true;
    } catch (copyErr) {
      const error = copyErr as Error;
      if (!silent) {
        console.log(warn(`Failed to copy ${item.target}: ${error.message}`));
        console.log(info('Enable Developer Mode for symlinks, or check permissions'));
      }
      return false;
    }
  }

  /**
   * Recursively copy directory (for Windows fallback)
   */
  private copyDirRecursive(src: string, dest: string): void {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.copyDirRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * Check if target is already the correct symlink pointing to source
   */
  private isOurSymlink(targetPath: string, expectedSource: string): boolean {
    try {
      const stats = fs.lstatSync(targetPath);

      if (!stats.isSymbolicLink()) {
        return false;
      }

      const actualTarget = fs.readlinkSync(targetPath);
      const resolvedTarget = path.resolve(path.dirname(targetPath), actualTarget);

      return resolvedTarget === expectedSource;
    } catch {
      return false;
    }
  }

  /**
   * Backup existing item before replacing with symlink
   */
  private backupItem(itemPath: string, silent = false): void {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const backupPath = `${itemPath}.backup-${timestamp}`;

    try {
      // If backup already exists, use counter
      let finalBackupPath = backupPath;
      let counter = 1;
      while (fs.existsSync(finalBackupPath)) {
        finalBackupPath = `${backupPath}-${counter}`;
        counter++;
      }

      fs.renameSync(itemPath, finalBackupPath);
      if (!silent)
        console.log(info(`Backed up existing item to ${path.basename(finalBackupPath)}`));
    } catch (err) {
      const error = err as Error;
      if (!silent) console.log(warn(`Failed to backup ${itemPath}: ${error.message}`));
      throw err; // Don't proceed if backup fails
    }
  }

  /**
   * Uninstall CCS items from ~/.claude/ (remove symlinks or copied files)
   * Safe: only removes items that are CCS symlinks or valid copies
   * @returns number of items removed
   */
  uninstall(): number {
    let removed = 0;

    for (const item of this.ccsItems) {
      const targetPath = path.join(this.userClaudeDir, item.target);
      const sourcePath = path.join(this.ccsClaudeDir, item.source);

      // Check if it's our symlink or a valid copy (Windows fallback)
      const isSymlink = this.isOurSymlink(targetPath, sourcePath);
      const isCopy =
        process.platform === 'win32' && this.isCopiedItem(targetPath, sourcePath, item.type);

      if (fs.existsSync(targetPath) && (isSymlink || isCopy)) {
        try {
          if (item.type === 'directory' && !isSymlink) {
            // Remove copied directory recursively
            fs.rmSync(targetPath, { recursive: true, force: true });
          } else {
            // Remove symlink or file
            fs.unlinkSync(targetPath);
          }
          console.log(ok(`Removed ${item.target}`));
          removed++;
        } catch (err) {
          const error = err as Error;
          console.log(warn(`Failed to remove ${item.target}: ${error.message}`));
        }
      }
    }

    if (removed > 0) {
      console.log(ok(`Removed ${removed} delegation commands and skills from ~/.claude/`));
    } else {
      console.log(info('No delegation commands or skills to remove'));
    }

    return removed;
  }

  /**
   * Check symlink health and report issues
   * Used by dashboard diagnostics
   */
  checkHealth(): HealthCheckResult {
    const issues: string[] = [];
    let healthy = true;

    // Check if ~/.ccs/.claude/ exists
    if (!fs.existsSync(this.ccsClaudeDir)) {
      issues.push('CCS .claude/ directory missing (reinstall CCS)');
      healthy = false;
      return { healthy, issues };
    }

    // Check each item
    for (const item of this.ccsItems) {
      const sourcePath = path.join(this.ccsClaudeDir, item.source);
      const targetPath = path.join(this.userClaudeDir, item.target);

      // Check source exists
      if (!fs.existsSync(sourcePath)) {
        issues.push(`Source missing: ${item.source}`);
        healthy = false;
        continue;
      }

      // Check target
      if (!fs.existsSync(targetPath)) {
        issues.push(`Not installed: ${item.target} (sync from the dashboard settings to install)`);
        healthy = false;
      } else if (!this.isOurSymlink(targetPath, sourcePath)) {
        // On Windows, copied files are valid (symlink fallback)
        if (process.platform === 'win32' && this.isCopiedItem(targetPath, sourcePath, item.type)) {
          // Copied file is valid on Windows, but note it's not a symlink
          issues.push(`${item.target} is a copy (not symlink) - sync from the dashboard settings after updates`);
          // Still healthy, just a warning
        } else {
          issues.push(`Not a CCS symlink: ${item.target} (sync from the dashboard settings to fix)`);
          healthy = false;
        }
      }
    }

    return { healthy, issues };
  }

  /**
   * Check if target is a valid copy of source (Windows fallback check)
   */
  private isCopiedItem(
    targetPath: string,
    sourcePath: string,
    type: 'file' | 'directory'
  ): boolean {
    try {
      const targetStats = fs.statSync(targetPath);
      const sourceStats = fs.statSync(sourcePath);

      if (type === 'directory') {
        // For directories, just check both exist and are directories
        return targetStats.isDirectory() && sourceStats.isDirectory();
      } else {
        // For files, compare size as basic validation
        return (
          targetStats.isFile() && sourceStats.isFile() && targetStats.size === sourceStats.size
        );
      }
    } catch {
      return false;
    }
  }

  /**
   * Sync delegation commands and skills to ~/.claude/ (used by dashboard sync)
   * Same as install() but with explicit sync message
   */
  sync(): void {
    console.log('');
    console.log(color('Syncing CCS Components...', 'info'));
    console.log('');
    this.install(false);
  }
}

export default ClaudeSymlinkManager;
