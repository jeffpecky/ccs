import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as browserInstaller from '../../../../src/utils/browser/mcp-installer';
import {
  ensureBrowserMcpConfig,
  ensureBrowserMcpOrThrow,
  getBrowserMcpServerName,
  getBrowserMcpServerPath,
  syncBrowserMcpToConfigDir,
} from '../../../../src/utils/browser';

describe('ensureBrowserMcp', () => {
  let tempHome: string | undefined;
  let originalCcsHome: string | undefined;

  function setupTempHome(): string {
    const nextTempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-browser-mcp-'));
    tempHome = nextTempHome;
    originalCcsHome = process.env.CCS_HOME;
    process.env.CCS_HOME = nextTempHome;
    return nextTempHome;
  }

  function getManagedConfig() {
    return {
      type: 'stdio',
      command: 'node',
      args: [getBrowserMcpServerPath()],
      env: {
        NODE_PATH: path.join(process.cwd(), 'node_modules'),
      },
    };
  }

  afterEach(() => {
    mock.restore();

    if (originalCcsHome !== undefined) {
      process.env.CCS_HOME = originalCcsHome;
    } else {
      delete process.env.CCS_HOME;
    }

    if (tempHome && fs.existsSync(tempHome)) {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }

    tempHome = undefined;
    originalCcsHome = undefined;
  });

  // NOTE: test cases that asserted the bundled lib/mcp/ccs-browser-server.cjs
  // artifact were removed; the artifact was deleted by commit 28fe9b08.

  // NOTE: skipped on win32 because POSIX mode bits are not enforced on NTFS
  // (Windows reports 0o666 for the config file).
  it.skipIf(process.platform === 'win32')('preserves the existing ~/.claude.json permissions when provisioning browser MCP', () => {
    setupTempHome();

    const claudeUserConfigPath = path.join(tempHome as string, '.claude.json');
    fs.writeFileSync(claudeUserConfigPath, JSON.stringify({ existing: true }, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.chmodSync(claudeUserConfigPath, 0o600);

    expect(ensureBrowserMcpConfig()).toBe(true);
    expect(fs.statSync(claudeUserConfigPath).mode & 0o777).toBe(0o600);
  });

  it('syncs the managed browser MCP entry into an instance config dir', () => {
    setupTempHome();

    fs.writeFileSync(
      path.join(tempHome as string, '.claude.json'),
      JSON.stringify(
        {
          mcpServers: {
            [getBrowserMcpServerName()]: getManagedConfig(),
          },
        },
        null,
        2
      ) + '\n',
      'utf8'
    );

    const instancePath = path.join(tempHome as string, '.ccs', 'instances', 'work');
    fs.mkdirSync(instancePath, { recursive: true });

    expect(syncBrowserMcpToConfigDir(instancePath)).toBe(true);

    const instanceConfig = JSON.parse(
      fs.readFileSync(path.join(instancePath, '.claude.json'), 'utf8')
    ) as {
      mcpServers: Record<string, unknown>;
    };
    expect(instanceConfig.mcpServers[getBrowserMcpServerName()]).toEqual(getManagedConfig());
  });

  it('throws when the bundled browser MCP runtime cannot be prepared', () => {
    setupTempHome();

    const ensureSpy = spyOn(browserInstaller, 'ensureBrowserMcp').mockReturnValue(false);

    expect(() => ensureBrowserMcpOrThrow()).toThrow(
      'Browser MCP is enabled, but CCS could not prepare the local browser tool.'
    );
    expect(ensureSpy).toHaveBeenCalled();
  });
});
