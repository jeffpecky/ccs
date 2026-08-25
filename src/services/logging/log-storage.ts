import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { getResolvedLoggingConfig } from './log-config';
import {
  ensureLoggingDirectories,
  getCurrentLogPath,
  buildArchiveLogPath,
  getLogArchiveDir,
} from './log-paths';
import { pushRecentLogEntry } from './log-buffer';
import { shouldWriteLogLevel, type LogEntry } from './log-types';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 1000;
const gzip = promisify(zlib.gzip);
let lastPruneAt = 0;
let pendingLines: string[] = [];
let pendingMaintenance: Promise<void> | null = null;

function getRotateBytes(rotateMb: number): number {
  return Math.max(1, rotateMb) * 1024 * 1024;
}

async function rotateCurrentLogIfNeeded(): Promise<void> {
  const config = getResolvedLoggingConfig();
  const currentLogPath = getCurrentLogPath();
  let stats: fs.Stats;

  try {
    stats = await fsp.stat(currentLogPath);
  } catch {
    return;
  }

  const ageMs = Date.now() - stats.mtimeMs;
  if (stats.size < getRotateBytes(config.rotate_mb) && ageMs < ONE_DAY_MS) return;

  const currentContent = await fsp.readFile(currentLogPath, 'utf8');
  if (!currentContent.trim()) {
    await fsp.truncate(currentLogPath, 0);
    return;
  }

  const archivePath = buildArchiveLogPath(new Date(stats.mtimeMs || Date.now()));
  await fsp.writeFile(archivePath, await gzip(currentContent), { mode: 0o600 });
  await fsp.truncate(currentLogPath, 0);
}

export async function pruneExpiredLogArchives(): Promise<void> {
  const config = getResolvedLoggingConfig();
  const archiveDir = getLogArchiveDir();
  let entries: fs.Dirent[];

  try {
    entries = await fsp.readdir(archiveDir, { withFileTypes: true });
  } catch {
    return;
  }

  const cutoffMs = Date.now() - config.retain_days * ONE_DAY_MS;
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const archivePath = path.join(archiveDir, entry.name);
    try {
      const stats = await fsp.stat(archivePath);
      if (stats.mtimeMs < cutoffMs) await fsp.unlink(archivePath);
    } catch {
      continue;
    }
  }
}

export function appendStructuredLogEntry(entry: LogEntry): void {
  const config = getResolvedLoggingConfig();
  if (!config.enabled || !shouldWriteLogLevel(entry.level, config.level)) return;

  pendingLines.push(`${JSON.stringify(entry)}\n`);
  pushRecentLogEntry(entry, config.live_buffer_size);
  scheduleLogMaintenance();
}

function scheduleLogMaintenance(): void {
  if (pendingMaintenance) return;

  pendingMaintenance = new Promise<void>((resolve) => setImmediate(resolve))
    .then(async () => {
      ensureLoggingDirectories();
      await rotateCurrentLogIfNeeded();

      const lines = pendingLines;
      pendingLines = [];
      if (lines.length > 0) {
        await fsp.appendFile(getCurrentLogPath(), lines.join(''), {
          encoding: 'utf8',
          mode: 0o600,
        });
      }

      if (Date.now() - lastPruneAt >= PRUNE_INTERVAL_MS) {
        await pruneExpiredLogArchives();
        lastPruneAt = Date.now();
      }
    })
    .catch(() => {})
    .finally(() => {
      pendingMaintenance = null;
      if (pendingLines.length > 0) scheduleLogMaintenance();
    });
}

export async function flushPendingLogMaintenance(): Promise<void> {
  while (pendingMaintenance || pendingLines.length > 0) {
    if (!pendingMaintenance) scheduleLogMaintenance();
    await pendingMaintenance;
  }
}
