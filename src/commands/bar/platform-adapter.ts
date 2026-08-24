import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile, execFileSync, spawn } from 'child_process';
import { promisify } from 'util';
import { getCcsDir } from '../../config/config-loader-facade';
import { createBarLaunchDescriptor } from './launch-descriptor';

const RELEASE_TAG = 'ccs-bar-latest';
const REPOSITORY = 'jeffpecky/ccs';
const WINDOWS_ASSET = 'CCS-Bar-windows-x64.zip';
const execFileAsync = promisify(execFile);

export interface WindowsBarPaths {
  installDir: string;
  exe: string;
  startMenuShortcut: string;
  startupShortcut: string;
  versionFile: string;
  launchJson: string;
}

export function windowsBarAssetName(arch: string): string {
  if (arch !== 'x64') throw new Error(`Unsupported Windows architecture: ${arch}. CCS Bar requires win-x64.`);
  return WINDOWS_ASSET;
}

export function getBarPlatform(platform: NodeJS.Platform = process.platform, arch = process.arch) {
  if (platform === 'darwin') return { assetName: 'CCS-Bar.app.zip', appName: 'CCS Bar.app' };
  if (platform === 'win32') return { assetName: windowsBarAssetName(arch), appName: 'CCS Bar.exe' };
  throw new Error('CCS Bar supports macOS or Windows only.');
}

export function getWindowsBarPaths(
  home = os.homedir(),
  localAppData = process.env.LOCALAPPDATA ?? path.win32.join(home, 'AppData', 'Local'),
  appData = process.env.APPDATA ?? path.win32.join(home, 'AppData', 'Roaming'),
  ccsDir = getCcsDir()
): WindowsBarPaths {
  const installDir = path.win32.join(localAppData, 'Programs', 'CCS Bar');
  const programs = path.win32.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  return {
    installDir,
    exe: path.win32.join(installDir, 'CCS Bar.exe'),
    startMenuShortcut: path.win32.join(programs, 'CCS Bar.lnk'),
    startupShortcut: path.win32.join(programs, 'Startup', 'CCS Bar.lnk'),
    versionFile: path.join(ccsDir, 'bar', '.version'),
    launchJson: path.join(ccsDir, 'bar', 'launch.json'),
  };
}

export function windowsOpenCommand(exe: string): { file: string; args: string[] } {
  return { file: exe, args: [] };
}

export async function openWindowsBar(exe: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

interface Asset { downloadUrl: string; sha256: string }
interface WindowsInstallDeps {
  paths: WindowsBarPaths;
  fetchAsset: () => Promise<Asset>;
  stageAsset: (url: string, staging: string, sha256: string) => Promise<void>;
  appRunning: () => Promise<boolean>;
  registerShortcut: (shortcut: string, target: string) => void;
  writeLaunchDescriptor: (file: string) => void;
  launch: () => Promise<void>;
  version: string;
  rename: (from: string, to: string) => void;
}

async function fetchWindowsAsset(): Promise<Asset> {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/tags/${RELEASE_TAG}`, {
    headers: { 'User-Agent': 'ccs-cli', Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status} for tag ${RELEASE_TAG}`);
  const release = await response.json() as { assets?: Array<{ name: string; browser_download_url: string; digest?: string }> };
  const asset = release.assets?.find((candidate) => candidate.name === WINDOWS_ASSET);
  const digest = /^sha256:([a-fA-F0-9]{64})$/.exec(asset?.digest?.trim() ?? '');
  if (!asset || !digest?.[1]) throw new Error(`Release asset ${WINDOWS_ASSET} with SHA-256 digest not found.`);
  return { downloadUrl: asset.browser_download_url, sha256: digest[1].toLowerCase() };
}

async function stageWindowsAsset(url: string, staging: string, expectedSha256: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['github.com', 'objects.githubusercontent.com'].includes(parsed.hostname)) {
    throw new Error(`Refusing untrusted CCS Bar download URL: ${url}`);
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const actual = crypto.createHash('sha256').update(archive).digest('hex');
  if (actual !== expectedSha256.toLowerCase()) throw new Error('CCS Bar archive SHA-256 mismatch.');
  const zip = path.join(staging, WINDOWS_ASSET);
  fs.writeFileSync(zip, archive);
  try { await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force', zip, staging]); }
  catch (error) { throw new Error(`Archive extraction failed: ${error instanceof Error ? error.message : String(error)}`); }
  fs.rmSync(zip, { force: true });
}

function registerWindowsShortcut(shortcut: string, target: string): void {
  fs.mkdirSync(path.dirname(shortcut), { recursive: true });
  const script = '$w=New-Object -ComObject WScript.Shell;$s=$w.CreateShortcut($args[0]);$s.TargetPath=$args[1];$s.WorkingDirectory=(Split-Path $args[1]);$s.Save()';
  try { execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script, shortcut, target], { stdio: 'pipe' }); }
  catch (error) { throw new Error(`Shortcut registration failed: ${error instanceof Error ? error.message : String(error)}`); }
}

function writeWindowsLaunchDescriptor(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(createBarLaunchDescriptor({ platform: 'win32' }), null, 2));
}

async function isWindowsBarRunning(): Promise<boolean> {
  const script = '(Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq $args[0]} | Select-Object -First 1).ProcessId';
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script, getWindowsBarPaths().exe]);
  return /^\d+$/m.test(stdout.trim());
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function installWindowsBar(args: string[], supplied: Partial<WindowsInstallDeps> = {}): Promise<void> {
  const paths = supplied.paths ?? getWindowsBarPaths();
  const deps: WindowsInstallDeps = {
    paths,
    fetchAsset: supplied.fetchAsset ?? fetchWindowsAsset,
    stageAsset: supplied.stageAsset ?? stageWindowsAsset,
    appRunning: supplied.appRunning ?? isWindowsBarRunning,
    registerShortcut: supplied.registerShortcut ?? registerWindowsShortcut,
    writeLaunchDescriptor: supplied.writeLaunchDescriptor ?? writeWindowsLaunchDescriptor,
    launch: supplied.launch ?? (() => openWindowsBar(paths.exe)),
    version: supplied.version ?? 'unknown',
    rename: supplied.rename ?? fs.renameSync,
  };
  const parent = path.dirname(paths.installDir);
  fs.mkdirSync(parent, { recursive: true });
  const staging = fs.mkdtempSync(path.join(parent, '.ccs-bar-staging-'));
  const stagedApp = path.join(staging, 'CCS Bar');
  const backup = `${paths.installDir}.previous-${process.pid}`;
  const registrations = [paths.versionFile, paths.launchJson, paths.startMenuShortcut, paths.startupShortcut];
  const priorRegistrations = new Map(registrations.map((file) => [file, fs.existsSync(file) ? fs.readFileSync(file) : null]));
  let swapped = false;
  try {
    const asset = await deps.fetchAsset();
    await deps.stageAsset(asset.downloadUrl, staging, asset.sha256);
    if (!fs.existsSync(path.join(stagedApp, 'CCS Bar.exe'))) throw new Error('Package missing CCS Bar/CCS Bar.exe.');
    if (args.includes('--await-quit')) {
      const deadline = Date.now() + 15_000;
      while (await deps.appRunning()) {
        if (Date.now() >= deadline) throw new Error('CCS Bar is still running. Quit it and retry update.');
        await sleep(300);
      }
    }
    if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true, force: true });
    if (fs.existsSync(paths.installDir)) deps.rename(paths.installDir, backup);
    try { deps.rename(stagedApp, paths.installDir); }
    catch (error) { if (fs.existsSync(backup)) deps.rename(backup, paths.installDir); throw error; }
    swapped = true;
    let version = deps.version;
    if (version === 'unknown') {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(paths.installDir, 'manifest.json'), 'utf8')) as { version?: string };
        version = manifest.version?.trim() || version;
      } catch { /* package validation already checked executable */ }
    }
    fs.mkdirSync(path.dirname(paths.versionFile), { recursive: true });
    fs.writeFileSync(paths.versionFile, version);
    deps.writeLaunchDescriptor(paths.launchJson);
    deps.registerShortcut(paths.startMenuShortcut, paths.exe);
    deps.registerShortcut(paths.startupShortcut, paths.exe);
    fs.rmSync(backup, { recursive: true, force: true });
    console.log(`[OK] CCS Bar installed to ${paths.installDir}`);
    if (args.includes('--launch')) await deps.launch();
    else if (!args.includes('--no-launch')) console.log('[i] Run `ccs bar` to launch.');
  } catch (error) {
    if (swapped) {
      fs.rmSync(paths.installDir, { recursive: true, force: true });
      if (fs.existsSync(backup)) deps.rename(backup, paths.installDir);
      for (const artifact of registrations) {
        fs.rmSync(artifact, { force: true });
        const prior = priorRegistrations.get(artifact);
        if (prior) { fs.mkdirSync(path.dirname(artifact), { recursive: true }); fs.writeFileSync(artifact, prior); }
      }
    }
    console.error(`[X] CCS Bar install failed: ${error instanceof Error ? error.message : String(error)}`);
    if (Object.keys(supplied).length === 0) process.exitCode = 1;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

export async function uninstallWindowsBar(
  _args: string[],
  supplied: { paths?: WindowsBarPaths; stopApp?: () => Promise<void> } = {}
): Promise<void> {
  const paths = supplied.paths ?? getWindowsBarPaths();
  try {
    await (supplied.stopApp ?? (async () => {
      const script = 'Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq $args[0]} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }';
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script, paths.exe], { stdio: 'pipe' });
    }))();
    fs.rmSync(paths.installDir, { recursive: true, force: true });
    fs.rmSync(paths.startMenuShortcut, { force: true });
    fs.rmSync(paths.startupShortcut, { force: true });
    fs.rmSync(paths.versionFile, { force: true });
    fs.rmSync(paths.launchJson, { force: true });
    console.log('[OK] CCS Bar uninstalled. CCS configuration and account data were preserved.');
  } catch (error) {
    console.error(`[X] CCS Bar uninstall failed: ${error instanceof Error ? error.message : String(error)}`);
    if (Object.keys(supplied).length === 0) process.exitCode = 1;
  }
}
