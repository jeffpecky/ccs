/**
 * Relay API routes — list, deploy, probe, configure, and delete edge relays.
 *
 * Deployments are one-shot: POST /deploy talks to the platform (Vercel,
 * Cloudflare, Deno Deploy, Netlify), appends the resulting relay entry to
 * the unified config, and activates it in the same transaction (9Router
 * parity: a deployed relay is immediately live). The API token is only
 * forwarded to the deploy client — it is never persisted or echoed back.
 * Writes that must not clobber a concurrent writer (deploy append +
 * activation, probe-result persistence, rotation-setting updates) go through
 * the service's updateRelayConfig/saveRelayConfig, which run a
 * read-modify-write under the config loader's lock.
 *
 * PATCH / carries the outbound rotation settings (strategy, strict, the
 * preferred relay, per-provider pins) and POST /test-all probes the whole
 * pool; both land in config.yaml, so both regenerate it. PATCH /:id pauses or
 * resumes one relay — pool membership again, so it regenerates whenever the
 * resolved pool moves. Probe results also regenerate whenever they move a
 * relay in or out of the health-gated rotation pool.
 *
 * Deploy activation and active-relay deletion also regenerate the runtime
 * config.yaml. Within THIS router those save+regenerate transactions are
 * serialized through a module-level queue so concurrent deploy/delete
 * calls cannot interleave their steps. When activation regeneration fails
 * the deployed entry is kept (the remote worker exists) but the active
 * pointer reverts and the response reports activated: false. Other routes
 * that regenerate config.yaml (e.g. headroom) are not serialized against
 * this queue — that is pre-existing behavior, out of scope here.
 */

import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';

import { RELAY_PLATFORMS, RELAY_STRATEGIES } from '../../config/schemas/relay';
import type {
  RelayConfig,
  RelayEntry,
  RelayPlatform,
  RelayStrategy,
} from '../../config/schemas/relay';
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
  resolveRelayCandidates,
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

/**
 * Drop every pin targeting `relayId`. Returns a fresh object so callers can
 * compare it with the previous pins to decide whether config.yaml changed.
 */
function withoutProviderPin(
  pins: Record<string, string> | undefined,
  relayId: string
): Record<string, string> {
  return Object.fromEntries(Object.entries(pins ?? {}).filter(([, pin]) => pin !== relayId));
}

/**
 * Regenerate config.yaml after probe results moved relays in or out of the
 * health-gated rotation pool, serialized against the deploy/delete queue.
 * Reports the failure on `res` and resolves false so the caller can stop;
 * resolves true when the caller may still send its own response.
 */
async function pushRelayHealthChange(
  res: Response,
  deps: RelayRouterDeps,
  summary: string
): Promise<boolean> {
  try {
    await serializeConfigTransaction(async () => {
      await deps.regenerateConfig();
    });
    return true;
  } catch (error) {
    logRouteError(`${summary}: runtime config regeneration failed`, error);
    res.status(500).json({
      error: `${summary}, but regenerating the runtime config failed: ${errorMessage(error)}`,
    });
    return false;
  }
}

export function createRelayRouter(deps: RelayRouterDeps = defaultDeps): Router {
  const router = Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (deps.enforceAccess(req, res)) next();
  });

  router.get('/', (_req, res) => res.json(deps.getRelayConfig()));

  /**
   * Update outbound relay selection: rotation strategy, strict fail-closed
   * mode, the preferred relay, and per-provider pins. All four land in
   * config.yaml, so the write is a save+regenerate transaction serialized
   * against deploy/delete (and reverted if regeneration fails).
   */
  router.patch('/', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      strategy?: unknown;
      strict?: unknown;
      activeId?: unknown;
      providerRelayIds?: unknown;
    };

    const errors: string[] = [];
    let strategy: RelayStrategy | undefined;
    if (body.strategy !== undefined) {
      if (
        typeof body.strategy === 'string' &&
        RELAY_STRATEGIES.includes(body.strategy as RelayStrategy)
      ) {
        strategy = body.strategy as RelayStrategy;
      } else {
        errors.push(`strategy must be one of: ${RELAY_STRATEGIES.join(', ')}`);
      }
    }

    let strict: boolean | undefined;
    if (body.strict !== undefined) {
      if (typeof body.strict === 'boolean') strict = body.strict;
      else errors.push('strict must be a boolean');
    }

    let activeId: string | null | undefined;
    if (body.activeId !== undefined) {
      if (body.activeId === null) activeId = null;
      else if (typeof body.activeId === 'string' && body.activeId.length > 0)
        activeId = body.activeId;
      else errors.push('activeId must be a relay id or null');
    }

    let providerRelayIds: Record<string, string> | undefined;
    if (body.providerRelayIds !== undefined) {
      const raw = body.providerRelayIds;
      const flat =
        typeof raw === 'object' &&
        raw !== null &&
        !Array.isArray(raw) &&
        Object.values(raw as Record<string, unknown>).every((value) => typeof value === 'string');
      if (flat) providerRelayIds = raw as Record<string, string>;
      else errors.push('providerRelayIds must map provider names to relay ids');
    }

    if (errors.length > 0) {
      res.status(400).json({ errors });
      return;
    }
    if (
      strategy === undefined &&
      strict === undefined &&
      activeId === undefined &&
      providerRelayIds === undefined
    ) {
      res.status(400).json({ errors: ['no relay settings provided'] });
      return;
    }

    try {
      const outcome = await serializeConfigTransaction(
        async (): Promise<{ status: number; error?: string; config?: RelayConfig }> => {
          // Read inside the queue so validation sees the same snapshot the
          // write is based on.
          const previous = deps.getRelayConfig();
          if (
            activeId !== undefined &&
            activeId !== null &&
            !previous.relays.some((entry) => entry.id === activeId)
          ) {
            return { status: 404, error: 'Relay not found' };
          }
          const dangling = Object.entries(providerRelayIds ?? {}).filter(
            ([, relayId]) => !previous.relays.some((entry) => entry.id === relayId)
          );
          if (dangling.length > 0) {
            return {
              status: 400,
              error: `providerRelayIds references unknown relays for: ${dangling
                .map(([provider]) => provider)
                .join(', ')}`,
            };
          }

          const updated: RelayConfig = {
            ...previous,
            strategy: strategy ?? previous.strategy,
            strict: strict ?? previous.strict,
            activeId: activeId === undefined ? previous.activeId : activeId,
            providerRelayIds: providerRelayIds ?? previous.providerRelayIds,
          };
          await deps.saveRelayConfig(updated);
          try {
            await deps.regenerateConfig();
          } catch (error) {
            try {
              await deps.saveRelayConfig(previous);
            } catch (revertError) {
              logRouteError(
                'Relay settings revert after regenerate failure also failed',
                revertError
              );
            }
            throw error;
          }
          return { status: 200, config: updated };
        }
      );
      if (outcome.status !== 200) {
        res.status(outcome.status).json({ error: outcome.error });
        return;
      }
      res.json({ success: true, config: outcome.config });
    } catch (error) {
      logRouteError('Relay settings update failed', error);
      res.status(500).json({ error: `Failed to update relay settings: ${errorMessage(error)}` });
    }
  });

  router.post('/deploy', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      platform?: unknown;
      token?: unknown;
      name?: unknown;
      accountId?: unknown;
      orgDomain?: unknown;
    };

    const platform = body.platform;
    if (typeof platform !== 'string' || !RELAY_PLATFORMS.includes(platform as RelayPlatform)) {
      res.status(400).json({ error: 'platform must be vercel, cloudflare, deno, or netlify.' });
      return;
    }

    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) {
      res.status(400).json({ error: `${platform} API token is required` });
      return;
    }

    if (
      body.name !== undefined &&
      (typeof body.name !== 'string' || !RELAY_NAME_PATTERN.test(body.name))
    ) {
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
      // Deployed relays activate immediately (9Router parity). The whole
      // save+regenerate transaction runs on the queue so concurrent
      // deploy/delete calls cannot interleave their steps.
      const outcome = await serializeConfigTransaction(async () => {
        // Read inside the queue, then append+activate under the lock so a
        // relay added while the platform deploy was in flight is kept.
        const previousActiveId = deps.getRelayConfig().activeId ?? null;
        deps.updateRelayConfig((current) => ({
          ...current,
          relays: [...current.relays, entry],
          activeId: entry.id,
        }));
        try {
          await deps.regenerateConfig();
          return { activated: true };
        } catch (error) {
          // The remote worker exists: keep the entry, revert only the
          // activation. regenerateConfig writes config.yaml atomically as
          // its last step, so a throw leaves the runtime config unchanged.
          try {
            deps.updateRelayConfig((current) => ({ ...current, activeId: previousActiveId }));
          } catch (revertError) {
            logRouteError(
              'Relay activation revert after regenerate failure also failed',
              revertError
            );
          }
          return { activated: false, activationError: errorMessage(error) };
        }
      });
      res.status(201).json({ relay: entry, ...outcome });
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
      // happen under the lock so a deploy/delete landing mid-probe is not
      // clobbered by the snapshot we read above.
      const result = await deps.testRelay(relay.url);
      const testedAt = new Date().toISOString();
      const nextStatus: RelayEntry['testStatus'] = result.ok ? 'ok' : 'fail';
      let updatedEntry: RelayEntry | undefined;
      let healthChanged = false;
      deps.updateRelayConfig((current) => {
        const entry = current.relays.find((candidate) => candidate.id === id);
        if (!entry) return current;
        healthChanged = entry.testStatus !== nextStatus;
        const updated: RelayEntry = {
          ...entry,
          testStatus: nextStatus,
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
      // Health gates which relays reach config.yaml, so a relay entering or
      // leaving the pool has to be pushed to the proxy; a status that merely
      // moved between ok/fail on an unchanged pool needs no rewrite.
      if (healthChanged && !(await pushRelayHealthChange(res, deps, 'Relay test recorded'))) {
        return;
      }
      res.json({ ...result, testedAt });
    } catch (error) {
      logRouteError('Relay test failed', error);
      res.status(500).json({ error: 'Failed to test relay' });
    }
  });

  /**
   * Pause or resume a single relay. A paused relay stays on the dashboard but
   * leaves the rotation pool — and any per-provider pin — until resumed, so a
   * misbehaving relay can be pulled from service without deleting it. Pool
   * membership lands in config.yaml, so the write regenerates it whenever the
   * resolved pool actually changes (pausing a relay that is already probe-failed
   * changes nothing and skips the rewrite).
   */
  router.patch('/:id', async (req: Request, res: Response) => {
    const id = req.params.id;
    const body = (req.body ?? {}) as { paused?: unknown };
    if (typeof body.paused !== 'boolean') {
      res.status(400).json({ error: 'paused must be a boolean' });
      return;
    }
    const paused = body.paused;
    try {
      const next = await serializeConfigTransaction(async (): Promise<RelayConfig | null> => {
        const previous = deps.getRelayConfig();
        const entry = previous.relays.find((candidate) => candidate.id === id);
        if (!entry) return null;
        // Idempotent no-op: a toggle into the state it already has writes nothing.
        if ((entry.paused ?? false) === paused) return previous;
        const updated: RelayConfig = {
          ...previous,
          relays: previous.relays.map((candidate) =>
            candidate.id === id ? { ...candidate, paused } : candidate
          ),
        };
        await deps.saveRelayConfig(updated);
        // Same rule as deletion: regenerate only when the resolved pool moved,
        // so pausing an already-probed-failed relay costs no proxy rewrite.
        const poolChanged =
          resolveRelayCandidates(previous).join('\n') !==
          resolveRelayCandidates(updated).join('\n');
        if (poolChanged) {
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
      logRouteError(paused ? 'Relay pause failed' : 'Relay resume failed', error);
      res.status(500).json({
        error: `Failed to ${paused ? 'pause' : 'resume'} relay: ${errorMessage(error)}`,
      });
    }
  });

  /**
   * Probe every deployed relay in parallel and persist the results, then push
   * the resulting pool membership to config.yaml in one transaction. This is
   * the sweep that keeps health-gated rotation honest: without it, a relay
   * that died silently stays in the pool until the next deploy.
   */
  router.post('/test-all', async (_req: Request, res: Response) => {
    try {
      const { relays } = deps.getRelayConfig();
      if (relays.length === 0) {
        res.json({ results: [], healthChanged: false });
        return;
      }

      const testedAt = new Date().toISOString();
      const results = await Promise.all(
        relays.map(async (relay) => ({
          id: relay.id,
          url: relay.url,
          ...(await deps.testRelay(relay.url)),
          testedAt,
        }))
      );

      let healthChanged = false;
      deps.updateRelayConfig((current) => ({
        ...current,
        relays: current.relays.map((entry) => {
          const result = results.find((candidate) => candidate.id === entry.id);
          if (!result) return entry;
          const nextStatus: RelayEntry['testStatus'] = result.ok ? 'ok' : 'fail';
          if (entry.testStatus !== nextStatus) healthChanged = true;
          return {
            ...entry,
            testStatus: nextStatus,
            lastTestedAt: testedAt,
            lastError: result.ok
              ? null
              : (result.error ?? `Relay test failed with status ${result.status}`),
          };
        }),
      }));

      if (
        healthChanged &&
        !(await pushRelayHealthChange(res, deps, 'Relay health sweep recorded'))
      ) {
        return;
      }
      res.json({ results, healthChanged, config: deps.getRelayConfig() });
    } catch (error) {
      logRouteError('Relay health sweep failed', error);
      res.status(500).json({ error: 'Failed to test relays' });
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
          // A pin left pointing at the removed relay would resolve to nothing
          // at generation time; drop it so the stored config stays truthful.
          providerRelayIds: withoutProviderPin(previous.providerRelayIds, id),
        };
        await deps.saveRelayConfig(updated);
        // config.yaml carries the candidate pool and any pins, so a deletion
        // that changes either must regenerate — not just one that clears the
        // active pointer (with a rotation strategy every relay is in the pool).
        const poolChanged =
          resolveRelayCandidates(previous).join('\n') !==
          resolveRelayCandidates(updated).join('\n');
        const pinsChanged =
          JSON.stringify(previous.providerRelayIds ?? {}) !==
          JSON.stringify(updated.providerRelayIds ?? {});
        if (removingActive || poolChanged || pinsChanged) {
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
