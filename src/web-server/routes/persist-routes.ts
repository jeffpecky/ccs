/**
 * Persist Routes - Backup management for ~/.claude/settings.json
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import * as fs from 'fs';
import * as path from 'path';
import { getClaudeSettingsPath } from '../../utils/claude-config-path';
import { getAuthDir } from '../../cliproxy/config/path-resolver';
import { getCcsDir } from '../../config/config-loader-facade';
import { getAccountsRegistryPath } from '../../cliproxy/accounts/token-file-ops';
import { loadUnifiedConfig } from '../../config/unified-config-loader';

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

function parseBackupTimestamp(timestamp: string): Date | null {
  const year = parseInt(timestamp.slice(0, 4), 10);
  const month = parseInt(timestamp.slice(4, 6), 10);
  const day = parseInt(timestamp.slice(6, 8), 10);
  const hour = parseInt(timestamp.slice(9, 11), 10);
  const minute = parseInt(timestamp.slice(11, 13), 10);
  const second = parseInt(timestamp.slice(13, 15), 10);
  const date = new Date(year, month - 1, day, hour, minute, second);

  if (date.getFullYear() !== year) return null;
  if (date.getMonth() !== month - 1) return null;
  if (date.getDate() !== day) return null;
  if (date.getHours() !== hour) return null;
  if (date.getMinutes() !== minute) return null;
  if (date.getSeconds() !== second) return null;

  return date;
}

/** Get all backup files sorted by date (newest first) */
function getBackupFiles(): BackupFile[] {
  const settingsPath = getClaudeSettingsPath();
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const backupPattern = /^settings\.json\.backup\.(\d{8}_\d{6})$/;
  const files = fs
    .readdirSync(dir)
    .filter((f) => backupPattern.test(f))
    .map((f) => {
      const match = f.match(backupPattern);
      if (!match) return null;
      const timestamp = match[1];
      const date = parseBackupTimestamp(timestamp);
      if (!date) return null;
      return {
        path: path.join(dir, f),
        timestamp,
        date,
      };
    })
    .filter((f): f is BackupFile => f !== null)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  return files;
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
      res.status(400).json({ error: 'Backup file is a symlink - refusing for security' });
      return;
    }

    const settingsPath = getClaudeSettingsPath();
    if (isSymlink(settingsPath)) {
      res.status(400).json({ error: 'settings.json is a symlink - refusing for security' });
      return;
    }

    // Read backup content securely using file descriptor to prevent TOCTOU
    // Open with O_NOFOLLOW equivalent check then read atomically
    let backupContent: string;
    let fd: number | undefined;
    try {
      if (typeof fs.constants.O_NOFOLLOW !== 'number') {
        res.status(500).json({ error: 'Secure restore unsupported on this platform' });
        return;
      }
      // Open file descriptor for atomic read
      const openFlags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW;
      fd = fs.openSync(backup.path, openFlags);
      const stats = fs.fstatSync(fd);
      if (!stats.isFile()) {
        res.status(400).json({ error: 'Backup path is not a regular file' });
        return;
      }
      const buffer = Buffer.alloc(stats.size);
      fs.readSync(fd, buffer, 0, stats.size, 0);
      backupContent = buffer.toString('utf8');

      const parsed = JSON.parse(backupContent);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        res.status(400).json({ error: 'Backup file is corrupted' });
        return;
      }
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ELOOP') {
        res.status(400).json({ error: 'Backup file is a symlink - refusing for security' });
        return;
      }
      if (error.code === 'ENOENT') {
        res.status(404).json({ error: 'Backup was deleted during restore' });
        return;
      }
      res.status(400).json({ error: 'Backup file is corrupted or invalid JSON' });
      return;
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          // Ignore close errors
        }
      }
    }

    // Atomic restore with rollback capability
    const settingsDir = path.dirname(settingsPath);
    const restoreNonce = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const tempPath = path.join(settingsDir, `settings.json.restore-${restoreNonce}.tmp`);
    const rollbackPath = path.join(settingsDir, `settings.json.rollback-${restoreNonce}.tmp`);

    try {
      // Step 1: Backup current settings for rollback
      if (fs.existsSync(settingsPath)) {
        fs.copyFileSync(settingsPath, rollbackPath, fs.constants.COPYFILE_EXCL);
      }

      // Step 2: Write validated content to temp file
      fs.writeFileSync(tempPath, backupContent, { encoding: 'utf8', flag: 'wx', mode: 0o600 });

      // Step 3: Atomic rename (replaces existing file)
      fs.renameSync(tempPath, settingsPath);

      // Step 4: Cleanup rollback backup on success
      if (fs.existsSync(rollbackPath)) {
        fs.unlinkSync(rollbackPath);
      }

      res.json({
        success: true,
        timestamp: backup.timestamp,
        date: backup.date.toISOString(),
      });
    } catch (error) {
      // Rollback on failure
      try {
        if (fs.existsSync(rollbackPath)) {
          fs.renameSync(rollbackPath, settingsPath);
        }
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
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

    // Read config.yaml as JSON
    let config: unknown = {};
    try {
      config = loadUnifiedConfig();
    } catch {
      // Config may not exist yet
    }

    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      auth: { active: activeTokens, paused: pausedTokens },
      accounts,
      config,
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
      config?: unknown;
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

    const warnings: string[] = [];
    if (backup.config !== undefined) {
      warnings.push('config.yaml was not restored (not supported in wipe-and-replace)');
    }

    res.json({ success: true, safetyBackup: safetyBackupPath, warnings });
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
