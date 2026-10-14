/**
 * Copilot Package Manager
 *
 * Self-managed npm package installation for copilot-api:
 * - Installs copilot-api locally to ~/.ccs/copilot/
 * - Auto-updates to latest version (like CLIProxy binary manager)
 * - Version caching to avoid hitting npm registry on every run
 * - Retry logic with exponential backoff
 *
 * Pattern: Mirrors CLIProxy BinaryManager but for npm packages
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { ProgressIndicator } from '../utils/progress-indicator';
import { ok, info } from '../utils/ui';
import { getCcsDir } from '../config/config-loader-facade';

/** Cache duration for version check (1 hour in milliseconds) */
const VERSION_CACHE_DURATION_MS = 60 * 60 * 1000;

/** Version pin file name */
const VERSION_PIN_FILE = '.version-pin';

/** Package name to install */
const COPILOT_API_PACKAGE = 'copilot-api';

/** Version cache file structure */
interface VersionCache {
  latestVersion: string;
  checkedAt: number;
}

/** Update check result */
interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  fromCache: boolean;
}

/** Install result */
interface InstallResult {
  success: boolean;
  version?: string;
  error?: string;
}

/**
 * Get copilot base directory
 * All copilot-related files are stored under ~/.ccs/copilot/
 */
export function getCopilotDir(): string {
  return path.join(getCcsDir(), 'copilot');
}

/**
 * Get path to copilot-api binary
 */
export function getCopilotApiBinPath(): string {
  const binName = process.platform === 'win32' ? 'copilot-api.cmd' : 'copilot-api';
  return path.join(getCopilotDir(), 'node_modules', '.bin', binName);
}

/**
 * Get path to package.json
 */
function getPackageJsonPath(): string {
  return path.join(getCopilotDir(), 'package.json');
}

/**
 * Get path to version file
 */
function getVersionFilePath(): string {
  return path.join(getCopilotDir(), '.version');
}

/**
 * Get path to version cache file
 */
function getVersionCachePath(): string {
  return path.join(getCopilotDir(), '.version-cache.json');
}

/**
 * Get path to version pin file
 */
export function getVersionPinPath(): string {
  return path.join(getCopilotDir(), VERSION_PIN_FILE);
}

/**
 * Check if copilot-api is installed locally
 */
export function isCopilotApiInstalled(): boolean {
  return fs.existsSync(getCopilotApiBinPath());
}

/**
 * Get installed version from .version file
 */
export function getInstalledVersion(): string | null {
  const versionFile = getVersionFilePath();
  if (fs.existsSync(versionFile)) {
    try {
      return fs.readFileSync(versionFile, 'utf8').trim();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Save installed version to file
 */
function saveInstalledVersion(version: string): void {
  const versionFile = getVersionFilePath();
  try {
    fs.writeFileSync(versionFile, version, 'utf8');
  } catch {
    // Silent fail - not critical
  }
}

/**
 * Get cached latest version if still valid
 */
function getCachedLatestVersion(): string | null {
  const cachePath = getVersionCachePath();
  if (!fs.existsSync(cachePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(cachePath, 'utf8');
    const cache: VersionCache = JSON.parse(content);

    // Check if cache is still valid
    if (Date.now() - cache.checkedAt < VERSION_CACHE_DURATION_MS) {
      return cache.latestVersion;
    }

    // Cache expired
    return null;
  } catch {
    return null;
  }
}

/**
 * Cache latest version for future checks
 */
function cacheLatestVersion(version: string): void {
  const cachePath = getVersionCachePath();
  const cache: VersionCache = {
    latestVersion: version,
    checkedAt: Date.now(),
  };

  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(cache), 'utf8');
  } catch {
    // Silent fail - caching is optional
  }
}

/**
 * Fetch latest version from npm registry
 */
async function fetchLatestVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    const result = spawnSync('npm', ['view', COPILOT_API_PACKAGE, 'version'], {
      encoding: 'utf8',
      timeout: 15000,
      shell: process.platform === 'win32',
      windowsHide: true,
    });

    if (result.status === 0 && result.stdout) {
      resolve(result.stdout.trim());
    } else {
      reject(new Error(result.stderr || 'Failed to fetch version from npm'));
    }
  });
}

/**
 * Compare semver versions (true if latest > current)
 */
function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = latest.split('.').map((p) => parseInt(p, 10) || 0);
  const currentParts = current.split('.').map((p) => parseInt(p, 10) || 0);

  // Pad arrays to same length
  while (latestParts.length < 3) latestParts.push(0);
  while (currentParts.length < 3) currentParts.push(0);

  for (let i = 0; i < 3; i++) {
    if (latestParts[i] > currentParts[i]) return true;
    if (latestParts[i] < currentParts[i]) return false;
  }

  return false; // Equal versions
}

/**
 * Get pinned version if one exists
 */
export function getPinnedVersion(): string | null {
  const pinPath = getVersionPinPath();
  if (!fs.existsSync(pinPath)) {
    return null;
  }
  try {
    return fs.readFileSync(pinPath, 'utf8').trim();
  } catch {
    return null;
  }
}

/**
 * Save pinned version
 */
export function savePinnedVersion(version: string): void {
  const pinPath = getVersionPinPath();
  try {
    fs.mkdirSync(path.dirname(pinPath), { recursive: true });
    fs.writeFileSync(pinPath, version, 'utf8');
  } catch {
    // Silent fail
  }
}

/**
 * Clear pinned version
 */
export function clearPinnedVersion(): void {
  const pinPath = getVersionPinPath();
  if (fs.existsSync(pinPath)) {
    try {
      fs.unlinkSync(pinPath);
    } catch {
      // Silent fail
    }
  }
}

/**
 * Check for updates
 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = getInstalledVersion() || '0.0.0';

  // Try cache first
  const cachedVersion = getCachedLatestVersion();
  if (cachedVersion) {
    return {
      hasUpdate: isNewerVersion(cachedVersion, currentVersion),
      currentVersion,
      latestVersion: cachedVersion,
      fromCache: true,
    };
  }

  // Fetch from npm registry
  try {
    const latestVersion = await fetchLatestVersion();
    cacheLatestVersion(latestVersion);

    return {
      hasUpdate: isNewerVersion(latestVersion, currentVersion),
      currentVersion,
      latestVersion,
      fromCache: false,
    };
  } catch {
    // Return no update if fetch fails
    return {
      hasUpdate: false,
      currentVersion,
      latestVersion: currentVersion,
      fromCache: false,
    };
  }
}

/**
 * Run npm install in copilot directory
 */
async function runNpmInstall(version?: string): Promise<InstallResult> {
  const copilotDir = getCopilotDir();

  // Ensure directory exists
  fs.mkdirSync(copilotDir, { recursive: true });

  // Create package.json with versioned or latest dependency
  const packageJson = {
    name: 'ccs-copilot-local',
    private: true,
    dependencies: {
      [COPILOT_API_PACKAGE]: version || 'latest',
    },
  };

  fs.writeFileSync(getPackageJsonPath(), JSON.stringify(packageJson, null, 2), 'utf8');

  return new Promise((resolve) => {
    const proc = spawn('npm', ['install', '--prefer-offline', '--no-audit', '--no-fund'], {
      cwd: copilotDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    let stderr = '';

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        // Get installed version from package-lock.json or package.json
        try {
          const lockPath = path.join(copilotDir, 'package-lock.json');
          if (fs.existsSync(lockPath)) {
            const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
            const installedVersion =
              lock.packages?.['node_modules/copilot-api']?.version ||
              lock.dependencies?.[COPILOT_API_PACKAGE]?.version;
            if (installedVersion) {
              saveInstalledVersion(installedVersion);
              resolve({ success: true, version: installedVersion });
              return;
            }
          }
        } catch {
          // Fallback
        }
        resolve({ success: true, version: version || 'latest' });
      } else {
        resolve({ success: false, error: stderr || `npm install failed with code ${code}` });
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

/**
 * Ensure copilot-api is available (install if missing, update if outdated)
 * @returns Path to copilot-api binary
 */
export async function ensureCopilotApi(verbose = false): Promise<string> {
  const binPath = getCopilotApiBinPath();
  const pinnedVersion = getPinnedVersion();

  // Check if already installed
  if (isCopilotApiInstalled()) {
    if (verbose) {
      console.error(`[copilot] Binary exists: ${binPath}`);
    }

    // Skip auto-update if version is pinned
    if (pinnedVersion) {
      if (verbose) {
        console.error(`[copilot] Pinned version mode: skipping auto-update`);
      }
      return binPath;
    }

    // Check for updates (non-blocking for UX)
    try {
      const updateResult = await checkForUpdates();
      if (updateResult.hasUpdate) {
        console.log(
          info(
            `copilot-api update available: v${updateResult.currentVersion} -> v${updateResult.latestVersion}`
          )
        );
        console.log(info('Updating copilot-api...'));

        const spinner = new ProgressIndicator('Updating copilot-api');
        spinner.start();

        const result = await runNpmInstall(updateResult.latestVersion);
        if (result.success) {
          spinner.succeed('copilot-api updated');
          console.log(ok(`copilot-api v${result.version} installed successfully`));
        } else {
          spinner.fail('Update failed (non-blocking)');
          if (verbose) {
            console.error(`[copilot] Update failed: ${result.error}`);
          }
        }
      }
    } catch (error) {
      // Silent fail - don't block startup if update check fails
      if (verbose) {
        console.error(`[copilot] Update check failed: ${(error as Error).message}`);
      }
    }

    return binPath;
  }

  // Not installed - install now
  console.log(info('copilot-api not found, installing...'));

  const spinner = new ProgressIndicator('Installing copilot-api');
  spinner.start();

  try {
    // Get target version
    let targetVersion: string | undefined;
    if (pinnedVersion) {
      targetVersion = pinnedVersion;
      if (verbose) {
        console.error(`[copilot] Using pinned version: ${pinnedVersion}`);
      }
    } else {
      // Fetch latest version
      try {
        targetVersion = await fetchLatestVersion();
        cacheLatestVersion(targetVersion);
      } catch {
        // Use 'latest' if fetch fails
        targetVersion = undefined;
      }
    }

    const result = await runNpmInstall(targetVersion);

    if (result.success) {
      spinner.succeed('copilot-api installed');
      console.log(ok(`copilot-api v${result.version} installed successfully`));
      return binPath;
    } else {
      spinner.fail('Installation failed');
      throw new Error(result.error || 'npm install failed');
    }
  } catch (error) {
    spinner.fail('Installation failed');
    throw error;
  }
}

/**
 * Install a specific version of copilot-api
 */
export async function installCopilotApiVersion(version: string, _verbose = false): Promise<void> {
  const spinner = new ProgressIndicator(`Installing copilot-api v${version}`);
  spinner.start();

  try {
    const result = await runNpmInstall(version);

    if (result.success) {
      spinner.succeed('copilot-api installed');
      console.log(ok(`copilot-api v${result.version} installed successfully`));
    } else {
      spinner.fail('Installation failed');
      throw new Error(result.error || 'npm install failed');
    }
  } catch (error) {
    spinner.fail('Installation failed');
    throw error;
  }
}

/**
 * Uninstall copilot-api (remove ~/.ccs/copilot directory)
 */
export function uninstallCopilotApi(): void {
  const copilotDir = getCopilotDir();
  if (fs.existsSync(copilotDir)) {
    fs.rmSync(copilotDir, { recursive: true, force: true });
  }
}

/**
 * Get copilot-api info
 */
export function getCopilotApiInfo(): {
  installed: boolean;
  version: string | null;
  path: string;
  pinnedVersion: string | null;
} {
  return {
    installed: isCopilotApiInstalled(),
    version: getInstalledVersion(),
    path: getCopilotApiBinPath(),
    pinnedVersion: getPinnedVersion(),
  };
}

export default {
  getCopilotDir,
  getCopilotApiBinPath,
  isCopilotApiInstalled,
  getInstalledVersion,
  getPinnedVersion,
  savePinnedVersion,
  clearPinnedVersion,
  checkForUpdates,
  ensureCopilotApi,
  installCopilotApiVersion,
  uninstallCopilotApi,
  getCopilotApiInfo,
};
