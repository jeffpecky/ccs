import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { invalidateConfigCache, mutateConfig } from '../../../config/config-loader-facade';
import { regenerateConfig } from '../generator';

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env.CCS_HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-relay-generator-'));
  process.env.CCS_HOME = home;
  invalidateConfigCache();
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.CCS_HOME;
  else process.env.CCS_HOME = previousHome;
  fs.rmSync(home, { recursive: true, force: true });
});

describe('relay-url generation', () => {
  it('emits relay-url: <active relay url> when a relay is active', () => {
    mutateConfig((config) => {
      config.relay = {
        relays: [
          {
            id: 'r1',
            name: 'n',
            platform: 'cloudflare',
            url: 'https://my.workers.dev',
            createdAt: 'x',
          },
        ],
        activeId: 'r1',
      };
    });

    const configPath = path.join(home, 'runtime.yaml');
    regenerateConfig(8317, { configPath, authDir: path.join(home, 'auth') });
    const yaml = fs.readFileSync(configPath, 'utf8');

    expect(yaml).toContain('relay-url: "https://my.workers.dev"');
  });

  it('emits an empty relay-url when no relay is active', () => {
    mutateConfig((config) => {
      config.relay = { relays: [], activeId: null };
    });

    const configPath = path.join(home, 'runtime.yaml');
    regenerateConfig(8317, { configPath, authDir: path.join(home, 'auth') });
    const yaml = fs.readFileSync(configPath, 'utf8');

    // Inactive must serialize as an EMPTY YAML string (the generator's
    // quoteYamlString is JSON.stringify, so `""`) — never a stale URL —
    // so the Go side reads it as "no relay".
    expect(yaml).toContain('relay-url: ""');
    expect(yaml).not.toContain('my.workers.dev');
  });
});
