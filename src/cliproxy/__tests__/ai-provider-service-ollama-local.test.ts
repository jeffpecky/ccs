import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

function getCliproxyConfigPath(homeDir: string): string {
  return path.join(homeDir, '.ccs', 'cliproxy', 'config.yaml');
}

function writeCliproxyConfig(homeDir: string, value: Record<string, unknown>): void {
  const configPath = getCliproxyConfigPath(homeDir);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, yaml.dump(value), 'utf8');
}

function readCliproxyConfig(homeDir: string): Record<string, any> {
  return (
    (yaml.load(fs.readFileSync(getCliproxyConfigPath(homeDir), 'utf8')) as Record<string, any>) ||
    {}
  );
}

async function loadAiProviderService() {
  return import(`../ai-providers/service?ollama-local=${Date.now()}`);
}

describe('ollama-local keyless provider family', () => {
  let tempHome = '';
  let originalCcsHome: string | undefined;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-ollama-local-'));
    originalCcsHome = process.env.CCS_HOME;
    process.env.CCS_HOME = tempHome;
    writeCliproxyConfig(tempHome, {});
  });

  afterEach(() => {
    if (originalCcsHome !== undefined) {
      process.env.CCS_HOME = originalCcsHome;
    } else {
      delete process.env.CCS_HOME;
    }

    if (tempHome && fs.existsSync(tempHome)) {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('lists ollama entries as configured without an api key', async () => {
    const { listAiProviders } = await loadAiProviderService();

    writeCliproxyConfig(tempHome, {
      'ollama-local-api-key': [{ 'base-url': 'http://192.168.1.20:11434' }],
    });

    const listed = await listAiProviders();
    const family = listed.families.find((entry) => entry.id === 'ollama-local-api-key');

    expect(family).toBeDefined();
    expect(family?.authMode).toBe('none');
    expect(family?.status).toBe('ready');
    expect(family?.entries).toHaveLength(1);
    expect(family?.entries[0]?.secretConfigured).toBe(true);
    expect(family?.entries[0]?.baseUrl).toContain('192.168.1.20:11434');
  });

  it('creates keyless entries with only a base url', async () => {
    const { createAiProviderEntry, listAiProviders } = await loadAiProviderService();

    await createAiProviderEntry('ollama-local-api-key', {
      baseUrl: 'http://192.168.1.20:11434',
    });

    const persisted = readCliproxyConfig(tempHome)['ollama-local-api-key'] as Array<
      Record<string, unknown>
    >;
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.['base-url']).toBe('http://192.168.1.20:11434');
    expect(persisted[0]?.id).toBeTruthy();

    const listed = await listAiProviders();
    const family = listed.families.find((entry) => entry.id === 'ollama-local-api-key');
    expect(family?.status).toBe('ready');
  });

  it('rejects ollama entries without a base url', async () => {
    const { createAiProviderEntry } = await loadAiProviderService();

    await expect(createAiProviderEntry('ollama-local-api-key', {})).rejects.toThrow(
      'baseUrl is required'
    );

    const persisted = readCliproxyConfig(tempHome)['ollama-local-api-key'];
    expect(persisted).toBeUndefined();
  });

  it('still requires an api key for keyful families', async () => {
    const { createAiProviderEntry } = await loadAiProviderService();

    await expect(createAiProviderEntry('nvidia-api-key', {})).rejects.toThrow('apiKey is required');
  });

  it('updates and deletes ollama entries by stable id', async () => {
    const { updateAiProviderEntry, deleteAiProviderEntry } = await loadAiProviderService();

    writeCliproxyConfig(tempHome, {
      'ollama-local-api-key': [
        { 'base-url': 'http://host-a:11434', id: 'ollama-local-a' },
        { 'base-url': 'http://host-b:11434', id: 'ollama-local-b' },
      ],
    });

    await updateAiProviderEntry('ollama-local-api-key', 'ollama-local-a', {
      baseUrl: 'http://host-a-updated:11434',
      preserveSecrets: true,
    });

    let persisted = readCliproxyConfig(tempHome)['ollama-local-api-key'] as Array<
      Record<string, unknown>
    >;
    expect(persisted[0]?.id).toBe('ollama-local-a');
    expect(persisted[0]?.['base-url']).toBe('http://host-a-updated:11434');

    await deleteAiProviderEntry('ollama-local-api-key', 'ollama-local-a');

    persisted = readCliproxyConfig(tempHome)['ollama-local-api-key'] as Array<
      Record<string, unknown>
    >;
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.id).toBe('ollama-local-b');
  });
});
