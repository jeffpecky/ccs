/**
 * Relay API routes — list, deploy, test, activate, and delete edge relays.
 *
 * Deployments are one-shot: POST /deploy talks to the platform (Vercel,
 * Cloudflare, Deno Deploy, Netlify) and appends the resulting relay entry to
 * the unified config. The API token is only forwarded to the deploy client —
 * it is never persisted or echoed back. Writes that must not clobber a
 * concurrent writer (deploy append, probe-result persistence) go through the
 * service's updateRelayConfig, which runs a read-modify-write under the
 * config loader's lock.
 *
 * Activation and active-relay deletion also regenerate the runtime
 * config.yaml. Within THIS router those save+regenerate transactions are
 * serialized through a module-level queue so concurrent activate/delete
 * calls cannot interleave their steps. Other routes that regenerate
 * config.yaml (e.g. headroom) are not serialized against this queue —
 * that is pre-existing behavior, out of scope here.
 */

import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

import { RELAY_PLATFORMS } from '../../config/schemas/relay';
import type { RelayConfig, RelayEntry, RelayPlatform } from '../../config/schemas/relay';
import { regenerateConfig } from '../../cliproxy/config/generator';
import { resolveLifecyclePort } from '../../cliproxy/config/port-manager';
import {
  DeployError,
  deployCloudflare,
  deployDeno,
  deployNetlify,
  deployVercel,
} from '../../relay/deploy';
import type { DeployInput, DeployResult } from '../../relay/deploy';
import {
  createRelayEntry,
  getRelayConfig,
  saveRelayConfig,
  testRelay,
  updateRelayConfig,
} from '../../relay/relay-service';
import type { RelayTestResult } from '../../relay/relay-service';
import { requireLocalAccessWhenAuthDisabled } from '../middleware/auth-middleware';
import { createRouteErrorHelpers } from './route-helpers';

let configTransactionQueue: Promise<void> = Promise.resolve();

function serializeConfigTransaction<T>(operation: () => Promise<T>): Promise<T> {
  const result = configTransactionQueue.then(operation, operation);
  configTransactionQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

const DEPLOYERS: Record<RelayPlatform, (input: DeployInput) => Promise<DeployResult>> = {
  vercel: deployVercel,
  cloudflare: deployCloudflare,
  deno: deployDeno,
  netlify: deployNetlify,
};

export interface RelayRouterDeps {
  enforceAccess(req: Request, res: Response): boolean;
  getRelayConfig(): RelayConfig;
  saveRelayConfig(next: RelayConfig): void | Promise<void>;
  updateRelayConfig(update: (current: RelayConfig) => RelayConfig): void;
  regenerateConfig(): void | Promise<void>;
  deployRelay(input: DeployInput & { platform: RelayPlatform }): Promise<DeployResult>;
  testRelay(url: string): Promise<RelayTestResult>;
}

const defaultDeps: RelayRouterDeps = {
  enforceAccess: (req, res) =>
    requireLocalAccessWhenAuthDisabled(
      req,
      res,
      'Relay controls require localhost access when dashboard auth is disabled.'
    ),
  getRelayConfig,
  saveRelayConfig,
  updateRelayConfig,
  regenerateConfig: () => {
    // We save the unified config BEFORE regenerating; a throw here leaves the
    // config file unchanged (the atomic write is the last step), so reverting
    // the unified-config save is sufficient.
    regenerateConfig(resolveLifecyclePort());
  },
  deployRelay: ({ platform, ...input }) => DEPLOYERS[platform](input),
  testRelay,
};

// Names/accounts/domains are interpolated into platform API URLs and project
// slugs, so restrict them to their documented safe character sets.
const RELAY_NAME_PATTERN = /^[a-z0-9-]+$/;
const ACCOUNT_ID_PATTERN = /^[a-zA-Z0-9]+$/;
const ORG_DOMAIN_PATTERN = /^[a-z0-9.-]+$/;

const { logRouteError } = createRouteErrorHelpers('relay-routes');

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? 'unknown error');
}

export function createRelayRouter(deps: RelayRouterDeps = defaultDeps): Router {
  const router = Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (deps.enforceAccess(req, res)) next();
  });

  router.get('/', (_req, res) => res.json(deps.getRelayConfig()));

  router.post('/deploy', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      platform?: unknown;
      token?: unknown;
      name?: unknown;
      accountId?: unknown;
      orgDomain?: unknown;
    };

    const platform = body.platform;
    if (
      typeof platform !== 'string' ||
      !RELAY_PLATFORMS.includes(platform as RelayPlatform)
    ) {
      res.status(400).json({ error: 'platform must be vercel, cloudflare, deno, or netlify.' });
      return;
    }

    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) {
      res.status(400).json({ error: `${platform} API token is required` });
      return;
    }

    if (body.name !== undefined && (typeof body.name !== 'string' || !RELAY_NAME_PATTERN.test(body.name))) {
      res.status(400).json({
        error: 'name must contain only lowercase letters, numbers, and hyphens.',
      });
      return;
    }

    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    if (platform === 'cloudflare') {
      if (!accountId) {
        res.status(400).json({ error: 'Cloudflare Account ID and API Token are required' });
        return;
      }
      if (!ACCOUNT_ID_PATTERN.test(accountId)) {
        res.status(400).json({
          error: 'Cloudflare Account ID must contain only letters and numbers.',
        });
        return;
      }
    }

    const orgDomain = typeof body.orgDomain === 'string' ? body.orgDomain.trim() : '';
    if (platform === 'deno') {
      if (!orgDomain) {
        res.status(400).json({ error: 'Organization domain is required' });
        return;
      }
      if (!ORG_DOMAIN_PATTERN.test(orgDomain)) {
        res.status(400).json({
          error:
            'Organization domain must contain only lowercase letters, numbers, dots, and hyphens.',
        });
        return;
      }
    }

    try {
      const result = await deps.deployRelay({
        platform: platform as RelayPlatform,
        token,
        ...(body.name !== undefined ? { name: body.name as string } : {}),
        ...(accountId ? { accountId } : {}),
        ...(orgDomain ? { orgDomain } : {}),
      });
      const entry = createRelayEntry(platform as RelayPlatform, result.name, result.url);
      // Append under the lock: never clobber a relay added while the deploy
      // was in flight.
      deps.updateRelayConfig((current) => ({
        ...current,
        relays: [...current.relays, entry],
      }));
      res.status(201).json({ relay: entry });
    } catch (error) {
      if (error instanceof DeployError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logRouteError('Relay deploy failed', error);
      res.status(500).json({ error: errorMessage(error) || 'Deploy failed' });
    }
  });

  router.post('/:id/test', async (req: Request, res: Response) => {
    const id = req.params.id;
    try {
      const relay = deps.getRelayConfig().relays.find((entry) => entry.id === id);
      if (!relay) {
        res.status(404).json({ error: 'Relay not found' });
        return;
      }

      // The probe can take up to its timeout; every config write below must
      // happen under the lock so a deploy/activate landing mid-probe is not
      // clobbered by the snapshot we read above.
      const result = await deps.testRelay(relay.url);
      const testedAt = new Date().toISOString();
      let updatedEntry: RelayEntry | undefined;
      deps.updateRelayConfig((current) => {
        const entry = current.relays.find((candidate) => candidate.id === id);
        if (!entry) return current;
        const updated: RelayEntry = {
          ...entry,
          testStatus: result.ok ? 'ok' : 'fail',
          lastTestedAt: testedAt,
          lastError: result.ok
            ? null
            : (result.error ?? `Relay test failed with status ${result.status}`),
        };
        updatedEntry = updated;
        return {
          ...current,
          relays: current.relays.map((candidate) => (candidate.id === id ? updated : candidate)),
        };
      });
      if (!updatedEntry) {
        // Removed while the probe was in flight; do not resurrect it.
        res.status(404).json({ error: 'Relay not found' });
        return;
      }
      res.json({ ...result, testedAt });
    } catch (error) {
      logRouteError('Relay test failed', error);
      res.status(500).json({ error: 'Failed to test relay' });
    }
  });

  router.post('/:id/activate', async (req: Request, res: Response) => {
    const id = req.params.id;
    try {
      const next = await serializeConfigTransaction(async (): Promise<RelayConfig | null> => {
        // Read inside the queue: the target may have been deleted while this
        // request waited its turn.
        const previous = deps.getRelayConfig();
        if (!previous.relays.some((entry) => entry.id === id)) return null;
        const updated: RelayConfig = { ...previous, activeId: id };
        await deps.saveRelayConfig(updated);
        try {
          await deps.regenerateConfig();
        } catch (error) {
          try {
            await deps.saveRelayConfig(previous);
          } catch (revertError) {
            logRouteError(
              'Relay config revert after regenerate failure also failed',
              revertError
            );
          }
          throw error;
        }
        return updated;
      });
      if (!next) {
        res.status(404).json({ error: 'Relay not found' });
        return;
      }
      res.json({ success: true, config: next });
    } catch (error) {
      logRouteError('Relay activation failed', error);
      res.status(500).json({ error: `Failed to activate relay: ${errorMessage(error)}` });
    }
  });

  router.delete('/:id', async (req: Request, res: Response) => {
    const id = req.params.id;
    try {
      const next = await serializeConfigTransaction(async (): Promise<RelayConfig | null> => {
        // Read inside the queue: the target may already be gone by the time
        // this request reaches the front of the line.
        const previous = deps.getRelayConfig();
        if (!previous.relays.some((entry) => entry.id === id)) return null;
        const removingActive = previous.activeId === id;
        const updated: RelayConfig = {
          ...previous,
          relays: previous.relays.filter((entry) => entry.id !== id),
          activeId: removingActive ? null : previous.activeId,
        };
        await deps.saveRelayConfig(updated);
        if (removingActive) {
          // The active relay is referenced by config.yaml; regenerate once.
          try {
            await deps.regenerateConfig();
          } catch (error) {
            try {
              await deps.saveRelayConfig(previous);
            } catch (revertError) {
              logRouteError(
                'Relay config revert after regenerate failure also failed',
                revertError
              );
            }
            throw error;
          }
        }
        return updated;
      });
      if (!next) {
        res.status(404).json({ error: 'Relay not found' });
        return;
      }
      res.json({ success: true, config: next });
    } catch (error) {
      logRouteError('Relay deletion failed', error);
      res.status(500).json({ error: `Failed to delete relay: ${errorMessage(error)}` });
    }
  });

  return router;
}

export default createRelayRouter();
