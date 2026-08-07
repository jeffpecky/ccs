/**
 * Persist Routes - Backup management for ~/.claude/settings.json
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import * as fs from 'fs';
import * as path from 'path';
import { getAuthDir } from '../../cliproxy/config/path-resolver';
import { getCcsDir } from '../../config/config-loader-facade';
import { getAccountsRegistryPath } from '../../cliproxy/accounts/token-file-ops';

const router = Router();

/** Rate limiter for restore endpoint - prevents abuse */
const restoreRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 restore attempts per minute
  message: { error: 'Too many restore attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const importLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many import requests. Try again later.' },
});

interface BackupFile {
  path: string;
  timestamp: string;
  date: Date;
}

/**
 * Async mutex for restore operations - prevents race conditions
 *
 * Design: Fast-fail lock.
 * If a restore is already running, callers immediately get `false`
 * and the route returns HTTP 409. This avoids request pileup.
 */
class RestoreMutex {
  private locked = false;

  /**
   * Attempt to acquire the mutex
   * @returns true if acquired, false if already locked
   */
  async acquire(): Promise<boolean> {
    if (this.locked) {
      return false;
    }
    this.locked = true;
    return true;
  }

  /** Release the mutex */
  release(): void {
    this.locked = false;
  }
}

const restoreMutex = new RestoreMutex();

/**
 * Async mutex for import operations - prevents race conditions
 *
 * Design: Fast-fail lock.
 * If an import is already running, callers immediately get `false`
 * and the route returns HTTP 409. This avoids request pileup.
 */
class ImportMutex {
  private locked = false;

  async acquire(): Promise<boolean> {
    if (this.locked) {
      return false;
    }
    this.locked = true;
    return true;
  }

  release(): void {
    this.locked = false;
  }
}

const importMutex = new ImportMutex();

/** Check if path is a symlink (security check) */
function isSymlink(filePath: string): boolean {
  try {
    const stats = fs.lstatSync(filePath);
    return stats.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Get all backup files sorted by date (newest first) */
function getBackupFiles(): BackupFile[] {
  const backups: BackupFile[] = [];

  // CCS import safety backups (~/.ccs/backups/pre-import-*)
  const ccsDir = getCcsDir();
  const backupsDir = path.join(ccsDir, 'backups');
  if (fs.existsSync(backupsDir)) {
    const entries = fs.readdirSync(backupsDir).filter((d) => d.startsWith('pre-import-'));
    for (const entry of entries) {
      const match = entry.match(/^pre-import-(\d+)$/);
      if (!match) continue;
      const timestamp = match[1];
      const dirPath = path.join(backupsDir, entry);
      const date = new Date(fs.statSync(dirPath).mtimeMs);
      backups.push({
        path: dirPath,
        timestamp,
        date,
      });
    }
  }

  // Sort by date (newest first)
  backups.sort((a, b) => b.date.getTime() - a.date.getTime());
  return backups;
}

/**
 * GET /api/persist/backups - List available backups
 */
router.get('/backups', (_req: Request, res: Response): void => {
  try {
    const backups = getBackupFiles();
    res.json({
      backups: backups.map((b, i) => ({
        timestamp: b.timestamp,
        date: b.date.toISOString(),
        isLatest: i === 0,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /api/persist/restore - Restore from a backup
 * Body: { timestamp?: string } - If not provided, restores latest
 * Rate limited: 5 requests per minute
 */
router.post('/restore', restoreRateLimiter, async (req: Request, res: Response): Promise<void> => {
  // Atomic mutex acquisition - prevents race conditions
  const acquired = await restoreMutex.acquire();
  if (!acquired) {
    res.status(409).json({ error: 'Restore already in progress' });
    return;
  }

  try {
    const { timestamp } = req.body;
    const backups = getBackupFiles();

    if (backups.length === 0) {
      res.status(404).json({ error: 'No backups found' });
      return;
    }

    // Find backup
    let backup: BackupFile;
    if (!timestamp) {
      backup = backups[0]; // Latest
    } else {
      const found = backups.find((b) => b.timestamp === timestamp);
      if (!found) {
        res.status(404).json({ error: `Backup not found: ${timestamp}` });
        return;
      }
      backup = found;
    }

    // Security: reject symlinks to prevent path traversal attacks
    if (isSymlink(backup.path)) {
      res.status(400).json({ error: 'Backup path is a symlink - refusing for security' });
      return;
    }

    // Validate backup structure
    if (!fs.existsSync(backup.path) || !fs.statSync(backup.path).isDirectory()) {
      res.status(400).json({ error: 'Backup is not a valid directory' });
      return;
    }

    const backupAuthDir = path.join(backup.path, 'auth');
    const backupAccountsPath = path.join(backup.path, 'accounts.json');

    if (!fs.existsSync(backupAuthDir)) {
      res.status(400).json({ error: 'Backup is missing auth directory' });
      return;
    }

    // Restore with rollback on failure
    const currentAuthDir = getAuthDir();
    const rollbackAuthDir = path.join(path.dirname(currentAuthDir), 'auth-rollback-' + Date.now());

    const clearDir = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const f of fs.readdirSync(dir)) {
        const filePath = path.join(dir, f);
        if (fs.lstatSync(filePath).isDirectory()) {
          fs.rmSync(filePath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(filePath);
        }
      }
    };

    const copyDir = (src: string, dest: string) => {
      if (!fs.existsSync(src)) return;
      fs.mkdirSync(dest, { recursive: true });
      for (const f of fs.readdirSync(src)) {
        const srcPath = path.join(src, f);
        const destPath = path.join(dest, f);
        if (fs.lstatSync(srcPath).isSymbolicLink()) continue;
        fs.copyFileSync(srcPath, destPath);
      }
    };

    try {
      // Step 1: Backup current auth for rollback
      if (fs.existsSync(currentAuthDir)) {
        fs.cpSync(currentAuthDir, rollbackAuthDir, { recursive: true });
      }

      // Step 2: Clear and restore auth directory
      clearDir(currentAuthDir);
      copyDir(backupAuthDir, currentAuthDir);

      // Step 3: Restore accounts.json
      if (fs.existsSync(backupAccountsPath)) {
        const accountsPath = getAccountsRegistryPath();
        fs.copyFileSync(backupAccountsPath, accountsPath);
      }

      // Step 4: Cleanup rollback on success
      if (fs.existsSync(rollbackAuthDir)) {
        fs.rmSync(rollbackAuthDir, { recursive: true, force: true });
      }
    } catch (error) {
      // Rollback on failure
      try {
        if (fs.existsSync(rollbackAuthDir)) {
          clearDir(currentAuthDir);
          fs.cpSync(rollbackAuthDir, currentAuthDir, { recursive: true });
        }
      } catch (rollbackErr) {
        console.error('[persist-routes] Rollback failed:', rollbackErr);
        res.status(500).json({
          error: 'Restore failed and rollback unsuccessful - manual recovery may be needed',
        });
        return;
      }
      throw error;
    }

    res.json({
      success: true,
      timestamp: backup.timestamp,
      date: backup.date.toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  } finally {
    restoreMutex.release();
  }
});

function createSafetyBackup(): string {
  const ccsDir = getCcsDir();
  const backupDir = path.join(ccsDir, 'backups', `pre-import-${Date.now()}`);
  fs.mkdirSync(backupDir, { recursive: true });

  const authDir = getAuthDir();
  const pausedDir = path.join(path.dirname(authDir), 'auth-paused');
  const accountsPath = getAccountsRegistryPath();

  const copyDir = (src: string, dest: string) => {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const f of fs.readdirSync(src)) {
      const srcPath = path.join(src, f);
      const destPath = path.join(dest, f);
      if (fs.lstatSync(srcPath).isSymbolicLink()) continue;
      fs.copyFileSync(srcPath, destPath);
    }
  };

  copyDir(authDir, path.join(backupDir, 'auth'));
  copyDir(pausedDir, path.join(backupDir, 'auth-paused'));

  if (fs.existsSync(accountsPath)) {
    fs.copyFileSync(accountsPath, path.join(backupDir, 'accounts.json'));
  }

  return backupDir;
}

function pruneSafetyBackups(keepCount = 3): void {
  const backupsDir = path.join(getCcsDir(), 'backups');
  if (!fs.existsSync(backupsDir)) return;

  const entries = fs.readdirSync(backupsDir)
    .filter((d) => d.startsWith('pre-import-'))
    .map((d) => ({ name: d, time: fs.statSync(path.join(backupsDir, d)).mtimeMs }))
    .sort((a, b) => b.time - a.time);

  for (const entry of entries.slice(keepCount)) {
    fs.rmSync(path.join(backupsDir, entry.name), { recursive: true, force: true });
  }
}

/**
 * GET /api/persist/export — Full CCS backup (auth + accounts + config)
 */
router.get('/export', (_req: Request, res: Response): void => {
  try {
    const authDir = getAuthDir();
    const pausedDir = path.join(path.dirname(authDir), 'auth-paused');
    const accountsPath = getAccountsRegistryPath();

    // Read auth token files
    const readTokenDir = (dir: string): Array<{ filename: string; content: unknown }> => {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .reduce<Array<{ filename: string; content: unknown }>>((acc, f) => {
          const filePath = path.join(dir, f);
          if (isSymlink(filePath)) {
            console.warn(`[persist-routes] Skipping symlink in export: ${filePath}`);
            return acc;
          }
          try {
            acc.push({
              filename: f,
              content: JSON.parse(fs.readFileSync(filePath, 'utf-8')),
            });
          } catch (err) {
            console.warn(`[persist-routes] Skipping invalid JSON file in export: ${filePath} - ${(err as Error).message}`);
          }
          return acc;
        }, []);
    };

    const activeTokens = readTokenDir(authDir);
    const pausedTokens = readTokenDir(pausedDir);

    // Read accounts.json
    let accounts: unknown = {};
    if (fs.existsSync(accountsPath)) {
      accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));
    }

    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      auth: { active: activeTokens, paused: pausedTokens },
      accounts,
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="ccs-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json"`);
    res.json(backup);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Export failed: ${message}` });
  }
});

/**
 * POST /api/persist/import — Full CCS restore (wipe-and-replace)
 */
router.post('/import', importLimiter, async (req: Request, res: Response): Promise<void> => {
  const acquired = await importMutex.acquire();
  if (!acquired) {
    res.status(409).json({ error: 'Import already in progress' });
    return;
  }

  let safetyBackupPath: string | undefined;
  try {
    const backup = req.body as {
      version?: number;
      auth?: { active?: Array<{ filename: string; content: unknown }>; paused?: Array<{ filename: string; content: unknown }> };
      accounts?: unknown;
    };

    if (!backup || typeof backup !== 'object') {
      res.status(400).json({ error: 'Invalid backup file' });
      return;
    }
    if (backup.version !== 1) {
      res.status(400).json({ error: 'Unrecognized backup format' });
      return;
    }

    // Create safety backup before wiping
    safetyBackupPath = createSafetyBackup();

    const authDir = getAuthDir();
    const pausedDir = path.join(path.dirname(authDir), 'auth-paused');
    const accountsPath = getAccountsRegistryPath();

    // Clear existing auth directories
    if (fs.existsSync(authDir)) {
      for (const f of fs.readdirSync(authDir)) {
        const fp = path.join(authDir, f);
        if (!fs.lstatSync(fp).isSymbolicLink()) fs.unlinkSync(fp);
      }
    }
    if (fs.existsSync(pausedDir)) {
      for (const f of fs.readdirSync(pausedDir)) {
        const fp = path.join(pausedDir, f);
        if (!fs.lstatSync(fp).isSymbolicLink()) fs.unlinkSync(fp);
      }
    }

    // Write imported auth files
    const writeTokenFiles = (files: Array<{ filename: string; content: unknown }>, dir: string) => {
      fs.mkdirSync(dir, { recursive: true });
      for (const file of files) {
        const safeName = path.basename(file.filename);
        if (!safeName.endsWith('.json')) continue;
        const dest = path.join(dir, safeName);
        const tmp = `${dest}.tmp.${process.pid}`;
        fs.writeFileSync(tmp, JSON.stringify(file.content, null, 2), { mode: 0o600 });
        fs.renameSync(tmp, dest);
      }
    };

    writeTokenFiles(backup.auth?.active ?? [], authDir);
    writeTokenFiles(backup.auth?.paused ?? [], pausedDir);

    // Overwrite accounts.json
    if (backup.accounts) {
      const tmp = `${accountsPath}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(backup.accounts, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, accountsPath);
    }

    // Prune old safety backups
    pruneSafetyBackups(3);

    res.json({ success: true, safetyBackup: safetyBackupPath });
  } catch (error) {
    // Rollback: restore from safety backup on partial failure
    if (safetyBackupPath) {
      try {
        const authDir = getAuthDir();
        const pausedDir = path.join(path.dirname(authDir), 'auth-paused');
        const accountsPath = getAccountsRegistryPath();

        const restoreDir = (src: string, dest: string) => {
          if (!fs.existsSync(src)) return;
          fs.mkdirSync(dest, { recursive: true });
          for (const f of fs.readdirSync(dest)) {
            const fp = path.join(dest, f);
            if (!fs.lstatSync(fp).isSymbolicLink()) fs.unlinkSync(fp);
          }
          for (const f of fs.readdirSync(src)) {
            const srcPath = path.join(src, f);
            const destPath = path.join(dest, f);
            if (!fs.lstatSync(srcPath).isSymbolicLink()) fs.copyFileSync(srcPath, destPath);
          }
        };

        restoreDir(path.join(safetyBackupPath, 'auth'), authDir);
        restoreDir(path.join(safetyBackupPath, 'auth-paused'), pausedDir);

        const backupAccountsPath = path.join(safetyBackupPath, 'accounts.json');
        if (fs.existsSync(backupAccountsPath)) {
          fs.copyFileSync(backupAccountsPath, accountsPath);
        }
      } catch (rollbackErr) {
        console.error('[persist-routes] Import rollback failed:', rollbackErr);
        res.status(500).json({
          error: 'Import failed and rollback unsuccessful - manual recovery may be needed',
        });
        return;
      }
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: `Import failed: ${message}` });
  } finally {
    importMutex.release();
  }
});

export default router;
