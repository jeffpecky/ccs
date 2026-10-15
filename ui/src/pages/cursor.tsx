/**
 * Cursor Page
 * Dedicated dashboard surface for Cursor integration.
 */

import { useMemo, useState, type ElementType } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  Key,
  Loader2,
  Play,
  Power,
  PowerOff,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  Sparkles,
  Zap,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCursor } from '@/hooks/use-cursor';
import { DEFAULT_CURSOR_PORT } from '@/lib/default-ports';
import { isApiConflictError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { RawEditorSection } from '@/components/copilot/config-form/raw-editor-section';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslation } from 'react-i18next';

interface CursorConfigDraft {
  port: string;
  auto_start: boolean;
  ghost_mode: boolean;
  model: string;
  opus_model: string;
  sonnet_model: string;
  haiku_model: string;
}

interface RawSettingsParseResult {
  isValid: boolean;
  settings?: { env?: Record<string, string> };
  error?: string;
}

function buildProbeSnapshotKey(
  status?: {
    enabled?: boolean;
    authenticated?: boolean;
    token_expired?: boolean;
    daemon_running?: boolean;
    port?: number;
    ghost_mode?: boolean;
  },
  config?: {
    model?: string;
    auto_start?: boolean;
  }
): string {
  return JSON.stringify({
    enabled: status?.enabled ?? null,
    authenticated: status?.authenticated ?? null,
    token_expired: status?.token_expired ?? null,
    daemon_running: status?.daemon_running ?? null,
    port: status?.port ?? null,
    ghost_mode: status?.ghost_mode ?? null,
    auto_start: config?.auto_start ?? null,
    model: config?.model ?? null,
  });
}

function buildConfigDraft(config?: {
  port?: number;
  auto_start?: boolean;
  ghost_mode?: boolean;
  model?: string;
  opus_model?: string;
  sonnet_model?: string;
  haiku_model?: string;
}): CursorConfigDraft {
  return {
    port: String(config?.port ?? DEFAULT_CURSOR_PORT),
    auto_start: config?.auto_start ?? false,
    ghost_mode: config?.ghost_mode ?? true,
    model: config?.model?.trim() || 'gpt-5.3-codex',
    opus_model: config?.opus_model?.trim() || '',
    sonnet_model: config?.sonnet_model?.trim() || '',
    haiku_model: config?.haiku_model?.trim() || '',
  };
}

function pickModelByPatterns(
  models: Array<{ id: string }>,
  patterns: RegExp[],
  fallback: string
): string {
  const matched = models.find((model) => patterns.some((pattern) => pattern.test(model.id)));
  return matched?.id ?? fallback;
}

function normalizeModelKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function pickModelByAliases(
  models: Array<{ id: string; name: string }>,
  aliases: string[],
  fallback: string
): string {
  const normalizedAliasSet = new Set(aliases.map(normalizeModelKey));
  const direct = models.find((model) => normalizedAliasSet.has(normalizeModelKey(model.id)));
  if (direct) return direct.id;

  const byName = models.find((model) => normalizedAliasSet.has(normalizeModelKey(model.name)));
  if (byName) return byName.id;

  return fallback;
}

function parseRawSettings(value: string): RawSettingsParseResult {
  try {
    const parsed = JSON.parse(value || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        isValid: false,
        /* TODO i18n: missing key for "Raw settings must be a JSON object" */
        error: 'Raw settings must be a JSON object',
      };
    }

    return {
      isValid: true,
      settings: parsed as { env?: Record<string, string> },
    };
  } catch (error) {
    return {
      isValid: false,
      /* TODO i18n: missing key for "Invalid JSON" */
      error: (error as Error).message || 'Invalid JSON',
    };
  }
}

function CursorModelSelector({
  label,
  description,
  value,
  models,
  disabled,
  allowDefaultFallback = false,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  models: Array<{ id: string; name: string; provider: string }>;
  disabled?: boolean;
  allowDefaultFallback?: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const selectorValue = value || (allowDefaultFallback ? '__default' : '');
  const options = useMemo(() => {
    const mappedModels = models.map((model) => ({
      value: model.id,
      groupKey: 'models',
      searchText: `${model.name || model.id} ${model.id}`,
      keywords: [model.provider],
      triggerContent: (
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-xs">{model.name || model.id}</span>
          {model.provider && (
            <Badge variant="outline" className="text-[9px] h-4 px-1 capitalize">
              {model.provider}
            </Badge>
          )}
        </div>
      ),
      itemContent: (
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-mono">{model.name || model.id}</span>
          <Badge variant="outline" className="text-[9px] h-4 px-1 capitalize">
            {model.provider}
          </Badge>
        </div>
      ),
    }));

    if (!allowDefaultFallback) return mappedModels;

    return [
      {
        value: '__default',
        groupKey: 'models',
        searchText: t('cursorPage.useDefaultModel'),
        triggerContent: (
          <span className="truncate font-mono text-xs">{t('cursorPage.useDefaultModel')}</span>
        ),
        itemContent: <span>{t('cursorPage.useDefaultModel')}</span>,
      },
      ...mappedModels,
    ];
  }, [allowDefaultFallback, models, t]);

  return (
    <div className="space-y-1.5">
      <div>
        <Label className="text-xs font-medium">{label}</Label>
        <p className="text-[10px] text-muted-foreground">{description}</p>
      </div>
      <SearchableSelect
        value={selectorValue || undefined}
        onChange={(nextValue) => {
          if (allowDefaultFallback && nextValue === '__default') {
            onChange('');
            return;
          }
          onChange(nextValue);
        }}
        disabled={disabled}
        placeholder={t('cursorPage.selectModel')}
        searchPlaceholder={t('searchableSelect.searchModels')}
        emptyText={t('searchableSelect.noResults')}
        triggerClassName="h-9"
        groups={[
          {
            key: 'models',
            label: t('cursorPage.availableModelCount', { count: models.length }),
          },
        ]}
        options={options}
      />
    </div>
  );
}

function StatusItem({
  icon: Icon,
  label,
  ok,
  detail,
}: {
  icon: ElementType;
  label: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm">{label}</p>
      </div>
      <div className="flex items-center gap-1.5">
        {ok ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        ) : (
          <XCircle className="h-4 w-4 text-muted-foreground" />
        )}
        <span
          className={cn('text-xs', ok ? 'text-green-500' : 'text-muted-foreground')}
          title={detail}
        >
          {detail}
        </span>
      </div>
    </div>
  );
}

export function CursorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    status,
    statusLoading,
    refetchStatus,
    config,
    refetchConfig,
    updateConfigAsync,
    isUpdatingConfig,
    models,
    modelsLoading,
    currentModel,
    rawSettings,
    rawSettingsLoading,
    refetchRawSettings,
    saveRawSettingsAsync,
    isSavingRawSettings,
    autoDetectAuthAsync,
    isAutoDetectingAuth,
    importManualAuthAsync,
    isImportingManualAuth,
    startDaemonAsync,
    isStartingDaemon,
    stopDaemonAsync,
    isStoppingDaemon,
    runProbeAsync,
    isRunningProbe,
    probeResult,
    resetProbe,
  } = useCursor();

  const [configDraft, setConfigDraft] = useState<CursorConfigDraft>(() => buildConfigDraft());
  const [configDirty, setConfigDirty] = useState(false);
  const [rawConfigText, setRawConfigText] = useState<string>('{}');
  const [rawConfigDirty, setRawConfigDirty] = useState(false);
  const [manualAuthOpen, setManualAuthOpen] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [manualMachineId, setManualMachineId] = useState('');
  const [probeSnapshotKey, setProbeSnapshotKey] = useState<string | null>(() =>
    probeResult ? buildProbeSnapshotKey(status, config) : null
  );

  const pristineConfigDraft = buildConfigDraft(config);

  const effectivePort = configDirty ? configDraft.port : pristineConfigDraft.port;
  const effectiveAutoStart = configDirty ? configDraft.auto_start : pristineConfigDraft.auto_start;
  const effectiveGhostMode = configDirty ? configDraft.ghost_mode : pristineConfigDraft.ghost_mode;
  const effectiveModel = configDirty ? configDraft.model : pristineConfigDraft.model;
  const effectiveOpusModel = configDirty ? configDraft.opus_model : pristineConfigDraft.opus_model;
  const effectiveSonnetModel = configDirty
    ? configDraft.sonnet_model
    : pristineConfigDraft.sonnet_model;
  const effectiveHaikuModel = configDirty
    ? configDraft.haiku_model
    : pristineConfigDraft.haiku_model;
  const effectiveRawConfigText = rawConfigDirty
    ? rawConfigText
    : JSON.stringify(rawSettings?.settings ?? {}, null, 2);
  const rawSettingsReady = Boolean(rawSettings);
  const rawParseResult = useMemo(
    () => parseRawSettings(effectiveRawConfigText),
    [effectiveRawConfigText]
  );
  const isRawJsonValid = rawParseResult.isValid;
  const hasChanges = configDirty || rawConfigDirty;
  const canSave = !rawConfigDirty || (rawSettingsReady && isRawJsonValid);
  const currentProbeSnapshotKey = buildProbeSnapshotKey(status, config);
  const visibleProbeResult =
    probeResult &&
    !hasChanges &&
    probeSnapshotKey !== null &&
    probeSnapshotKey === currentProbeSnapshotKey
      ? probeResult
      : null;
  const orderedModels = useMemo(() => {
    const seen = new Set<string>();
    const sorted = [...models].sort((a, b) => a.name.localeCompare(b.name));
    const deduped = sorted.filter((model) => {
      if (seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    });

    if (effectiveModel && !sorted.some((model) => model.id === effectiveModel)) {
      return [
        {
          id: effectiveModel,
          name: effectiveModel,
          provider: 'custom',
        },
        ...deduped,
      ];
    }

    return deduped;
  }, [models, effectiveModel]);

  const updateConfigDraft = (updater: (draft: CursorConfigDraft) => CursorConfigDraft) => {
    setConfigDraft((previousDraft) => {
      const baseDraft = configDirty ? previousDraft : pristineConfigDraft;
      return updater(baseDraft);
    });
    setConfigDirty(true);
  };

  const clearProbeState = () => {
    resetProbe();
    setProbeSnapshotKey(null);
  };

  const resetConfigDraft = (nextConfig = config) => {
    setConfigDraft(buildConfigDraft(nextConfig));
    setConfigDirty(false);
  };

  const canStart = Boolean(status?.enabled && status?.authenticated && !status?.token_expired);
  const integrationBadge = useMemo(
    () =>
      status?.enabled ? (
        <Badge>{t('cursorPage.enabled')}</Badge>
      ) : (
        <Badge variant="secondary">{t('cursorPage.disabled')}</Badge>
      ),
    [status?.enabled, t]
  );

  const handleSaveConfig = async ({
    suppressSuccessToast = false,
  }: { suppressSuccessToast?: boolean } = {}) => {
    const parsedPort = Number(effectivePort);
    if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      toast.error(t('cursorPage.invalidPort'));
      return false;
    }
    if (!effectiveModel.trim()) {
      toast.error(t('cursorPage.defaultModelRequired'));
      return false;
    }

    try {
      await updateConfigAsync({
        port: parsedPort,
        auto_start: effectiveAutoStart,
        ghost_mode: effectiveGhostMode,
        model: effectiveModel,
        opus_model: effectiveOpusModel || undefined,
        sonnet_model: effectiveSonnetModel || undefined,
        haiku_model: effectiveHaikuModel || undefined,
      });
      setConfigDirty(false);
      setConfigDraft(
        buildConfigDraft({
          port: parsedPort,
          auto_start: effectiveAutoStart,
          ghost_mode: effectiveGhostMode,
          model: effectiveModel,
          opus_model: effectiveOpusModel || undefined,
          sonnet_model: effectiveSonnetModel || undefined,
          haiku_model: effectiveHaikuModel || undefined,
        })
      );
      clearProbeState();
      if (!suppressSuccessToast) {
        toast.success(t('cursorPage.savedConfig'));
      }
      return true;
    } catch (error) {
      toast.error((error as Error).message || t('cursorPage.failedSaveConfig'));
      return false;
    }
  };

  const applyPreset = (preset: 'codex53' | 'claude46' | 'gemini3') => {
    if (modelsLoading) {
      toast.error(t('cursorPage.modelsLoadingWait'));
      return;
    }

    if (models.length === 0) {
      toast.error(t('cursorPage.noModelsAvailable'));
      return;
    }

    const fallbackModel = effectiveModel || currentModel || models[0]?.id || 'gpt-5.3-codex';
    const codex53 = pickModelByAliases(
      models,
      ['gpt-5.3-codex', 'gpt53codex', 'GPT-5.3 Codex'],
      pickModelByPatterns(models, [/gpt[-.]?5.*codex/i], fallbackModel)
    );
    const codexMax = pickModelByAliases(
      models,
      ['gpt-5.1-codex-max', 'gpt51codexmax', 'GPT-5.1 Codex Max'],
      pickModelByPatterns(models, [/gpt[-.]?5.*codex.*max/i], codex53)
    );
    const codexFast = pickModelByAliases(
      models,
      ['gpt-5-fast', 'gpt5fast', 'GPT-5 Fast'],
      pickModelByPatterns(models, [/gpt[-.]?5.*fast/i], codex53)
    );
    const codexMini = pickModelByAliases(
      models,
      ['gpt-5-mini', 'gpt5mini', 'GPT-5 Mini'],
      pickModelByPatterns(models, [/gpt[-.]?5.*mini/i], codexFast)
    );
    const opus46 = pickModelByAliases(
      models,
      ['claude-4.6-opus', 'claude46opus', 'Claude 4.6 Opus'],
      pickModelByPatterns(models, [/claude[-.]?4\.?6.*opus/i, /claude.*opus/i], codex53)
    );
    const sonnet45 = pickModelByAliases(
      models,
      ['claude-4.5-sonnet', 'claude45sonnet', 'Claude 4.5 Sonnet'],
      pickModelByPatterns(models, [/claude[-.]?4\.?5.*sonnet/i, /claude.*sonnet/i], codex53)
    );
    const haiku45 = pickModelByAliases(
      models,
      ['claude-4.5-haiku', 'claude45haiku', 'Claude 4.5 Haiku'],
      pickModelByPatterns(models, [/claude[-.]?4\.?5.*haiku/i, /haiku/i], sonnet45)
    );
    const gemini3Pro = pickModelByAliases(
      models,
      ['gemini-3-pro', 'gemini3pro', 'Gemini 3 Pro'],
      pickModelByPatterns(models, [/gemini[-.]?3.*pro/i], codex53)
    );
    const gemini3Flash = pickModelByAliases(
      models,
      ['gemini-3-flash', 'gemini3flash', 'Gemini 3 Flash'],
      pickModelByPatterns(models, [/gemini[-.]?3.*flash/i, /gemini[-.]?2\.?5.*flash/i], gemini3Pro)
    );

    if (preset === 'codex53') {
      updateConfigDraft((draft) => ({
        ...draft,
        model: codex53,
        opus_model: codexMax,
        sonnet_model: codex53,
        haiku_model: codexMini,
      }));
      toast.success(t('cursorPage.appliedCodexPreset'));
      return;
    }

    if (preset === 'claude46') {
      updateConfigDraft((draft) => ({
        ...draft,
        model: opus46,
        opus_model: opus46,
        sonnet_model: sonnet45,
        haiku_model: haiku45,
      }));
      toast.success(t('cursorPage.appliedClaudePreset'));
      return;
    }

    updateConfigDraft((draft) => ({
      ...draft,
      model: gemini3Pro,
      opus_model: gemini3Pro,
      sonnet_model: gemini3Pro,
      haiku_model: gemini3Flash,
    }));
    toast.success(t('cursorPage.appliedGeminiPreset'));
  };

  const handleToggleEnabled = async (enabled: boolean) => {
    try {
      await updateConfigAsync({ enabled });
      clearProbeState();
      toast.success(
        enabled ? t('cursorPage.integrationEnabled') : t('cursorPage.integrationDisabled')
      );
    } catch (error) {
      toast.error((error as Error).message || t('cursorPage.failedUpdateIntegration'));
    }
  };

  const handleAutoDetectAuth = async () => {
    try {
      await autoDetectAuthAsync();
      clearProbeState();
      toast.success(t('cursorPage.credentialsImported'));
    } catch (error) {
      toast.error((error as Error).message || t('cursorPage.autoDetectFailed'));
    }
  };

  const handleManualAuthImport = async () => {
    if (!manualToken.trim() || !manualMachineId.trim()) {
      toast.error(t('cursorPage.manualRequired'));
      return;
    }

    try {
      await importManualAuthAsync({
        accessToken: manualToken.trim(),
        machineId: manualMachineId.trim(),
      });
      clearProbeState();
      toast.success(t('cursorPage.credentialsImported'));
      setManualAuthOpen(false);
      setManualToken('');
      setManualMachineId('');
    } catch (error) {
      toast.error((error as Error).message || t('cursorPage.manualImportFailed'));
    }
  };

  const handleStartDaemon = async () => {
    try {
      const result = await startDaemonAsync();
      if (!result.success) {
        toast.error(result.error || t('cursorPage.failedStartDaemon'));
        return;
      }
      clearProbeState();
      toast.success(
        result.pid
          ? t('cursorPage.daemonStartedWithPid', { pid: result.pid })
          : t('cursorPage.daemonStarted')
      );
    } catch (error) {
      toast.error((error as Error).message || t('cursorPage.failedStartDaemon'));
    }
  };

  const handleStopDaemon = async () => {
    try {
      const result = await stopDaemonAsync();
      if (!result.success) {
        toast.error(result.error || t('cursorPage.failedStopDaemon'));
        return;
      }
      clearProbeState();
      toast.success(t('cursorPage.daemonStopped'));
    } catch (error) {
      toast.error((error as Error).message || t('cursorPage.failedStopDaemon'));
    }
  };

  const handleRunProbe = async () => {
    if (hasChanges) {
      toast.error(t('cursorPage.probeSaveFirst'));
      return;
    }

    try {
      const result = await runProbeAsync();
      const refreshedStatus = await refetchStatus();
      setProbeSnapshotKey(buildProbeSnapshotKey(refreshedStatus.data ?? status, config));
      if (result.ok) {
        toast.success(t('cursorPage.probeSucceeded'));
        return;
      }

      toast.error(result.message || t('cursorPage.probeFailed'));
    } catch (error) {
      toast.error((error as Error).message || t('cursorPage.probeFailed'));
    }
  };

  const handleSaveRawSettings = async ({
    suppressSuccessToast = false,
  }: { suppressSuccessToast?: boolean } = {}) => {
    if (!rawSettingsReady) {
      toast.error(t('cursorPage.rawLoading'));
      return false;
    }

    if (!rawParseResult.isValid || !rawParseResult.settings) {
      toast.error(rawParseResult.error || t('cursorPage.invalidJson'));
      return false;
    }

    try {
      await saveRawSettingsAsync({
        settings: rawParseResult.settings,
        expectedMtime: rawSettings?.mtime,
      });
      setRawConfigDirty(false);
      clearProbeState();
      if (!suppressSuccessToast) {
        toast.success(t('cursorPage.rawSaved'));
      }
      return true;
    } catch (error) {
      if (isApiConflictError(error)) {
        toast.error(t('cursorPage.rawChanged'));
      } else {
        toast.error((error as Error).message || t('cursorPage.failedSaveRaw'));
      }
      return false;
    }
  };

  const handleSaveAll = async () => {
    if (!hasChanges) return;

    const saveConfig = configDirty;
    const saveRawSettings = rawConfigDirty;

    if (saveConfig) {
      const saved = await handleSaveConfig({
        suppressSuccessToast: saveRawSettings,
      });
      if (!saved) return;
    }

    if (saveRawSettings) {
      const saved = await handleSaveRawSettings({
        suppressSuccessToast: saveConfig,
      });
      if (!saved) return;
    }

    if (saveConfig && saveRawSettings) {
      toast.success(t('cursorPage.savedAll'));
    }
  };

  const handleHeaderRefresh = async () => {
    setRawConfigDirty(false);
    clearProbeState();
    const [, refreshedConfig] = await Promise.all([
      refetchStatus(),
      refetchConfig(),
      refetchRawSettings(),
    ]);
    resetConfigDraft(refreshedConfig.data ?? config);
  };

  return (
    <>
      <div className="flex h-full min-h-0 overflow-hidden">
        <div className="w-80 border-r flex flex-col bg-muted/30 shrink-0">
          <div className="p-4 border-b bg-background">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <img
                  src="/assets/sidebar/cursor.svg"
                  alt=""
                  className="w-5 h-5 object-contain shrink-0"
                />
                <h1 className="font-semibold">{t('cursorPage.title')}</h1>
                <Badge
                  variant="outline"
                  className="h-5 border-red-500/50 bg-red-500/10 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-300"
                >
                  {t('cursorPage.deprecated')}
                </Badge>
                {integrationBadge}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => refetchStatus()}
                disabled={statusLoading}
                aria-label={t('cursorPage.refreshStatus')}
                title={t('cursorPage.refreshStatus')}
              >
                <RefreshCw className={cn('w-4 h-4', statusLoading && 'animate-spin')} />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('cursorPage.subtitle')}</p>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-3 space-y-4">
              <div className="rounded-md border border-yellow-500/50 bg-yellow-500/15 p-3 space-y-1.5">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 shrink-0" />
                  <span className="text-xs font-semibold text-yellow-800 dark:text-yellow-200">
                    {t('cursorPage.unofficialTitle')}
                  </span>
                </div>
                <ul className="text-[11px] text-yellow-700 dark:text-yellow-300 space-y-0.5 pl-6 list-disc">
                  <li>{t('cursorPage.unofficialItem1')}</li>
                  <li>{t('cursorPage.unofficialItem2')}</li>
                  <li>{t('cursorPage.unofficialItem3')}</li>
                </ul>
              </div>

              <div className="rounded-md border border-border/70 bg-background/90 p-3 space-y-3">
                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('cursorPage.supportedPathTitle')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('cursorPage.supportedPathDesc')}
                  </p>
                </div>
                <div className="grid gap-2">
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => navigate('/cliproxy?provider=cursor&action=auth')}
                  >
                    <Key className="w-3.5 h-3.5 mr-1.5" />
                    {t('cursorPage.startCliproxyAuth')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => navigate('/cliproxy?provider=cursor')}
                  >
                    <Zap className="w-3.5 h-3.5 mr-1.5" />
                    {t('cursorPage.openCliproxyCursor')}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <StatusItem
                  icon={ShieldCheck}
                  label={t('cursorPage.integration')}
                  ok={Boolean(status?.enabled)}
                  detail={status?.enabled ? t('cursorPage.enabled') : t('cursorPage.disabled')}
                />
                <StatusItem
                  icon={Key}
                  label={t('cursorPage.authentication')}
                  ok={Boolean(status?.authenticated && !status?.token_expired)}
                  detail={
                    status?.authenticated
                      ? status?.token_expired
                        ? t('cursorPage.expired')
                        : (status.auth_method ?? t('cursorPage.connected'))
                      : t('cursorPage.notConnected')
                  }
                />
                <StatusItem
                  icon={Server}
                  label={t('cursorPage.daemon')}
                  ok={Boolean(status?.daemon_running)}
                  detail={
                    status?.daemon_running ? t('cursorPage.running') : t('cursorPage.stopped')
                  }
                />
              </div>

              <div className="rounded-md border bg-background/80 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Code2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('cursorPage.liveProbe')}
                    </span>
                  </div>
                  <Badge
                    variant={visibleProbeResult ? 'outline' : 'secondary'}
                    className={cn(
                      visibleProbeResult?.ok &&
                        'border-green-500/40 text-green-600 dark:text-green-300',
                      visibleProbeResult &&
                        !visibleProbeResult.ok &&
                        'border-red-500/40 text-red-600 dark:text-red-300'
                    )}
                  >
                    {visibleProbeResult
                      ? visibleProbeResult.ok
                        ? t('cursorPage.probeSucceeded')
                        : t('cursorPage.probeFailed')
                      : t('cursorPage.probeNotRun')}
                  </Badge>
                </div>

                {visibleProbeResult ? (
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{t('cursorPage.probeStage')}</span>
                      <span className="font-mono uppercase">{visibleProbeResult.stage}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">
                        {t('cursorPage.probeHttpStatus')}
                      </span>
                      <span className="font-mono">{visibleProbeResult.status}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{t('cursorPage.probeDuration')}</span>
                      <span className="font-mono">{visibleProbeResult.duration_ms} ms</span>
                    </div>
                    {visibleProbeResult.model ? (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">{t('cursorPage.probeModel')}</span>
                        <span className="font-mono text-[11px] text-right break-all">
                          {visibleProbeResult.model}
                        </span>
                      </div>
                    ) : null}
                    <div className="space-y-1 pt-1">
                      <span className="text-muted-foreground">{t('cursorPage.probeMessage')}</span>
                      <p className="text-[11px] leading-relaxed break-words">
                        {visibleProbeResult.message}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">{t('cursorPage.probeNotRun')}</p>
                )}

                <p className="text-[11px] text-muted-foreground">
                  {t('cursorPage.probeLocalReadinessHint')}
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t('cursorPage.actions')}
                </p>

                {status?.enabled ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => handleToggleEnabled(false)}
                    disabled={isUpdatingConfig}
                  >
                    <PowerOff className="w-3.5 h-3.5 mr-1.5" />
                    {t('cursorPage.disableIntegration')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => handleToggleEnabled(true)}
                    disabled={isUpdatingConfig}
                  >
                    <Power className="w-3.5 h-3.5 mr-1.5" />
                    {t('cursorPage.enableIntegration')}
                  </Button>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleAutoDetectAuth}
                  disabled={isAutoDetectingAuth}
                >
                  {isAutoDetectingAuth ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Key className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  {t('cursorPage.autoDetectAuth')}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => setManualAuthOpen(true)}
                >
                  <Key className="w-3.5 h-3.5 mr-1.5" />
                  {t('cursorPage.manualAuthImport')}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleRunProbe}
                  disabled={isRunningProbe}
                >
                  {isRunningProbe ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Code2 className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  {isRunningProbe
                    ? t('cursorPage.probing')
                    : visibleProbeResult
                      ? t('cursorPage.rerunLiveProbe')
                      : t('cursorPage.runLiveProbe')}
                </Button>

                {status?.daemon_running ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={handleStopDaemon}
                    disabled={isStoppingDaemon}
                  >
                    {isStoppingDaemon ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <PowerOff className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    {t('cursorPage.stopDaemon')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={handleStartDaemon}
                    disabled={!canStart}
                  >
                    {isStartingDaemon ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    {t('cursorPage.startDaemon')}
                  </Button>
                )}
              </div>
            </div>
          </ScrollArea>

          <div className="p-3 border-t bg-background text-xs text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>{t('cursorPage.port')}</span>
              <span>{status?.port ?? config?.port ?? DEFAULT_CURSOR_PORT}</span>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col min-w-0 bg-background overflow-hidden">
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b bg-background flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold">{t('cursorPage.configuration')}</h2>
                    {rawSettings && (
                      <Badge variant="outline" className="text-xs">
                        cursor.settings.json
                      </Badge>
                    )}
                  </div>
                  {rawSettings && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t('cursorPage.lastModified')}{' '}
                      {rawSettings.exists
                        ? new Date(rawSettings.mtime).toLocaleString()
                        : t('cursorPage.neverSaved')}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleHeaderRefresh}
                  disabled={statusLoading || rawSettingsLoading}
                  aria-label={t('cursorPage.refreshConfiguration')}
                  title={t('cursorPage.refreshConfiguration')}
                >
                  <RefreshCw
                    className={cn(
                      'w-4 h-4',
                      (statusLoading || rawSettingsLoading) && 'animate-spin'
                    )}
                  />
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveAll}
                  disabled={isUpdatingConfig || isSavingRawSettings || !hasChanges || !canSave}
                >
                  {isUpdatingConfig || isSavingRawSettings ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                      {t('cursorPage.saving')}
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-1" />
                      {t('cursorPage.save')}
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="flex-1 min-h-0 flex divide-x overflow-hidden">
              <div className="w-[540px] shrink-0 flex flex-col min-h-0 overflow-hidden bg-muted/5">
                <Tabs defaultValue="config" className="h-full flex flex-col">
                  <div className="px-4 pt-4 shrink-0">
                    <TabsList className="w-full">
                      <TabsTrigger value="config" className="flex-1">
                        {t('cursorPage.modelConfig')}
                      </TabsTrigger>
                      <TabsTrigger value="settings" className="flex-1">
                        {t('cursorPage.settings')}
                      </TabsTrigger>
                      <TabsTrigger value="info" className="flex-1">
                        {t('cursorPage.info')}
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                    <TabsContent
                      value="config"
                      className="flex-1 mt-0 border-0 p-0 data-[state=inactive]:hidden flex flex-col overflow-hidden"
                    >
                      <ScrollArea className="flex-1">
                        <div className="p-4 space-y-6">
                          <div>
                            <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                              <Sparkles className="w-4 h-4" />
                              {t('cursorPage.presets')}
                            </h3>
                            <p className="text-xs text-muted-foreground mb-3">
                              {t('cursorPage.presetsDesc')}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs h-7 gap-1"
                                onClick={() => applyPreset('codex53')}
                                disabled={modelsLoading || models.length === 0}
                                /* TODO i18n: missing key for "OpenAI-only mapping: GPT-5.3 Codex / Codex Max / GPT-5 Mini" */
                                title="OpenAI-only mapping: GPT-5.3 Codex / Codex Max / GPT-5 Mini"
                              >
                                <Zap className="w-3 h-3" />
                                GPT-5.3 Codex
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs h-7 gap-1"
                                onClick={() => applyPreset('claude46')}
                                disabled={modelsLoading || models.length === 0}
                                /* TODO i18n: missing key for "Claude-first mapping: Opus 4.6 / Sonnet 4.5 / Haiku 4.5" */
                                title="Claude-first mapping: Opus 4.6 / Sonnet 4.5 / Haiku 4.5"
                              >
                                <Zap className="w-3 h-3" />
                                Claude 4.6
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs h-7 gap-1"
                                onClick={() => applyPreset('gemini3')}
                                disabled={modelsLoading || models.length === 0}
                                /* TODO i18n: missing key for "Gemini-first mapping: Gemini 3 Pro + Gemini 3 Flash" */
                                title="Gemini-first mapping: Gemini 3 Pro + Gemini 3 Flash"
                              >
                                <Zap className="w-3 h-3" />
                                Gemini 3 Pro
                              </Button>
                            </div>
                          </div>

                          <Separator />

                          <div>
                            <h3 className="text-sm font-medium mb-2">
                              {t('cursorPage.modelMapping')}
                            </h3>
                            <p className="text-xs text-muted-foreground mb-4">
                              {t('cursorPage.modelMappingDesc')}
                            </p>
                            <div className="space-y-4">
                              <CursorModelSelector
                                label={t('cursorPage.defaultModel')}
                                description={t('cursorPage.defaultModelDesc')}
                                value={effectiveModel}
                                models={orderedModels}
                                disabled={modelsLoading}
                                onChange={(value) => {
                                  updateConfigDraft((draft) => ({ ...draft, model: value }));
                                }}
                              />
                              <CursorModelSelector
                                label={t('cursorPage.opusModel')}
                                description={t('cursorPage.opusModelDesc')}
                                value={effectiveOpusModel}
                                models={orderedModels}
                                disabled={modelsLoading}
                                allowDefaultFallback
                                onChange={(value) => {
                                  updateConfigDraft((draft) => ({ ...draft, opus_model: value }));
                                }}
                              />
                              <CursorModelSelector
                                label={t('cursorPage.sonnetModel')}
                                description={t('cursorPage.sonnetModelDesc')}
                                value={effectiveSonnetModel}
                                models={orderedModels}
                                disabled={modelsLoading}
                                allowDefaultFallback
                                onChange={(value) => {
                                  updateConfigDraft((draft) => ({ ...draft, sonnet_model: value }));
                                }}
                              />
                              <CursorModelSelector
                                label={t('cursorPage.haikuModel')}
                                description={t('cursorPage.haikuModelDesc')}
                                value={effectiveHaikuModel}
                                models={orderedModels}
                                disabled={modelsLoading}
                                allowDefaultFallback
                                onChange={(value) => {
                                  updateConfigDraft((draft) => ({ ...draft, haiku_model: value }));
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </ScrollArea>
                    </TabsContent>

                    <TabsContent
                      value="settings"
                      className="flex-1 mt-0 border-0 p-0 data-[state=inactive]:hidden flex flex-col overflow-hidden"
                    >
                      <ScrollArea className="flex-1">
                        <div className="p-4 space-y-6">
                          <div className="space-y-4">
                            <h3 className="text-sm font-medium">
                              {t('cursorPage.runtimeSettings')}
                            </h3>

                            <div className="space-y-2">
                              <Label htmlFor="cursor-port" className="text-xs">
                                {t('cursorPage.port')}
                              </Label>
                              <Input
                                id="cursor-port"
                                type="number"
                                min={1}
                                max={65535}
                                className="max-w-[150px] h-8"
                                value={effectivePort}
                                onChange={(e) => {
                                  updateConfigDraft((draft) => ({
                                    ...draft,
                                    port: e.target.value,
                                  }));
                                }}
                              />
                            </div>

                            <div className="flex items-center justify-between rounded-lg border p-3">
                              <div className="space-y-0.5">
                                <Label htmlFor="cursor-auto-start" className="text-xs">
                                  {t('cursorPage.autoStartDaemon')}
                                </Label>
                                <p className="text-[10px] text-muted-foreground">
                                  {t('cursorPage.autoStartDesc')}
                                </p>
                              </div>
                              <Switch
                                id="cursor-auto-start"
                                checked={effectiveAutoStart}
                                onCheckedChange={(value) => {
                                  updateConfigDraft((draft) => ({ ...draft, auto_start: value }));
                                }}
                              />
                            </div>

                            <div className="flex items-center justify-between rounded-lg border p-3">
                              <div className="space-y-0.5">
                                <Label htmlFor="cursor-ghost-mode" className="text-xs">
                                  {t('cursorPage.ghostMode')}
                                </Label>
                                <p className="text-[10px] text-muted-foreground">
                                  {t('cursorPage.ghostModeDesc')}
                                </p>
                              </div>
                              <Switch
                                id="cursor-ghost-mode"
                                checked={effectiveGhostMode}
                                onCheckedChange={(value) => {
                                  updateConfigDraft((draft) => ({ ...draft, ghost_mode: value }));
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </ScrollArea>
                    </TabsContent>

                    <TabsContent
                      value="info"
                      className="flex-1 mt-0 border-0 p-0 data-[state=inactive]:hidden flex flex-col overflow-hidden"
                    >
                      <ScrollArea className="flex-1">
                        <div className="p-4 space-y-6">
                          <div className="space-y-3 bg-card rounded-lg border p-4 shadow-sm">
                            <div className="grid grid-cols-[100px_1fr] gap-2 text-sm items-center">
                              <span className="font-medium text-muted-foreground">
                                {t('cursorPage.provider')}
                              </span>
                              <span className="font-mono">Cursor IDE (Legacy)</span>
                            </div>
                            <div className="grid grid-cols-[100px_1fr] gap-2 text-sm items-center">
                              <span className="font-medium text-muted-foreground">
                                {t('cursorPage.filePath')}
                              </span>
                              <code className="bg-muted px-1.5 py-0.5 rounded text-xs break-all">
                                {rawSettings?.path ?? '~/.ccs/cursor.settings.json'}
                              </code>
                            </div>
                            {/* TODO i18n: missing key for model mapping env var info paragraph */}
                            <p className="text-xs text-muted-foreground">
                              Legacy bridge model mapping writes `ANTHROPIC_MODEL`,
                              `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, and
                              `ANTHROPIC_DEFAULT_HAIKU_MODEL` in `cursor.settings.json`.
                            </p>
                          </div>

                          <div>
                            <h3 className="text-sm font-medium mb-3">
                              {t('cursorPage.availableModels')}
                            </h3>
                            {modelsLoading ? (
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                {t('cursorPage.loadingModels')}
                              </div>
                            ) : models.length === 0 ? (
                              <p className="text-sm text-muted-foreground">
                                {t('cursorPage.noModels')}
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {models.map((model) => (
                                  <div
                                    key={model.id}
                                    className="rounded-lg border px-3 py-2 flex items-center justify-between"
                                  >
                                    <div>
                                      <p className="text-sm font-medium">{model.id}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {model.name} • {model.provider}
                                      </p>
                                    </div>
                                    {model.id === currentModel && (
                                      <Badge>{t('cursorPage.default')}</Badge>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </ScrollArea>
                    </TabsContent>
                  </div>
                </Tabs>
              </div>

              <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                <div className="px-6 py-2 bg-muted/30 border-b flex items-center gap-2 shrink-0 h-[45px]">
                  <Code2 className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-muted-foreground">
                    {t('cursorPage.rawConfiguration')}
                  </span>
                </div>
                <RawEditorSection
                  rawJsonContent={effectiveRawConfigText}
                  isRawJsonValid={isRawJsonValid}
                  rawJsonEdits={rawConfigDirty ? rawConfigText : null}
                  rawSettingsEnv={rawSettings?.settings?.env}
                  onChange={(value) => {
                    setRawConfigDirty(true);
                    setRawConfigText(value);
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={manualAuthOpen} onOpenChange={setManualAuthOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('cursorPage.manualImportTitle')}</DialogTitle>
            <DialogDescription>{t('cursorPage.manualImportDesc')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cursor-manual-token">{t('cursorPage.accessToken')}</Label>
              <Input
                id="cursor-manual-token"
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                placeholder={t('cursorPage.accessTokenPlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cursor-manual-machine-id">{t('cursorPage.machineId')}</Label>
              <Input
                id="cursor-manual-machine-id"
                value={manualMachineId}
                onChange={(e) => setManualMachineId(e.target.value)}
                placeholder={t('cursorPage.machineIdPlaceholder')}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setManualAuthOpen(false)}>
              {t('cursorPage.cancel')}
            </Button>
            <Button onClick={handleManualAuthImport} disabled={isImportingManualAuth}>
              {isImportingManualAuth ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Key className="w-4 h-4 mr-2" />
              )}
              {t('cursorPage.import')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
