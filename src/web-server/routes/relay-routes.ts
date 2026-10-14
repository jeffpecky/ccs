/**
 * Relay API routes — list, deploy, test, activate, and delete edge relays.
 *
 * Deployments are one-shot: POST /deploy talks to the platform (Vercel,
 * Cloudflare, Deno Deploy, Netlify) and appends the resulting relay entry to
 * the unified config. The API token is only forwarded to the deploy client —
 * it is never persisted or echoed back. Activation and active-relay deletion
 * also regenerate the runtime config.yaml, serialized through a module-level
 * queue so concurrent transactions cannot interleave save/regenerate steps.
 */

import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

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
import type { DeployInput } from '../../relay/deploy';
import {
  createRelayEntry,
  getRelayConfig,
  saveRelayConfig,
  testRelay,
} from '../../relay/relay-service';
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

const RELAY_PLATFORMS: readonly RelayPlatform[] = [
  'vercel',
  'cloudflare',
  'deno',
  'netlify',
];

type RelayDeployResult = { url: string; name: string };

const DEPLOYERS: Record<RelayPlatform, (input: DeployInput) => Promise<RelayDeployResult>> = {
  vercel: deployVercel,
  cloudflare: deployCloudflare,
  deno: deployDeno,
  netlify: deployNetlify,
};

export interface RelayRouterDeps {
  enforceAccess(req: Request, res: Response): boolean;
  getRelayConfig(): RelayConfig;
  saveRelayConfig(next: RelayConfig): void | Promise<void>;
  regenerateConfig(): void | Promise<void>;
  deployRelay(
    input: DeployInput & { platform: RelayPlatform }
  ): Promise<{ url: string; name: string }>;
  testRelay(url: string): Promise<{ ok: boolean; status: number; error?: string; elapsedMs: number }>;
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
      const current = deps.getRelayConfig();
      await deps.saveRelayConfig({ ...current, relays: [...current.relays, entry] });
      res.status(201).json({ relay: entry });
    } catch (error) {
      if (error instanceof DeployError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      logRouteError('Relay deploy failed', error);
      res.status(500).json({ error: (error as Error).message || 'Deploy failed' });
    }
  });

  router.post('/:id/test', async (req: Request, res: Response) => {
    const current = deps.getRelayConfig();
    const relay = current.relays.find((entry) => entry.id === req.params.id);
    if (!relay) {
      res.status(404).json({ error: 'Relay not found' });
      return;
    }
    try {
      const result = await deps.testRelay(relay.url);
      const testedAt = new Date().toISOString();
      const updated: RelayEntry = {
        ...relay,
        testStatus: result.ok ? 'ok' : 'fail',
        lastTestedAt: testedAt,
        lastError: result.ok
          ? null
          : (result.error ?? `Relay test failed with status ${result.status}`),
      };
      await deps.saveRelayConfig({
        ...current,
        relays: current.relays.map((entry) => (entry.id === relay.id ? updated : entry)),
      });
      res.json({ ...result, testedAt });
    } catch {
      res.status(500).json({ error: 'Failed to test relay' });
    }
  });

  router.post('/:id/activate', async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!deps.getRelayConfig().relays.some((entry) => entry.id === id)) {
      res.status(404).json({ error: 'Relay not found' });
      return;
    }
    try {
      const next = await serializeConfigTransaction(async () => {
        const previous = deps.getRelayConfig();
        const updated: RelayConfig = { ...previous, activeId: id };
        await deps.saveRelayConfig(updated);
        try {
          await deps.regenerateConfig();
        } catch (error) {
          try {
            await deps.saveRelayConfig(previous);
          } catch {
            // Keep the regenerate error as the reported failure.
          }
          throw error;
        }
        return updated;
      });
      res.json({ success: true, relay: next });
    } catch (error) {
      logRouteError('Relay activation failed', error);
      res.status(500).json({ error: `Failed to activate relay: ${(error as Error).message}` });
    }
  });

  router.delete('/:id', async (req: Request, res: Response) => {
    const id = req.params.id;
    if (!deps.getRelayConfig().relays.some((entry) => entry.id === id)) {
      res.status(404).json({ error: 'Relay not found' });
      return;
    }
    try {
      const next = await serializeConfigTransaction(async () => {
        const previous = deps.getRelayConfig();
        const removingActive = previous.activeId === id;
        const updated: RelayConfig = {
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
            } catch {
              // Keep the regenerate error as the reported failure.
            }
            throw error;
          }
        }
        return updated;
      });
      res.json({ success: true, relay: next });
    } catch (error) {
      logRouteError('Relay deletion failed', error);
      res.status(500).json({ error: `Failed to delete relay: ${(error as Error).message}` });
    }
  });

  return router;
}

export default createRelayRouter();
