import { describe, expect, test } from 'bun:test';
import * as path from 'node:path';
import {
  getBarPlatform,
  getWindowsBarPaths,
  installWindowsBar,
  uninstallWindowsBar,
  windowsBarAssetName,
  windowsOpenCommand,
} from '../../../src/commands/bar/platform-adapter';
import * as fs from 'node:fs';
import * as os from 'node:os';

describe('bar platform adapter', () => {
  test('keeps macOS and Windows asset selection separate', () => {
    expect(getBarPlatform('darwin').assetName).toBe('CCS-Bar.app.zip');
    expect(getBarPlatform('win32').assetName).toBe(windowsBarAssetName('x64'));
    expect(() => getBarPlatform('linux')).toThrow(/macOS or Windows/);
  });

  test('uses per-user Windows install and shell registration paths', () => {
    const paths = getWindowsBarPaths('C:\\Users\\me', 'C:\\Users\\me\\AppData\\Local', 'C:\\Users\\me\\AppData\\Roaming');
    expect(paths.exe).toBe(path.win32.join('C:\\Users\\me\\AppData\\Local', 'Programs', 'CCS Bar', 'CCS Bar.exe'));
    expect(paths.startMenuShortcut).toContain(path.win32.join('Microsoft', 'Windows', 'Start Menu', 'Programs'));
    expect(paths.startupShortcut).toContain(path.win32.join('Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'));
  });

  test('opens installed exe directly without shell interpolation', () => {
    expect(windowsOpenCommand('C:\\Program Files\\CCS Bar\\CCS Bar.exe')).toEqual({
      file: 'C:\\Program Files\\CCS Bar\\CCS Bar.exe',
      args: [],
    });
  });

  test('install swaps staged app, writes descriptor and registers shortcuts', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-win-bar-'));
    const installDir = path.join(root, 'Programs', 'CCS Bar');
    const calls: string[] = [];
    await installWindowsBar(['--no-launch'], {
      paths: {
        installDir,
        exe: path.join(installDir, 'CCS Bar.exe'),
        startMenuShortcut: path.join(root, 'Start Menu', 'CCS Bar.lnk'),
        startupShortcut: path.join(root, 'Startup', 'CCS Bar.lnk'),
        versionFile: path.join(root, '.ccs', 'bar', '.version'),
        launchJson: path.join(root, '.ccs', 'bar', 'launch.json'),
      },
      fetchAsset: async () => ({ downloadUrl: 'https://github.com/example.zip', sha256: 'a'.repeat(64) }),
      stageAsset: async (_url, staging) => {
        const app = path.join(staging, 'CCS Bar');
        fs.mkdirSync(app, { recursive: true });
        fs.writeFileSync(path.join(app, 'CCS Bar.exe'), 'binary');
      },
      appRunning: async () => false,
      registerShortcut: (shortcut, target) => calls.push(`${shortcut}:${target}`),
      writeLaunchDescriptor: (file) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '{}'); },
      launch: async () => calls.push('launch'),
      version: '1.2.3',
    });
    expect(fs.existsSync(path.join(installDir, 'CCS Bar.exe'))).toBe(true);
    expect(fs.readFileSync(path.join(root, '.ccs', 'bar', '.version'), 'utf8')).toBe('1.2.3');
    expect(calls.filter((call) => call.includes('.lnk:')).length).toBe(2);
    expect(calls).not.toContain('launch');
  });

  test('install restores previous app when final swap fails', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-win-bar-rollback-'));
    const installDir = path.join(root, 'CCS Bar');
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(path.join(installDir, 'CCS Bar.exe'), 'old');
    let renames = 0;
    await installWindowsBar(['--no-launch'], {
      paths: {
        installDir,
        exe: path.join(installDir, 'CCS Bar.exe'),
        startMenuShortcut: path.join(root, 'start.lnk'),
        startupShortcut: path.join(root, 'startup.lnk'),
        versionFile: path.join(root, '.version'),
        launchJson: path.join(root, 'launch.json'),
      },
      fetchAsset: async () => ({ downloadUrl: 'https://github.com/example.zip', sha256: 'a'.repeat(64) }),
      stageAsset: async (_url, staging) => {
        const app = path.join(staging, 'CCS Bar');
        fs.mkdirSync(app, { recursive: true });
        fs.writeFileSync(path.join(app, 'CCS Bar.exe'), 'new');
      },
      appRunning: async () => false,
      registerShortcut: () => {},
      writeLaunchDescriptor: () => {},
      launch: async () => {},
      version: '1.2.3',
      rename: (from, to) => { renames++; if (renames === 2) throw new Error('locked'); fs.renameSync(from, to); },
    });
    expect(fs.readFileSync(path.join(installDir, 'CCS Bar.exe'), 'utf8')).toBe('old');
  });

  test('install restores previous app when registration fails', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-win-bar-register-'));
    const installDir = path.join(root, 'CCS Bar');
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(path.join(installDir, 'CCS Bar.exe'), 'old');
    await installWindowsBar(['--no-launch'], {
      paths: { installDir, exe: path.join(installDir, 'CCS Bar.exe'), startMenuShortcut: path.join(root, 'start.lnk'), startupShortcut: path.join(root, 'startup.lnk'), versionFile: path.join(root, '.version'), launchJson: path.join(root, 'launch.json') },
      fetchAsset: async () => ({ downloadUrl: 'https://github.com/example.zip', sha256: 'a'.repeat(64) }),
      stageAsset: async (_url, staging) => { const app = path.join(staging, 'CCS Bar'); fs.mkdirSync(app, { recursive: true }); fs.writeFileSync(path.join(app, 'CCS Bar.exe'), 'new'); },
      appRunning: async () => false,
      registerShortcut: () => { throw new Error('shortcut failed'); },
      writeLaunchDescriptor: () => {}, launch: async () => {}, version: '1.2.3',
    });
    expect(fs.readFileSync(path.join(installDir, 'CCS Bar.exe'), 'utf8')).toBe('old');
  });

  test('first install registration failure removes every created artifact', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-win-bar-first-fail-'));
    const paths = { installDir: path.join(root, 'CCS Bar'), exe: path.join(root, 'CCS Bar', 'CCS Bar.exe'), startMenuShortcut: path.join(root, 'start.lnk'), startupShortcut: path.join(root, 'startup.lnk'), versionFile: path.join(root, '.version'), launchJson: path.join(root, 'launch.json') };
    await installWindowsBar(['--no-launch'], {
      paths,
      fetchAsset: async () => ({ downloadUrl: 'https://github.com/example.zip', sha256: 'a'.repeat(64) }),
      stageAsset: async (_url, staging) => { const app = path.join(staging, 'CCS Bar'); fs.mkdirSync(app, { recursive: true }); fs.writeFileSync(path.join(app, 'CCS Bar.exe'), 'new'); },
      appRunning: async () => false,
      registerShortcut: (shortcut) => { fs.writeFileSync(shortcut, 'link'); throw new Error('shortcut failed'); },
      writeLaunchDescriptor: (file) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'descriptor'); },
      launch: async () => {}, version: '1.2.3',
    });
    for (const artifact of [paths.installDir, paths.versionFile, paths.launchJson, paths.startMenuShortcut, paths.startupShortcut]) expect(fs.existsSync(artifact)).toBe(false);
  });

  test('platform adapter contains no Bun globals', () => {
    const source = fs.readFileSync(path.join(import.meta.dir, '../../../src/commands/bar/platform-adapter.ts'), 'utf8');
    expect(source).not.toMatch(/\bBun\b/);
  });

  test('uninstall removes app and registrations but preserves CCS data', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-win-bar-uninstall-'));
    const paths = {
      installDir: path.join(root, 'CCS Bar'), exe: path.join(root, 'CCS Bar', 'CCS Bar.exe'),
      startMenuShortcut: path.join(root, 'start.lnk'), startupShortcut: path.join(root, 'startup.lnk'),
      versionFile: path.join(root, '.ccs', 'bar', '.version'), launchJson: path.join(root, '.ccs', 'bar', 'launch.json'),
    };
    fs.mkdirSync(paths.installDir, { recursive: true }); fs.writeFileSync(paths.exe, 'app');
    fs.mkdirSync(path.dirname(paths.versionFile), { recursive: true }); fs.writeFileSync(paths.versionFile, '1');
    fs.writeFileSync(path.join(root, '.ccs', 'config.json'), 'keep');
    fs.writeFileSync(paths.startMenuShortcut, 'link'); fs.writeFileSync(paths.startupShortcut, 'link');
    await uninstallWindowsBar([], { paths, stopApp: async () => {} });
    expect(fs.existsSync(paths.installDir)).toBe(false);
    expect(fs.existsSync(paths.startMenuShortcut)).toBe(false);
    expect(fs.existsSync(path.join(root, '.ccs', 'config.json'))).toBe(true);
  });
});
