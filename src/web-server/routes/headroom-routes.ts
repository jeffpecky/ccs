import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

import type { CLIProxyTokenSaverConfig } from '../../config/unified-config-types';
import { getCachedConfig, mutateConfig } from '../../config/config-loader-facade';
import { regenerateConfigWithRollback } from '../../cliproxy/config/generator';
import {
  getHeadroomEndpoint,
  getHeadroomStatus,
  installHeadroom,
  restartHeadroom,
  startHeadroom,
  stopHeadroom,
} from '../../headroom/service';
import { requireLocalAccessWhenAuthDisabled } from '../middleware/auth-middleware';

const HEADROOM_TOKEN_ENV = 'HEADROOM_PROXY_TOKEN';
let configTransactionQueue: Promise<void> = Promise.resolve();

function serializeConfigTransaction<T>(operation: () => Promise<T>): Promise<T> {
  const result = configTransactionQueue.then(operation, operation);
  configTransactionQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export interface HeadroomRouterDeps {
  enforceAccess(req: Request, res: Response): boolean;
  getTokenSaverConfig(): CLIProxyTokenSaverConfig;
  saveTokenSaverConfig(config: CLIProxyTokenSaverConfig): void | Promise<void>;
  regenerateConfig(
    config: CLIProxyTokenSaverConfig
  ): void | (() => void) | Promise<void | (() => void)>;
  getStatus(url: string): Promise<unknown>;
  start(options: Parameters<typeof startHeadroom>[0]): ReturnType<typeof startHeadroom>;
  stop(): ReturnType<typeof stopHeadroom>;
  restart(options: Parameters<typeof restartHeadroom>[0]): ReturnType<typeof restartHeadroom>;
  install(extras?: string[]): ReturnType<typeof installHeadroom>;
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
    return regenerateConfigWithRollback(undefined, { tokenSaver: next });
  },
  getStatus: getHeadroomStatus,
  start: startHeadroom,
  stop: stopHeadroom,
  restart: restartHeadroom,
  install: installHeadroom,
};

function normalizeConfig(input: unknown): CLIProxyTokenSaverConfig | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as CLIProxyTokenSaverConfig;
  return {
    enabled: value.enabled === true,
    rtk: value.rtk === true,
    caveman: {
      enabled: value.caveman?.enabled === true,
      level: typeof value.caveman?.level === 'string' ? value.caveman.level : 'standard',
    },
    ponytail: {
      enabled: value.ponytail?.enabled === true,
      level: typeof value.ponytail?.level === 'string' ? value.ponytail.level : 'standard',
    },
    headroom: {
      enabled: value.headroom?.enabled === true,
      url: typeof value.headroom?.url === 'string' ? value.headroom.url : '',
      mode: value.headroom?.mode === 'external' ? 'external' : 'local',
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

    await serializeConfigTransaction(async () => {
      let rollbackRuntime: void | (() => void) = undefined;
      try {
        rollbackRuntime = await deps.regenerateConfig(next);
        await deps.saveTokenSaverConfig(next);
        res.json({ success: true, config: next });
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
      }
    });
  });

  router.get('/status', async (_req, res) => {
    const headroom = getConfig().headroom;
    if (headroom?.mode === 'external') {
      res.json({
        configured: true,
        external: true,
        local: false,
        managed: false,
        running: false,
        healthy: null,
        health: 'unknown',
      });
      return;
    }
    const url = headroom?.url ?? 'http://127.0.0.1:8787';
    try {
      getHeadroomEndpoint(url);
    } catch {
      res.json({
        configured: true,
        external: false,
        local: true,
        managed: false,
        running: false,
        healthy: false,
        health: 'invalid-config',
        error: 'Invalid local Headroom URL.',
      });
      return;
    }
    res.json(await deps.getStatus(url));
  });

  async function lifecycle(action: 'start' | 'stop' | 'restart', res: Response): Promise<void> {
    const headroom = getConfig().headroom;
    if (!headroom || headroom.mode !== 'local') {
      res
        .status(400)
        .json({ success: false, error: 'External Headroom cannot be managed by CCS.' });
      return;
    }
    try {
      const { port } = getHeadroomEndpoint(headroom.url ?? '');
      const options = {
        port,
        codeAware: headroom.code_aware ?? false,
        kompress: headroom.kompress ?? true,
      };
      const result =
        action === 'start'
          ? await deps.start(options)
          : action === 'restart'
            ? await deps.restart(options)
            : await deps.stop();
      res.status(result.success ? 200 : 500).json(result);
    } catch {
      res.status(500).json({ error: 'Headroom lifecycle operation failed.' });
    }
  }

  router.post('/start', (_req, res) => lifecycle('start', res));
  router.post('/stop', (_req, res) => lifecycle('stop', res));
  router.post('/restart', (_req, res) => lifecycle('restart', res));

  router.post('/install', async (req: Request, res: Response) => {
    const extras = Array.isArray(req.body?.extras) ? req.body.extras : undefined;
    try {
      const result = await deps.install(extras);
      res.status(result.success ? 200 : 500).json(result);
    } catch {
      res.status(500).json({ success: false, error: 'Headroom installation failed.' });
    }
  });

  return router;
}

export default createHeadroomRouter();
