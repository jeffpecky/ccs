import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleCleanupCommand } from '../../../src/commands/cleanup-command';
import { getCliproxyDir } from '../../../src/cliproxy/config/config-generator';
import { getLogArchiveDir, getNativeLogsDir } from '../../../src/services/logging';

describe('cleanup command', () => {
  let tempHome = '';
  let originalCcsHome: string | undefined;

  beforeEach(() => {
    originalCcsHome = process.env.CCS_HOME;
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-cleanup-command-'));
    process.env.CCS_HOME = tempHome;
  });

  afterEach(() => {
    if (originalCcsHome !== undefined) {
      process.env.CCS_HOME = originalCcsHome;
    } else {
      delete process.env.CCS_HOME;
    }

    fs.rmSync(tempHome, { recursive: true, force: true });
    tempHome = '';
  });

  it('reports CCS archives alongside current logs in dry-run mode', async () => {
    const ccsLogsDir = getNativeLogsDir();
    const archiveDir = getLogArchiveDir();
    const cliproxyLogsDir = path.join(getCliproxyDir(), 'logs');

    fs.mkdirSync(archiveDir, { recursive: true });
    fs.mkdirSync(cliproxyLogsDir, { recursive: true });
    fs.writeFileSync(path.join(ccsLogsDir, 'current.jsonl'), 'x'.repeat(100));
    fs.writeFileSync(path.join(archiveDir, 'archived.jsonl.gz'), 'y'.repeat(2_000));

    const logSpy = spyOn(console, 'log').mockImplementation(() => {});

    try {
      await handleCleanupCommand(['--dry-run']);

      const output = logSpy.mock.calls
        .flatMap((call) => call.map((value) => String(value)))
        .join('\n');

      expect(output).toContain('CCS Logs: 1 files (100.00 B)');
      expect(output).toContain('CCS Log Archives: 1 files (1.95 KB)');
      expect(output).toContain('Would delete 2 files (2.05 KB)');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('does not follow a symlinked CCS archive directory during cleanup', async () => {
    if (process.platform === 'win32') return;

    const ccsLogsDir = getNativeLogsDir();
    const archiveDir = getLogArchiveDir();
    const victimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-cleanup-victim-'));

    fs.mkdirSync(ccsLogsDir, { recursive: true });
    fs.writeFileSync(path.join(victimDir, 'keepme.log'), 'do not delete');
    fs.symlinkSync(victimDir, archiveDir, 'dir');

    const logSpy = spyOn(console, 'log').mockImplementation(() => {});

    try {
      await handleCleanupCommand(['--force']);

      const output = logSpy.mock.calls
        .flatMap((call) => call.map((value) => String(value)))
        .join('\n');

      expect(output).toContain('No CCS or CLIProxy logs found.');
      expect(fs.existsSync(path.join(victimDir, 'keepme.log'))).toBe(true);
    } finally {
      logSpy.mockRestore();
      fs.rmSync(victimDir, { recursive: true, force: true });
    }
  });
});
