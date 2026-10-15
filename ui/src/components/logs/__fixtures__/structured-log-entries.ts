import type { LogsEntry, LogsLevel } from '@/lib/api-client';

/**
 * Deterministic fixture for the redesigned logs surface.
 *
 * Mix:
 *   - 30 traces of 3-6 stages each (~140 entries) sharing a `requestId`.
 *   - ~60 standalone entries (no `requestId`) including pre-intake / system rows.
 *   - All 4 levels present; partial traces (incomplete stage list) included.
 *
 * Used in dev mode via `?mock=logs` URL flag (see `use-logs.ts`). Tree-shaken
 * from production builds because the import site is guarded by
 * `import.meta.env.DEV`.
 */

const STAGES = ['intake', 'auth', 'route', 'handler', 'provider', 'response'] as const;

const MODULES = [
  'api.gateway',
  'auth.oauth',
  'cliproxy.router',
  'profile.runtime',
  'config.loader',
  'doctor.healthcheck',
  'cli.exec',
  'dashboard.api',
] as const;

const SOURCES = ['ccs-cli', 'cliproxy', 'dashboard'] as const;

const EVENTS = [
  'request.received',
  'request.dispatched',
  'provider.invoked',
  'provider.responded',
  'response.flushed',
  'profile.activated',
  'config.read',
  'token.refreshed',
] as const;

// Deterministic PRNG so the fixture is stable across reloads.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(1138_1142);

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}

function pickLevel(weights = { debug: 0.5, info: 0.3, warn: 0.15, error: 0.05 }): LogsLevel {
  const r = rng();
  let acc = 0;
  for (const [level, w] of Object.entries(weights) as Array<[LogsLevel, number]>) {
    acc += w;
    if (r <= acc) return level;
  }
  return 'debug';
}

const BASE_TS = Date.parse('2026-04-30T17:00:00Z');

let entryCounter = 0;
function nextId(prefix: string): string {
  entryCounter += 1;
  return `${prefix}-${entryCounter.toString(36)}`;
}

function buildTrace(traceIndex: number): LogsEntry[] {
  const requestId = `req_${(traceIndex + 1).toString().padStart(4, '0')}`;
  const traceStart = BASE_TS - traceIndex * 47_000 - Math.floor(rng() * 1500);
  const stageCount = 3 + Math.floor(rng() * 4); // 3..6
  const moduleName = pick(MODULES);
  const source = pick(SOURCES);
  const stages = STAGES.slice(0, stageCount);
  // ~12% of traces are partial -- drop a middle stage to simulate gaps
  const partial = rng() < 0.12 && stages.length > 3;
  const effectiveStages = partial
    ? stages.filter((_, idx) => idx !== Math.floor(stages.length / 2))
    : stages;

  let cursor = traceStart;
  return effectiveStages.map((stage, idx) => {
    const latencyMs = 5 + Math.floor(rng() * 220);
    cursor += latencyMs + Math.floor(rng() * 6);
    const level = idx === effectiveStages.length - 1 && rng() < 0.18 ? 'error' : pickLevel();
    const event = pick(EVENTS);
    const ts = new Date(cursor).toISOString();
    return {
      id: nextId('trace'),
      timestamp: ts,
      level,
      source,
      event,
      message: `${moduleName} ${stage} ${level === 'error' ? 'failed' : 'ok'}`,
      processId: 4000 + (traceIndex % 8),
      runId: `run_${(traceIndex % 12).toString().padStart(3, '0')}`,
      context: undefined,
      requestId,
      module: moduleName,
      stage,
      latencyMs,
      metadata: {
        attempt: idx + 1,
        traceIndex,
        cacheHit: rng() < 0.3,
        upstream: source,
      },
      error:
        level === 'error'
          ? {
              message: `${moduleName}.${stage} timed out after ${latencyMs}ms`,
              code: 'ERR_TIMEOUT',
              stack: `at ${moduleName}.${stage}\n  at handler.run`,
            }
          : undefined,
    } satisfies LogsEntry;
  });
}

function buildStandalone(index: number): LogsEntry {
  const ts = new Date(BASE_TS - index * 11_000 - Math.floor(rng() * 4000)).toISOString();
  const level = pickLevel({ debug: 0.55, info: 0.3, warn: 0.1, error: 0.05 });
  const moduleName = pick(MODULES);
  const source = pick(SOURCES);
  const event = pick(EVENTS);
  return {
    id: nextId('solo'),
    timestamp: ts,
    level,
    source,
    event,
    message: `${moduleName} ${event.replace('.', ' ')}`,
    processId: 4000 + (index % 8),
    runId: null,
    context: undefined,
    requestId: undefined,
    module: moduleName,
    stage: undefined,
    latencyMs: rng() < 0.6 ? Math.floor(rng() * 80) : undefined,
    metadata: { standalone: true, source },
    error: undefined,
  } satisfies LogsEntry;
}

const traces: LogsEntry[] = [];
for (let i = 0; i < 30; i += 1) {
  traces.push(...buildTrace(i));
}

const standalones: LogsEntry[] = [];
for (let i = 0; i < 60; i += 1) {
  standalones.push(buildStandalone(i));
}

export const STRUCTURED_LOG_ENTRIES: LogsEntry[] = [...traces, ...standalones].sort((a, b) =>
  b.timestamp.localeCompare(a.timestamp)
);
