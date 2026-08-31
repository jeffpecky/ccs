import { Router, Request, Response } from 'express';
import {
  applyCliproxyRoutingStrategy,
  applyCliproxySessionAffinitySettings,
  enablePoolRouting,
  disablePoolRouting,
  getCliproxyPoolRoutingState,
  normalizeCliproxyRoutingStrategy,
  normalizeCliproxySessionAffinityEnabled,
  normalizeCliproxySessionAffinityTtl,
  readCliproxyRoutingState,
  readCliproxySessionAffinityState,
} from '../../cliproxy/routing/routing-strategy';
import { requireLocalAccessWhenAuthDisabled } from '../middleware/auth-middleware';
import { CLIPROXY_DEFAULT_PORT } from '../../cliproxy/config/port-manager';

const router = Router();

router.use((req: Request, res: Response, next) => {
  if (
    requireLocalAccessWhenAuthDisabled(
      req,
      res,
      'CLIProxy routing endpoints require localhost access when dashboard auth is disabled.'
    )
  ) {
    next();
  }
});

router.get('/routing/strategy', async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json(await readCliproxyRoutingState());
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

router.put('/routing/strategy', async (req: Request, res: Response): Promise<void> => {
  const strategy = normalizeCliproxyRoutingStrategy(req.body?.value ?? req.body?.strategy);
  if (!strategy) {
    res.status(400).json({ error: 'Invalid strategy. Use: round-robin or fill-first' });
    return;
  }

  try {
    res.json(await applyCliproxyRoutingStrategy(strategy));
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

router.get('/routing/session-affinity', async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json(await readCliproxySessionAffinityState());
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

router.put('/routing/session-affinity', async (req: Request, res: Response): Promise<void> => {
  const enabled = normalizeCliproxySessionAffinityEnabled(req.body?.enabled ?? req.body?.value);
  const ttl = req.body?.ttl;
  const normalizedTtl: string | undefined =
    ttl === undefined ? undefined : (normalizeCliproxySessionAffinityTtl(ttl) ?? undefined);

  if (enabled === null || (ttl !== undefined && !normalizedTtl)) {
    res.status(400).json({
      error: 'Invalid session affinity payload. Use enabled=true|false and ttl like 30m or 1h.',
    });
    return;
  }

  try {
    const result = await applyCliproxySessionAffinitySettings({
      enabled,
      ttl: normalizedTtl,
    });
    if (!result.manageable || result.applied === 'unsupported') {
      res.status(400).json({
        error: result.message || 'Session affinity is not supported for this target.',
      });
      return;
    }
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

router.get('/routing/pool', async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json(getCliproxyPoolRoutingState());
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

router.put('/routing/pool', async (req: Request, res: Response): Promise<void> => {
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'Invalid pool routing payload. Use enabled=true|false.' });
    return;
  }

  try {
    const result = enabled ? enablePoolRouting(CLIPROXY_DEFAULT_PORT) : disablePoolRouting(CLIPROXY_DEFAULT_PORT);
    const poolState = getCliproxyPoolRoutingState();
    res.json({
      ...poolState,
      message: result.message,
      changed: result.changed,
    });
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

export default router;
