import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadMigrationCheckData,
  migrate,
  resolveManagedBackupPath,
  rollback,
} from '../../../src/config/migration-manager';
import { loadUnifiedConfig, saveUnifiedConfig } from '../../../src/config/unified-config-loader';
import { createEmptyUnifiedConfig } from '../../../src/config/unified-config-types';

describe('migration-manager legacy kimi compatibility', () => {
  let tempHome: string;
  let ccsDir: string;
  let originalCcsHome: string | undefined;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-migration-manager-test-'));
    originalCcsHome = process.env.CCS_HOME;
    process.env.CCS_HOME = tempHome;
    ccsDir = path.join(tempHome, '.ccs');
    fs.mkdirSync(ccsDir, { recursive: true });
  });

  afterEach(() => {
    if (originalCcsHome !== undefined) {
      process.env.CCS_HOME = originalCcsHome;
    } else {
      delete process.env.CCS_HOME;
    }

    if (fs.existsSync(tempHome)) {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('prefers explicit canonical km profile over legacy kimi when both exist', async () => {
    const kmSettingsPath = path.join(ccsDir, 'km.settings.json');
    const kimiSettingsPath = path.join(ccsDir, 'kimi.settings.json');

    fs.writeFileSync(kmSettingsPath, JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'sk-km' } }));
    fs.writeFileSync(
      kimiSettingsPath,
      JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'sk-kimi' } })
    );

    // Intentionally place legacy alias first to verify deterministic behavior.
    fs.writeFileSync(
      path.join(ccsDir, 'config.json'),
      JSON.stringify(
        {
          profiles: {
            kimi: kimiSettingsPath,
            km: kmSettingsPath,
          },
        },
        null,
        2
      )
    );

    const result = await migrate(true);

    expect(result.success).toBe(true);
    expect(
      result.migratedFiles.some((entry) =>
        entry.includes(
          `config.json.profiles.km → config.yaml.profiles.km (settings: ${kmSettingsPath})`
        )
      )
    ).toBe(true);
    expect(
      result.migratedFiles.some((entry) => entry.includes(`(settings: ${kimiSettingsPath})`))
    ).toBe(false);
    expect(
      result.warnings.some((warning) =>
        warning.includes(
          'Skipped kimi: canonical profile "km" exists in config.json with different settings'
        )
      )
    ).toBe(true);
  });

  it('renames case-variant legacy Kimi profile key to km', async () => {
    const kimiSettingsPath = path.join(ccsDir, 'kimi.settings.json');
    fs.writeFileSync(
      kimiSettingsPath,
      JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'sk-kimi-case-variant' } })
    );

    fs.writeFileSync(
      path.join(ccsDir, 'config.json'),
      JSON.stringify(
        {
          profiles: {
            Kimi: kimiSettingsPath,
          },
        },
        null,
        2
      )
    );

    const result = await migrate(true);

    expect(result.success).toBe(true);
    expect(
      result.migratedFiles.some((entry) =>
        entry.includes('config.json.profiles.Kimi → config.yaml.profiles.km')
      )
    ).toBe(true);
  });

  it('treats legacy kimi profile as migrated when unified config already has km', () => {
    const unifiedConfig = createEmptyUnifiedConfig();
    unifiedConfig.profiles.km = {
      type: 'api',
      settings: '~/.ccs/km.settings.json',
    };
    saveUnifiedConfig(unifiedConfig);

    fs.writeFileSync(
      path.join(ccsDir, 'config.json'),
      JSON.stringify(
        {
          profiles: {
            kimi: '~/.ccs/kimi.settings.json',
          },
        },
        null,
        2
      )
    );

    const checkData = loadMigrationCheckData();
    expect(checkData.needsMigration).toBe(false);
  });

  it('migrates account context metadata from profiles.json', async () => {
    fs.writeFileSync(
      path.join(ccsDir, 'profiles.json'),
      JSON.stringify(
        {
          default: 'work',
          profiles: {
            work: {
              type: 'account',
              created: '2026-02-01T00:00:00.000Z',
              last_used: null,
              context_mode: 'shared',
              context_group: 'sprint-a',
            },
            personal: {
              type: 'account',
              created: '2026-02-02T00:00:00.000Z',
              last_used: null,
            },
          },
        },
        null,
        2
      )
    );

    const result = await migrate(false);
    expect(result.success).toBe(true);

    const unified = loadUnifiedConfig();
    expect(unified).toBeTruthy();
    expect(unified?.accounts.work.context_mode).toBe('shared');
    expect(unified?.accounts.work.context_group).toBe('sprint-a');
    expect(unified?.accounts.work.continuity_mode).toBe('standard');
    expect(unified?.accounts.personal.context_mode).toBe('isolated');
    expect(unified?.accounts.personal.context_group).toBeUndefined();
    expect(unified?.accounts.personal.continuity_mode).toBeUndefined();
  });

  it('migrates legacy bare accounts to profile-local shared resource mode', async () => {
    fs.writeFileSync(
      path.join(ccsDir, 'profiles.json'),
      JSON.stringify(
        {
          default: 'sandbox',
          profiles: {
            sandbox: {
              type: 'account',
              created: '2026-02-01T00:00:00.000Z',
              last_used: null,
              bare: true,
            },
            restored: {
              type: 'account',
              created: '2026-02-02T00:00:00.000Z',
              last_used: null,
              shared_resource_mode: 'shared',
              bare: true,
            },
          },
        },
        null,
        2
      )
    );

    const result = await migrate(false);
    expect(result.success).toBe(true);

    const unified = loadUnifiedConfig();
    expect(unified?.accounts.sandbox.shared_resource_mode).toBe('profile-local');
    expect(unified?.accounts.sandbox.bare).toBe(true);
    expect(unified?.accounts.restored.shared_resource_mode).toBe('shared');
    expect(unified?.accounts.restored.bare).toBeUndefined();
  });

  it('applies safe browser defaults when migrating legacy config files', async () => {
    fs.writeFileSync(
      path.join(ccsDir, 'config.json'),
      JSON.stringify(
        {
          profiles: {
            glm: '~/.ccs/glm.settings.json',
          },
        },
        null,
        2
      )
    );
    fs.writeFileSync(path.join(ccsDir, 'glm.settings.json'), JSON.stringify({ env: {} }));

    const result = await migrate(false);
    expect(result.success).toBe(true);

    const unified = loadUnifiedConfig();
    expect(unified?.browser).toEqual({
      claude: {
        enabled: false,
        policy: 'manual',
        user_data_dir: '',
        devtools_port: 9222,
        eval_mode: 'readonly',
      },
      codex: {
        enabled: false,
        policy: 'manual',
        eval_mode: 'readonly',
      },
    });
  });

  it('normalizes valid legacy shared groups and drops invalid ones during migration', async () => {
    fs.writeFileSync(
      path.join(ccsDir, 'profiles.json'),
      JSON.stringify(
        {
          default: 'work',
          profiles: {
            work: {
              type: 'account',
              created: '2026-02-01T00:00:00.000Z',
              last_used: null,
              context_mode: 'shared',
              context_group: 'Sprint-A',
            },
            broken: {
              type: 'account',
              created: '2026-02-02T00:00:00.000Z',
              last_used: null,
              context_mode: 'shared',
              context_group: '###',
            },
          },
        },
        null,
        2
      )
    );

    const result = await migrate(false);
    expect(result.success).toBe(true);
    expect(
      result.warnings.some((warning) =>
        warning.includes('Skipped invalid context group for account "broken"')
      )
    ).toBe(true);

    const unified = loadUnifiedConfig();
    expect(unified?.accounts.work.context_group).toBe('sprint-a');
    expect(unified?.accounts.broken.context_mode).toBe('shared');
    expect(unified?.accounts.broken.context_group).toBeUndefined();
    expect(unified?.accounts.work.continuity_mode).toBe('standard');
    expect(unified?.accounts.broken.continuity_mode).toBe('standard');
  });

  // Directory symlinks need privileges that are not granted on standalone
  // Windows (EPERM on fs.symlinkSync); upstream CI ran this test on Linux.
  it.skipIf(process.platform === 'win32')('resolves only direct managed backup directories under ~/.ccs', () => {
    const managedBackupPath = path.join(ccsDir, 'backup-v1-2026-03-24');
    const externalBackupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-backup-external-'));
    const symlinkedBackupPath = path.join(ccsDir, 'backup-v1-symlink');

    fs.mkdirSync(managedBackupPath, { recursive: true });
    fs.symlinkSync(externalBackupPath, symlinkedBackupPath, 'dir');

    expect(resolveManagedBackupPath(managedBackupPath)).toBe(
      fs.realpathSync.native(managedBackupPath)
    );
    expect(resolveManagedBackupPath(externalBackupPath)).toBeNull();
    expect(resolveManagedBackupPath(symlinkedBackupPath)).toBeNull();

    fs.rmSync(externalBackupPath, { recursive: true, force: true });
  });

  it('rejects rollback from directories outside managed CCS backups', async () => {
    const externalBackupPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-backup-invalid-'));

    expect(await rollback(externalBackupPath)).toBe(false);

    fs.rmSync(externalBackupPath, { recursive: true, force: true });
  });

  it('restores files only from managed CCS backup directories', async () => {
    const backupPath = path.join(ccsDir, 'backup-v1-2026-03-24');
    fs.mkdirSync(backupPath, { recursive: true });
    fs.writeFileSync(path.join(backupPath, 'config.json'), JSON.stringify({ restored: true }));
    fs.writeFileSync(path.join(ccsDir, 'config.yaml'), 'version: 8\n');
    fs.mkdirSync(path.join(ccsDir, 'cache'), { recursive: true });
    fs.writeFileSync(path.join(ccsDir, 'cache', 'usage.json'), '{}');

    const success = await rollback(backupPath);

    expect(success).toBe(true);
    expect(fs.existsSync(path.join(ccsDir, 'config.yaml'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(ccsDir, 'config.json'), 'utf8'))).toEqual({
      restored: true,
    });
    expect(fs.existsSync(path.join(ccsDir, 'usage-cache.json'))).toBe(true);
  });
});
