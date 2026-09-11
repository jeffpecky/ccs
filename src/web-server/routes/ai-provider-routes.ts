import { Router, type Request, type Response } from 'express';
import {
  AI_PROVIDER_FAMILY_IDS,
  createAiProviderEntry,
  deleteAiProviderEntry,
  fetchAiProviderModels,
  listAiProviders,
  testAiProviderConnection,
  updateAiProviderEntry,
  type AiProviderFamilyId,
  type UpsertAiProviderEntryInput,
} from '../../cliproxy/ai-providers';
import { requireLocalAccessWhenAuthDisabled } from '../middleware/auth-middleware';

const router = Router();

router.use((req: Request, res: Response, next) => {
  if (
    requireLocalAccessWhenAuthDisabled(
      req,
      res,
      'AI provider endpoints require localhost access when dashboard auth is disabled.'
    )
  ) {
    next();
  }
});

function isAiProviderFamilyId(value: string): value is AiProviderFamilyId {
  return AI_PROVIDER_FAMILY_IDS.includes(value as AiProviderFamilyId);
}

function parseFamily(req: Request, res: Response): AiProviderFamilyId | null {
  const family = req.params.family?.trim();
  if (!family || !isAiProviderFamilyId(family)) {
    res.status(400).json({ error: 'Invalid AI provider family' });
    return null;
  }
  return family;
}

function parseEntryId(req: Request, res: Response): string | null {
  const entryId = req.params.entryId?.trim();
  if (!entryId) {
    res.status(400).json({ error: 'Invalid entry id' });
    return null;
  }
  return entryId;
}

function parseInput(body: unknown): UpsertAiProviderEntryInput {
  const payload =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  return {
    name: typeof payload.name === 'string' ? payload.name : undefined,
    baseUrl: typeof payload.baseUrl === 'string' ? payload.baseUrl : undefined,
    proxyUrl: typeof payload.proxyUrl === 'string' ? payload.proxyUrl : undefined,
    prefix: typeof payload.prefix === 'string' ? payload.prefix : undefined,
    headers: Array.isArray(payload.headers)
      ? payload.headers
          .filter(
            (item): item is { key?: unknown; value?: unknown } =>
              typeof item === 'object' && item !== null
          )
          .map((item) => ({
            key: typeof item.key === 'string' ? item.key : '',
            value: typeof item.value === 'string' ? item.value : '',
          }))
      : undefined,
    excludedModels: Array.isArray(payload.excludedModels)
      ? payload.excludedModels.filter((item): item is string => typeof item === 'string')
      : undefined,
    models: Array.isArray(payload.models)
      ? payload.models
          .filter(
            (item): item is { name?: unknown; alias?: unknown } =>
              typeof item === 'object' && item !== null
          )
          .map((item) => ({
            name: typeof item.name === 'string' ? item.name : '',
            alias: typeof item.alias === 'string' ? item.alias : '',
          }))
      : undefined,
    apiKey: typeof payload.apiKey === 'string' ? payload.apiKey : undefined,
    apiKeys: Array.isArray(payload.apiKeys)
      ? payload.apiKeys.filter((item): item is string => typeof item === 'string')
      : undefined,
    preserveSecrets: payload.preserveSecrets === true,
  };
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    res.json(await listAiProviders());
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

router.post('/:family', async (req: Request, res: Response) => {
  const family = parseFamily(req, res);
  if (!family) return;

  try {
    await createAiProviderEntry(family, parseInput(req.body));
    res.status(201).json({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    res.status(message === 'Entry not found' ? 404 : 400).json({ error: message });
  }
});

router.put('/:family/:entryId', async (req: Request, res: Response) => {
  const family = parseFamily(req, res);
  if (!family) return;
  const entryId = parseEntryId(req, res);
  if (!entryId) return;

  try {
    await updateAiProviderEntry(family, entryId, parseInput(req.body));
    res.json({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    res.status(message === 'Entry not found' ? 404 : 400).json({ error: message });
  }
});

router.delete('/:family/:entryId', async (req: Request, res: Response) => {
  const family = parseFamily(req, res);
  if (!family) return;
  const entryId = parseEntryId(req, res);
  if (!entryId) return;

  try {
    await deleteAiProviderEntry(family, entryId);
    res.json({ success: true });
  } catch (error) {
    const message = (error as Error).message;
    res.status(message === 'Entry not found' ? 404 : 400).json({ error: message });
  }
});

router.post('/:family/test', async (req: Request, res: Response) => {
  const family = parseFamily(req, res);
  if (!family) return;

  try {
    const input = parseInput(req.body);
    const result = await testAiProviderConnection({
      family,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      headers: input.headers,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: (error as Error).message });
  }
});

router.get('/:family/models', async (req: Request, res: Response) => {
  const family = parseFamily(req, res);
  if (!family) return;

  try {
    const result = await fetchAiProviderModels(family);
    res.json(result);
  } catch (error) {
    res.status(500).json({ models: [], provider: family, error: (error as Error).message });
  }
});

export default router;
