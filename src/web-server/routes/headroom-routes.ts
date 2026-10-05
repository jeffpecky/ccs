import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

import type { CLIProxyTokenSaverConfig } from '../../config/unified-config-types';
import { getCachedConfig, mutateConfig } from '../../config/config-loader-facade';
import { regenerateConfigWithRollback } from '../../cliproxy/config/generator';
import { resolveLifecyclePort } from '../../cliproxy/config/port-manager';
import {
  buildManagementHeaders,
  buildProxyUrl,
  getProxyTarget,
} from '../../cliproxy/proxy/proxy-target-resolver';
import { getHeadroomEndpoint, isLoopbackHeadroomUrl } from '../../headroom/service';
import { requireLocalAccessWhenAuthDisabled } from '../middleware/auth-middleware';

const HEADROOM_TOKEN_ENV = 'HEADROOM_PROXY_TOKEN';

// Upstream cavemanPrompt()/ponytailPrompt() return "" for unknown levels and
// the injectors silently no-op — anything outside this set is a dead saver.
const PROMPT_LEVELS = new Set(['lite', 'full', 'ultra']);

// CLIProxyAPIPlus reloads config.yaml via fsnotify with a 150ms debounce
// (internal/watcher) and swaps handler config in management SetConfig; wait
// longer than that before acting on freshly written spawn flags.
const HEADROOM_RESTART_DELAY_MS = 700;

let configTransactionQueue: Promise<void> = Promise.resolve();

function serializeConfigTransaction<T>(operation: () => Promise<T>): Promise<T> {
  const result = configTransactionQueue.then(operation, operation);
  configTransactionQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export type ManagementProxy = (
  method: string,
  managementPath: string,
  body?: unknown
) => Promise<{ status: number; data: unknown }>;

async function proxyToCliproxy(
  method: string,
  managementPath: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const target = getProxyTarget();
  const url = buildProxyUrl(target, managementPath);
  const headers = buildManagementHeaders(target, { 'Content-Type': 'application/json' });
  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

export interface HeadroomRouterDeps {
  enforceAccess(req: Request, res: Response): boolean;
  getTokenSaverConfig(): CLIProxyTokenSaverConfig;
  saveTokenSaverConfig(config: CLIProxyTokenSaverConfig): void | Promise<void>;
  regenerateConfig(
    config: CLIProxyTokenSaverConfig
  ): void | (() => void) | Promise<void | (() => void)>;
  proxyManagement?: ManagementProxy;
  headroomRestartDelayMs?: number;
}

const defaultDeps: HeadroomRouterDeps = {
  enforceAccess: (req, res) =>
    requireLocalAccessWhenAuthDisabled(
      req,
      res,
      'Headroom controls require localhost access when dashboard auth is disabled.'
    ),
  getTokenSaverConfig: () => getCachedConfig().cliproxy.token_saver ?? {},
  saveTokenSaverConfig: (next) => {
    mutateConfig((config) => {
      config.cliproxy.token_saver = next;
    });
  },
  regenerateConfig: (next) => {
    return regenerateConfigWithRollback(resolveLifecyclePort(), { tokenSaver: next });
  },
};

function normalizeConfig(input: unknown): CLIProxyTokenSaverConfig | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as CLIProxyTokenSaverConfig;
  const url = typeof value.headroom?.url === 'string' ? value.headroom.url : '';
  const normalizeLevel = (level: unknown): string =>
    typeof level === 'string' && PROMPT_LEVELS.has(level) ? level : 'full';
  return {
    enabled: value.enabled === true,
    rtk: value.rtk === true,
    caveman: {
      enabled: value.caveman?.enabled === true,
      level: normalizeLevel(value.caveman?.level),
    },
    ponytail: {
      enabled: value.ponytail?.enabled === true,
      level: normalizeLevel(value.ponytail?.level),
    },
    headroom: {
      enabled: value.headroom?.enabled === true,
      url,
      // Derived from the URL: a non-loopback endpoint is remote and must not
      // be spawned/stopped locally. An unset URL keeps the loopback default.
      mode: url !== '' && !isLoopbackHeadroomUrl(url) ? 'external' : 'local',
      timeout_ms: value.headroom?.timeout_ms,
      compress_user_messages: value.headroom?.compress_user_messages === true,
      token_env: HEADROOM_TOKEN_ENV,
      code_aware: value.headroom?.code_aware === true,
      kompress: value.headroom?.kompress !== false,
    },
    pxpipe: {
      enabled: value.pxpipe?.enabled === true,
      min_chars: value.pxpipe?.min_chars,
      timeout_ms: value.pxpipe?.timeout_ms,
    },
  };
}

function validHttpBase(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function validInteger(value: unknown, minimum: number, maximum: number): value is number {
  return (
    Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
  );
}

export function createHeadroomRouter(deps: HeadroomRouterDeps = defaultDeps) {
  const router = Router();
  const getConfig = () => normalizeConfig(deps.getTokenSaverConfig()) ?? {};
  const proxy: ManagementProxy = (method, managementPath, body) =>
    (deps.proxyManagement ?? proxyToCliproxy)(method, managementPath, body);

  // Restart a running managed Headroom so it picks up new spawn flags from
  // the reloaded config. Skips (returns false) when Headroom is not running
  // under the local management API — never fails the config save itself.
  const restartManagedHeadroom = async (): Promise<boolean> => {
    const delay = deps.headroomRestartDelayMs ?? HEADROOM_RESTART_DELAY_MS;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    try {
      const { data } = await proxy('GET', '/v0/management/headroom/status');
      const status = data as { running?: boolean; managed?: boolean } | null;
      if (status?.running !== true || status?.managed !== true) return false;
      const { status: restartStatus } = await proxy(
        'POST',
        '/v0/management/headroom/restart'
      );
      return restartStatus >= 200 && restartStatus < 300;
    } catch {
      return false;
    }
  };

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (deps.enforceAccess(req, res)) next();
  });

  router.get('/config', (_req, res) => res.json({ config: getConfig() }));

  router.put('/config', async (req: Request, res: Response) => {
    const supplied = req.body as CLIProxyTokenSaverConfig | null;
    if (supplied?.headroom?.token_env && supplied.headroom.token_env !== HEADROOM_TOKEN_ENV) {
      res.status(400).json({ error: 'Headroom token environment is fixed.' });
      return;
    }
    const next = normalizeConfig(supplied);
    const headroom = next?.headroom;
    if (
      !next ||
      !headroom ||
      !validHttpBase(headroom.url ?? '') ||
      !validInteger(headroom.timeout_ms, 100, 60_000) ||
      !validInteger(next.pxpipe?.min_chars, 1, Number.MAX_SAFE_INTEGER) ||
      !validInteger(next.pxpipe?.timeout_ms, 100, 60_000)
    ) {
      res.status(400).json({ error: 'Invalid token saver configuration.' });
      return;
    }
    if (headroom.mode === 'local') {
      try {
        getHeadroomEndpoint(headroom.url ?? '');
      } catch {
        res.status(400).json({ error: 'Local Headroom mode requires a loopback HTTP origin.' });
        return;
      }
    }

    // code-aware/kompress only take effect via Headroom spawn flags, so a
    // change to either requires a restart of a running managed instance.
    const previous = normalizeConfig(deps.getTokenSaverConfig());
    const spawnFlagsChanged =
      previous?.headroom?.code_aware !== headroom.code_aware ||
      previous?.headroom?.kompress !== headroom.kompress;

    await serializeConfigTransaction(async () => {
      let rollbackRuntime: void | (() => void) = undefined;
      try {
        rollbackRuntime = await deps.regenerateConfig(next);
        await deps.saveTokenSaverConfig(next);
      } catch {
        if (rollbackRuntime) {
          try {
            rollbackRuntime();
          } catch {
            res.status(500).json({
              error:
                'Partial configuration failure: unified config save and runtime rollback failed.',
            });
            return;
          }
        }
        res.status(500).json({ error: 'Failed to update Token Saver configuration.' });
        return;
      }

      let headroomRestarted = false;
      if (spawnFlagsChanged) {
        headroomRestarted = await restartManagedHeadroom();
      }
      res.json({
        success: true,
        config: next,
        ...(headroomRestarted ? { headroomRestarted: true } : {}),
      });
    });
  });

  // Lifecycle start/stop/restart must never target a remote endpoint: the
  // upstream management start handler would spawn a local process anyway.
  const refuseExternalLifecycle = (config: ReturnType<typeof getConfig>): boolean =>
    config.headroom?.mode !== 'local';

  router.post('/start', async (_req, res) => {
    if (refuseExternalLifecycle(getConfig())) {
      res.status(400).json({ error: 'External Headroom endpoints are not managed locally.' });
      return;
    }
    try {
      const { status, data } = await proxy('POST', '/v0/management/headroom/start');
      res.status(status).json(data);
    } catch (error) {
      res.status(502).json({ error: `Headroom start failed: ${(error as Error).message}` });
    }
  });

  router.post('/stop', async (_req, res) => {
    if (refuseExternalLifecycle(getConfig())) {
      res.status(400).json({ error: 'External Headroom endpoints are not managed locally.' });
      return;
    }
    try {
      const { status, data } = await proxy('POST', '/v0/management/headroom/stop');
      res.status(status).json(data);
    } catch (error) {
      res.status(502).json({ error: `Headroom stop failed: ${(error as Error).message}` });
    }
  });

  router.post('/restart', async (_req, res) => {
    if (refuseExternalLifecycle(getConfig())) {
      res.status(400).json({ error: 'External Headroom endpoints are not managed locally.' });
      return;
    }
    try {
      const { status, data } = await proxy('POST', '/v0/management/headroom/restart');
      res.status(status).json(data);
    } catch (error) {
      res.status(502).json({ error: `Headroom restart failed: ${(error as Error).message}` });
    }
  });

  // All Headroom lifecycle operations proxy to CLIProxyAPIPlusNEW's management API.
  // CLIProxyAPIPlusNEW runs on the same machine where Headroom needs to be installed,
  // regardless of whether CCS is local or remote.

  router.get('/status', async (_req, res) => {
    try {
      const { status, data } = await proxy('GET', '/v0/management/headroom/status');
      res.status(status).json(data);
    } catch {
      // CLIProxyAPIPlusNEW not reachable — return offline status instead of error
      res.json({
        installed: false,
        running: false,
        healthy: false,
        managed: false,
        url: '',
      });
    }
  });

  router.post('/install', async (req: Request, res: Response) => {
    try {
      const { status, data } = await proxy('POST', '/v0/management/headroom/install', req.body);
      res.status(status).json(data);
    } catch (error) {
      res.status(502).json({ error: `Headroom install failed: ${(error as Error).message}` });
    }
  });

  // Extras management — detect, install, uninstall compression extras (code, ml)

  router.get('/extras', async (req: Request, res: Response) => {
    try {
      const logParam = req.query.log === '1' ? '?log=1' : '';
      const { status, data } = await proxy(
        'GET',
        `/v0/management/headroom/extras${logParam}`
      );
      res.status(status).json(data);
    } catch {
      // CLIProxyAPIPlus not reachable — return default status
      res.json({ installed: false, version: null, extras: { code: false, ml: false } });
    }
  });

  router.post('/extras/install', async (req: Request, res: Response) => {
    try {
      const { status, data } = await proxy(
        'POST',
        '/v0/management/headroom/extras/install',
        req.body
      );
      res.status(status).json(data);
    } catch (error) {
      res.status(502).json({ error: `Extras install failed: ${(error as Error).message}` });
    }
  });

  router.post('/extras/uninstall/:extra', async (req: Request, res: Response) => {
    try {
      const { status, data } = await proxy(
        'POST',
        `/v0/management/headroom/extras/uninstall/${req.params.extra}`
      );
      res.status(status).json(data);
    } catch (error) {
      res.status(502).json({ error: `Extras uninstall failed: ${(error as Error).message}` });
    }
  });

  return router;
}

export default createHeadroomRouter();
