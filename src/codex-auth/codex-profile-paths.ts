import * as path from 'path';
import * as os from 'os';
import { getCcsDir } from '../utils/config-manager';

export function getCodexAuthRegistryPath(): string {
  return path.join(getCcsDir(), 'codex-profiles.yaml');
}

export function getCodexInstancesDir(): string {
  return path.join(getCcsDir(), 'codex-instances');
}

export function resolveCodexProfileDir(name: string): string {
  return path.join(getCodexInstancesDir(), name);
}

// Uses os.homedir() intentionally — this is the upstream Codex location,
// not a CCS-owned path. Tests must override the shared config path explicitly.
export function getSharedCodexConfigPath(): string {
  return path.join(os.homedir(), '.codex', 'config.toml');
}
