import { useMemo, useState } from 'react';
import { ProviderLogo } from '@/components/cliproxy/provider-logo';
import {
  formatRequestedUpstreamModelRules,
  getAiProviderFamilyVisual,
  getRequestedUpstreamModelRuleErrors,
  parseRequestedUpstreamModelRules,
} from '@/lib/provider-config';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ChevronDown, KeyRound, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  AiProviderEntryView,
  AiProviderFamilyId,
  UpsertAiProviderEntryInput,
} from '../../../../../src/cliproxy/ai-providers';

interface ProviderEntryDialogProps {
  family: AiProviderFamilyId;
  entry?: AiProviderEntryView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: UpsertAiProviderEntryInput) => Promise<void> | void;
  isSaving: boolean;
}

type DialogGuide = {
  familyName: string;
  description: string;
  requiredNow: string[];
  optionalLater: string[];
  keyLabel: string;
  keyPlaceholder: string;
  keyHelper: string;
  connectorPlaceholder?: string;
  connectorHelper?: string;
  baseUrlPlaceholder: string;
  baseUrlHelper: string;
  aliasesPlaceholder: string;
  aliasesHelper: string;
  headersPlaceholder: string;
};

function getDialogGuide(family: AiProviderFamilyId): DialogGuide {
  switch (family) {
    case 'gemini-api-key':
      return {
        familyName: 'Gemini',
        description:
          'Store the Gemini key here so CLIProxy can route Gemini requests without creating a separate CCS API Profile.',
        requiredNow: [
          'Paste the Gemini API key.',
          'Leave Base URL empty unless you use a custom Gemini host.',
        ],
        optionalLater: [
          'Model mappings only when requested names and Gemini names differ.',
          'Headers only when your provider setup requires them.',
        ],
        keyLabel: 'Gemini API Key',
        keyPlaceholder: 'AIza...',
        keyHelper: 'This is the only field most Gemini setups need.',
        baseUrlPlaceholder: 'https://generativelanguage.googleapis.com',
        baseUrlHelper: 'Optional. Leave blank to keep the default Gemini endpoint.',
        aliasesPlaceholder: 'claude-sonnet-4-5=gemini-2.5-pro',
        aliasesHelper:
          'Format: requested=upstream. Leave this blank unless the upstream Gemini model name differs.',
        headersPlaceholder: 'X-Goog-User-Project: your-project',
      };
    case 'codex-api-key':
      return {
        familyName: 'Codex',
        description:
          'Store the Codex or OpenAI key here so CLIProxy can route Codex requests without duplicating the setup in API Profiles.',
        requiredNow: [
          'Paste the Codex or OpenAI API key.',
          'Leave Base URL empty unless this route should target another OpenAI-style endpoint.',
        ],
        optionalLater: [
          'Model mappings only when the upstream model ID differs.',
          'Headers only when org or project routing needs them.',
        ],
        keyLabel: 'Codex API Key',
        keyPlaceholder: 'sk-...',
        keyHelper: 'This is the only field most Codex setups need.',
        baseUrlPlaceholder: 'https://api.openai.com/v1',
        baseUrlHelper: 'Optional. Leave blank to keep the default Codex endpoint.',
        aliasesPlaceholder: 'claude-sonnet-4-5=gpt-5',
        aliasesHelper:
          'Format: requested=upstream. Add a mapping only when the upstream model name differs.',
        headersPlaceholder: 'OpenAI-Organization: org_...',
      };
    case 'claude-api-key':
      return {
        familyName: 'Claude',
        description:
          'Store the Anthropic or compatible key here for CLIProxy-managed Claude routing. Save the key first, then add rewrites only if this route needs them.',
        requiredNow: [
          'Paste the Claude or Anthropic-compatible API key.',
          'Leave Base URL empty unless this route should target another compatible endpoint.',
        ],
        optionalLater: [
          'Model mappings only when the requested and upstream Claude model IDs differ.',
          'Proxy, prefix, exclusions, and headers only for advanced routing cases.',
        ],
        keyLabel: 'Claude API Key',
        keyPlaceholder: 'sk-ant-...',
        keyHelper: 'Most Claude routes can start with the key only.',
        baseUrlPlaceholder: 'https://api.anthropic.com',
        baseUrlHelper: 'Optional. Leave blank to keep the default Claude-compatible endpoint.',
        aliasesPlaceholder: 'claude-sonnet-4-5=claude-3-7-sonnet-latest',
        aliasesHelper:
          'Format: requested=upstream. Add a mapping only when the upstream model ID should differ.',
        headersPlaceholder: 'X-Project: internal-routing',
      };
    case 'vertex-api-key':
      return {
        familyName: 'Vertex',
        description:
          'Store the Vertex key here so CLIProxy can route Vertex traffic without creating a separate CCS API Profile.',
        requiredNow: [
          'Paste the Vertex API key.',
          'Leave Base URL empty unless a regional or gateway endpoint is required.',
        ],
        optionalLater: [
          'Model mappings only when the upstream name differs.',
          'Headers only when the provider expects extra routing context.',
        ],
        keyLabel: 'Vertex API Key',
        keyPlaceholder: 'AIza...',
        keyHelper: 'Most Vertex routes only need the key.',
        baseUrlPlaceholder: 'https://vertex.googleapis.com',
        baseUrlHelper: 'Optional. Leave blank to keep the default Vertex endpoint.',
        aliasesPlaceholder: 'claude-sonnet-4-5=gemini-2.5-pro',
        aliasesHelper:
          'Format: requested=upstream. Leave blank unless the upstream model name differs.',
        headersPlaceholder: 'X-Goog-User-Project: your-project',
      };
    case 'openai-compatibility':
      return {
        familyName: 'OpenAI-Compatible Connector',
        description:
          'Create a named connector for OpenRouter, Together, or any OpenAI-style endpoint. This page owns the connector setup directly inside CLIProxy.',
        requiredNow: [
          'Pick a connector name such as openrouter or together.',
          'Set the connector Base URL.',
          'Add at least one API key before saving.',
        ],
        optionalLater: [
          'Model mappings only when requested and upstream model names differ.',
          'Headers only when the connector requires provider-specific auth or routing.',
        ],
        keyLabel: 'API Keys',
        keyPlaceholder: 'sk-...',
        keyHelper: 'Add one key per line. Most connectors start with a single key.',
        connectorPlaceholder: 'openrouter',
        connectorHelper: 'This becomes the connector label in the saved entries list.',
        baseUrlPlaceholder: 'https://openrouter.ai/api/v1',
        baseUrlHelper: 'Required for connectors. This is the upstream OpenAI-style endpoint.',
        aliasesPlaceholder: 'claude-sonnet-4-5=gpt-4.1',
        aliasesHelper:
          'Format: requested=upstream. Leave blank unless the connector expects a different model ID.',
        headersPlaceholder: 'HTTP-Referer: https://your-app.example',
      };
  }
}

function parseDelimitedLines(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseKeyValueLines(value: string): Array<{ key: string; value: string }> {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const separator = line.includes(':') ? ':' : '=';
      const [key, ...rest] = line.split(separator);
      return { key: key.trim(), value: rest.join(separator).trim() };
    })
    .filter((item) => item.key.length > 0);
}

function parseModelAliasLines(value: string) {
  return parseRequestedUpstreamModelRules(value);
}

function TextArea({
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      rows={rows}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="flex min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
    />
  );
}

function formatHeaders(entry?: AiProviderEntryView | null): string {
  return (entry?.headers || []).map((item) => `${item.key}: ${item.value}`).join('\n');
}

function formatExcludedModels(entry?: AiProviderEntryView | null): string {
  return (entry?.excludedModels || []).join('\n');
}

function formatModelAliases(entry?: AiProviderEntryView | null): string {
  return formatRequestedUpstreamModelRules(entry?.models);
}

function ChecklistCard({
  title,
  items,
  icon,
}: {
  title: string;
  items: string[];
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-background/80 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      <div className="mt-3 space-y-3">
        {items.map((item, index) => (
          <div key={`${title}:${item}`} className="flex items-start gap-3">
            <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border bg-muted/40 text-[11px] font-semibold text-muted-foreground">
              {index + 1}
            </div>
            <div className="text-sm leading-6 text-muted-foreground">{item}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProviderEntryDialog({
  family,
  entry,
  open,
  onOpenChange,
  onSubmit,
  isSaving,
}: ProviderEntryDialogProps) {
  const { t } = useTranslation();
  const guide = useMemo(() => getDialogGuide(family), [family]);
  const isEditing = Boolean(entry);
  const supportsOpenAiCompat = family === 'openai-compatibility';
  const supportsClaudeAdvanced = family === 'claude-api-key';

  const [name, setName] = useState(() => entry?.name || '');
  const [baseUrl, setBaseUrl] = useState(() => entry?.baseUrl || '');
  const [proxyUrl, setProxyUrl] = useState(() => entry?.proxyUrl || '');
  const [prefix, setPrefix] = useState(() => entry?.prefix || '');
  const [apiKey, setApiKey] = useState('');
  const [apiKeys, setApiKeys] = useState('');
  const [headers, setHeaders] = useState(() => formatHeaders(entry));
  const [excludedModels, setExcludedModels] = useState(() => formatExcludedModels(entry));
  const [modelAliases, setModelAliases] = useState(() => formatModelAliases(entry));
  const modelRuleErrors = useMemo(
    () => getRequestedUpstreamModelRuleErrors(modelAliases),
    [modelAliases]
  );
  const [advancedOpen, setAdvancedOpen] = useState(() =>
    Boolean(
      entry?.headers.length || entry?.excludedModels.length || entry?.proxyUrl || entry?.prefix
    )
  );

  const secretHelper = useMemo(() => {
    if (!isEditing || !entry?.secretConfigured) return null;
    return supportsOpenAiCompat
      ? 'Leave API keys blank to keep the stored connector secrets.'
      : 'Leave the API key blank to keep the stored secret.';
  }, [entry?.secretConfigured, isEditing, supportsOpenAiCompat]);

  const handleSubmit = async () => {
    if (modelRuleErrors.length > 0) {
      return;
    }

    const nextApiKey = apiKey.trim();
    const nextApiKeys = parseDelimitedLines(apiKeys);
    const preserveSecrets =
      isEditing && entry?.secretConfigured && !nextApiKey.length && nextApiKeys.length === 0;

    const payload: UpsertAiProviderEntryInput = {
      name: supportsOpenAiCompat ? name : undefined,
      baseUrl,
      proxyUrl: supportsClaudeAdvanced ? proxyUrl : undefined,
      prefix: supportsClaudeAdvanced ? prefix : undefined,
      headers: parseKeyValueLines(headers),
      excludedModels: supportsClaudeAdvanced ? parseDelimitedLines(excludedModels) : undefined,
      models: parseModelAliasLines(modelAliases),
      preserveSecrets,
      ...(supportsOpenAiCompat
        ? nextApiKeys.length > 0
          ? { apiKeys: nextApiKeys }
          : {}
        : nextApiKey.length > 0
          ? { apiKey: nextApiKey }
          : {}),
    };

    await onSubmit(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-3xl">
        <div className="max-h-[85vh] overflow-y-auto">
          <div className="border-b bg-muted/20 px-6 py-5">
            <DialogHeader className="gap-4 text-left">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl border bg-background">
                  <ProviderLogo provider={getAiProviderFamilyVisual(family)} size="md" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <DialogTitle>
                      {isEditing ? `Edit ${guide.familyName}` : `Set up ${guide.familyName}`}
                    </DialogTitle>
                    <Badge variant="outline" className="uppercase text-[11px]">
                      {supportsOpenAiCompat ? 'connector' : 'api-key'}
                    </Badge>
                  </div>
                  <DialogDescription className="mt-1 max-w-2xl leading-6">
                    {guide.description}
                  </DialogDescription>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <ChecklistCard
                  title="Required now"
                  items={guide.requiredNow}
                  icon={<KeyRound className="h-4 w-4 text-primary" />}
                />
                <ChecklistCard
                  title="Optional later"
                  items={guide.optionalLater}
                  icon={<SlidersHorizontal className="h-4 w-4 text-primary" />}
                />
              </div>

              {secretHelper ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                  {secretHelper}
                </div>
              ) : null}
            </DialogHeader>
          </div>

          <div className="space-y-6 px-6 py-6">
            <section className="space-y-4">
              <div>
                <div className="text-sm font-semibold">
                  {t('aiProvidersEntryDialog.requiredSetup')}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Save the smallest working configuration first.
                </div>
              </div>

              {supportsOpenAiCompat ? (
                <div className="grid gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="connector-name">
                      {t('aiProvidersEntryDialog.connectorName')}
                    </Label>
                    <Input
                      id="connector-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder={guide.connectorPlaceholder}
                    />
                    <p className="text-xs text-muted-foreground">{guide.connectorHelper}</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="base-url">Base URL</Label>
                    <Input
                      id="base-url"
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                      placeholder={guide.baseUrlPlaceholder}
                    />
                    <p className="text-xs text-muted-foreground">{guide.baseUrlHelper}</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label>API Keys</Label>
                    <TextArea
                      value={apiKeys}
                      onChange={setApiKeys}
                      rows={4}
                      placeholder={`${guide.keyPlaceholder}\n${guide.keyPlaceholder}`}
                    />
                    <p className="text-xs text-muted-foreground">{guide.keyHelper}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="api-key">{guide.keyLabel}</Label>
                  <Input
                    id="api-key"
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={guide.keyPlaceholder}
                  />
                  <p className="text-xs text-muted-foreground">{guide.keyHelper}</p>
                </div>
              )}
            </section>

            <section className="space-y-4">
              <div>
                <div className="text-sm font-semibold">
                  {t('aiProvidersEntryDialog.optionalRouting')}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Only fill these when the route needs more than the default behavior.
                </div>
              </div>

              {!supportsOpenAiCompat ? (
                <div className="space-y-1.5">
                  <Label htmlFor="base-url">Base URL</Label>
                  <Input
                    id="base-url"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder={guide.baseUrlPlaceholder}
                  />
                  <p className="text-xs text-muted-foreground">{guide.baseUrlHelper}</p>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label>Model Mappings</Label>
                <TextArea
                  value={modelAliases}
                  onChange={setModelAliases}
                  rows={4}
                  placeholder={guide.aliasesPlaceholder}
                />
                <p className="text-xs text-muted-foreground">{guide.aliasesHelper}</p>
                {modelRuleErrors.length > 0 ? (
                  <p className="text-xs text-destructive">{modelRuleErrors[0]}</p>
                ) : null}
              </div>
            </section>

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <div className="rounded-xl border">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left"
                  >
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <SlidersHorizontal className="h-4 w-4 text-primary" />
                        Advanced routing
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Headers
                        {supportsClaudeAdvanced
                          ? ', proxy, prefix, and exclusions.'
                          : ' and provider-specific overrides.'}
                      </div>
                    </div>
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 text-muted-foreground transition-transform',
                        advancedOpen && 'rotate-180'
                      )}
                    />
                  </button>
                </CollapsibleTrigger>

                <CollapsibleContent className="border-t px-4 py-4">
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <Label>Headers</Label>
                      <TextArea
                        value={headers}
                        onChange={setHeaders}
                        rows={3}
                        placeholder={guide.headersPlaceholder}
                      />
                      <p className="text-xs text-muted-foreground">
                        Use headers only when the provider requires extra routing or auth context.
                      </p>
                    </div>

                    {supportsClaudeAdvanced ? (
                      <>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor="prefix">Prefix</Label>
                            <Input
                              id="prefix"
                              value={prefix}
                              onChange={(event) => setPrefix(event.target.value)}
                              placeholder="glm-"
                            />
                            <p className="text-xs text-muted-foreground">
                              Optional. Prepends model names before routing.
                            </p>
                          </div>

                          <div className="space-y-1.5">
                            <Label htmlFor="proxy-url">Proxy URL</Label>
                            <Input
                              id="proxy-url"
                              value={proxyUrl}
                              onChange={(event) => setProxyUrl(event.target.value)}
                              placeholder="http://127.0.0.1:8080"
                            />
                            <p className="text-xs text-muted-foreground">
                              Optional. Sends requests through an intermediate proxy.
                            </p>
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label>Excluded Models</Label>
                          <TextArea
                            value={excludedModels}
                            onChange={setExcludedModels}
                            rows={3}
                            placeholder="claude-opus-4-1\nclaude-sonnet-4-5"
                          />
                          <p className="text-xs text-muted-foreground">
                            Optional. One model ID per line when this route should reject specific
                            upstream models.
                          </p>
                        </div>
                      </>
                    ) : null}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          </div>

          <DialogFooter className="border-t bg-muted/10 px-6 py-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={isSaving || modelRuleErrors.length > 0}
            >
              {isSaving
                ? 'Saving...'
                : supportsOpenAiCompat
                  ? isEditing
                    ? 'Save Connector'
                    : 'Create Connector'
                  : 'Save Entry'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

