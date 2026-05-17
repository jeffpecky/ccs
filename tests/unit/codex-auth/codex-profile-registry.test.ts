import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as lockfile from 'proper-lockfile';
import { spawn } from 'child_process';

let CodexProfileRegistry: new (registryPath?: string) => {
  createProfile(name: string, meta?: Record<string, unknown>): void;
  getProfile(name: string): Record<string, unknown>;
  updateProfile(name: string, partial: Record<string, unknown>): void;
  removeProfile(name: string): void;
  listProfiles(): string[];
  hasProfile(name: string): boolean;
  getDefault(): string | null;
  setDefault(name: string): void;
  clearDefault(): void;
  touchProfile(name: string): void;
};

let tempDir: string;
let ccsHome: string;
let registryPath: string;

const ORIGINAL_CCS_HOME = process.env.CCS_HOME;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-registry-test-'));
  ccsHome = path.join(tempDir, 'ccs-home');
  fs.mkdirSync(path.join(ccsHome, '.ccs'), { recursive: true, mode: 0o700 });
  process.env.CCS_HOME = ccsHome;
  registryPath = path.join(ccsHome, '.ccs', 'codex-profiles.yaml');

  const mod = await import('../../../src/codex-auth/codex-profile-registry');
  CodexProfileRegistry = mod.CodexProfileRegistry;
});

afterEach(() => {
  if (ORIGINAL_CCS_HOME === undefined) {
    delete process.env.CCS_HOME;
  } else {
    process.env.CCS_HOME = ORIGINAL_CCS_HOME;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
  mock.restore();
});

describe('CodexProfileRegistry — empty state', () => {
  it('returns empty list when registry file does not exist', () => {
    const reg = new CodexProfileRegistry(registryPath);
    expect(reg.listProfiles()).toEqual([]);
  });

  it('returns null default when registry file does not exist', () => {
    const reg = new CodexProfileRegistry(registryPath);
    expect(reg.getDefault()).toBeNull();
  });
});

describe('CodexProfileRegistry — create and get', () => {
  it('creates a profile and retrieves it by name', () => {
    const reg = new CodexProfileRegistry(registryPath);
    reg.createProfile('work');
    const profile = reg.getProfile('work');
    expect(profile.type).toBe('codex');
    expect(typeof profile.created).toBe('string');
    expect(profile.last_used).toBeNull();
  });

  it('persists profile to disk as YAML with schema version', () => {
    const reg = new CodexProfileRegistry(registryPath);
    reg.createProfile('work');
    const raw = fs.readFileSync(registryPath, 'utf8');
    const parsed = yaml.load(raw) as Record<string, unknown>;
    expect(parsed.version).toBe('1.0');
    expect(typeof parsed.profiles).toBe('object');
  });

  it('throws when creating a duplicate profile name', () => {
    const reg = new CodexProfileRegistry(registryPath);
    reg.createProfile('work');
    expect(() => reg.createProfile('work')).toThrow(/already exists/i);
  });

  it('accepts optional metadata on create', () => {
    const reg = new CodexProfileRegistry(registryPath);
    reg.createProfile('personal', { email: 'me@example.com', plan_type: 'pro' });
    const profile = reg.getProfile('personal');
    expect(profile.email).toBe('me@example.com');
    expect(profile.plan_type).toBe('pro');
  });

  it('hasProfile returns false before creation and true after', () => {
    const reg = new CodexProfileRegistry(registryPath);
    expect(reg.hasProfile('work')).toBe(false);
    reg.createProfile('work');
    expect(reg.hasProfile('work')).toBe(true);
  });
});

describe('CodexProfileRegistry — remove', () => {
  it('removes an existing profile', () => {
    const reg = new CodexProfileRegistry(registryPath);
    reg.createProfile('work');
    reg.removeProfile('work');
    expect(reg.listProfiles()).toEqual([]);
  });

  it('throws when removing a non-existent profile', () => {
    const reg = new CodexProfileRegistry(registryPath);
    expect(() => reg.removeProfile('ghost')).toThrow(/not found/i);
  });

  it('clears default when the default profile is removed', () => {
    const reg = new CodexProfileRegistry(registryPath);
    reg.createProfile('work');
    reg.setDefault('work');
    expect(reg.getDefault()).toBe('work');
    reg.removeProfile('work');
    expect(reg.getDefault()).toBeNull();
  });
});

describe('CodexProfileRegistry — default pointer', () => {
  it('setDefault throws when profile does not exist', () => {
    const reg = new CodexProfileRegistry(registryPath);
    expect(() => reg.setDefault('ghost')).toThrow(/not found/i);
  });

  it('setDefault and getDefault round-trip', () => {
    const reg = new CodexProfileRegistry(registryPath);
    reg.createProfile('work');
    reg.setDefault('work');
    expect(reg.getDefault()).toBe('work');
  });

  it('clearDefault resets default to null', () => {
    const reg = new CodexProfileRegistry(registryPath);
    reg.createProfile('work');
    reg.setDefault('work');
    reg.clearDefault();
    expect(reg.getDefault()).toBeNull();
  });
});

describe('CodexProfileRegistry — listProfiles', () => {
  it('returns all profile names', () => {
    const reg = new CodexProfileRegistry(registryPath);
    reg.createProfile('work');
    reg.createProfile('personal');
    const list = reg.listProfiles();
    expect(list).toContain('work');
    expect(list).toContain('personal');
    expect(list.length).toBe(2);
  });
});

describe('CodexProfileRegistry — corrupt YAML recovery', () => {
  it('returns empty state on corrupt YAML without throwing', () => {
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(registryPath, '{ invalid: yaml: content: [', { mode: 0o600 });
    const reg = new CodexProfileRegistry(registryPath);
    expect(reg.listProfiles()).toEqual([]);
    expect(reg.getDefault()).toBeNull();
  });
});

describe('CodexProfileRegistry — atomic write', () => {
  it('leaves no .tmp file after successful write', () => {
    const reg = new CodexProfileRegistry(registryPath);
    reg.createProfile('work');
    const dir = path.dirname(registryPath);
    const tmpFiles = fs.readdirSync(dir).filter((f) => f.includes('.tmp.'));
    expect(tmpFiles.length).toBe(0);
  });
});

describe('CodexProfileRegistry — touchProfile', () => {
  it('updates last_used timestamp', async () => {
    const reg = new CodexProfileRegistry(registryPath);
    reg.createProfile('work');
    const before = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    reg.touchProfile('work');
    const profile = reg.getProfile('work');
    expect(typeof profile.last_used).toBe('string');
    expect((profile.last_used as string) >= before).toBe(true);
  });
});

describe('CodexProfileRegistry — updateProfile', () => {
  it('merges partial updates into existing profile', () => {
    const reg = new CodexProfileRegistry(registryPath);
    reg.createProfile('work');
    reg.updateProfile('work', { email: 'updated@example.com', plan_type: 'plus' });
    const profile = reg.getProfile('work');
    expect(profile.email).toBe('updated@example.com');
    expect(profile.plan_type).toBe('plus');
    expect(profile.type).toBe('codex');
  });

  it('throws when updating a non-existent profile', () => {
    const reg = new CodexProfileRegistry(registryPath);
    expect(() => reg.updateProfile('ghost', { email: 'x@x.com' })).toThrow(/not found/i);
  });
});

describe('CodexProfileRegistry — registry file permissions', () => {
  it('writes registry file with mode 0o600', () => {
    const reg = new CodexProfileRegistry(registryPath);
    reg.createProfile('work');
    const stat = fs.statSync(registryPath);
    // On POSIX, check owner read/write only (0o600 = 0b110_000_000 = 384)
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

describe('CodexProfileRegistry — write lock', () => {
  it('serializes read-modify-write mutations through a registry lock', () => {
    const release = () => {};
    const lockSpy = spyOn(lockfile, 'lockSync').mockReturnValue(release);
    const reg = new CodexProfileRegistry(registryPath);

    reg.createProfile('work');

    expect(lockSpy).toHaveBeenCalled();
    const [lockTarget, options] = lockSpy.mock.calls[0] ?? [];
    expect(lockTarget).toBe(path.dirname(registryPath));
    expect(options).toMatchObject({ stale: 10000 });
  });

  it('waits for a contended registry lock before writing', async () => {
    const registryDir = path.dirname(registryPath);
    const readyPath = path.join(tempDir, 'holder-ready');
    const holderScript = path.join(tempDir, 'hold-registry-lock.cjs');
    fs.writeFileSync(
      holderScript,
      `
const fs = require('fs');
const lockfile = require(process.argv[4]);
const release = lockfile.lockSync(process.argv[2], { stale: 10000 });
fs.writeFileSync(process.argv[3], String(process.pid));
setTimeout(() => {
  release();
  process.exit(0);
}, 150);
setTimeout(() => process.exit(2), 5000);
process.on('SIGTERM', () => {
  try { release(); } finally { process.exit(0); }
});
`,
      'utf8'
    );

    const child = spawn(
      process.execPath,
      [
        holderScript,
        registryDir,
        readyPath,
        path.join(process.cwd(), 'node_modules', 'proper-lockfile'),
      ],
      {
        cwd: process.cwd(),
        stdio: ['ignore', 'ignore', 'pipe'],
      }
    );

    try {
      await waitForFile(readyPath);

      const reg = new CodexProfileRegistry(registryPath);
      reg.createProfile('work');

      expect(reg.hasProfile('work')).toBe(true);
    } finally {
      if (!child.killed) child.kill();
      await waitForChildExit(child);
    }
  });
});

async function waitForFile(filePath: string, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForChildExit(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => child.once('exit', () => resolve()));
}
