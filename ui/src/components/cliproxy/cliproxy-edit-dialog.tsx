/**
 * CLIProxy Variant Edit Dialog Component
 * Phase 05: Dashboard UI full CRUD for composite variants
 */

import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useUpdateVariant } from '@/hooks/use-cliproxy';
import {
  CLIPROXY_PROVIDERS,
  CLIPROXY_PROVIDER_SECTIONS,
  getProviderDisplayName,
  getProviderSection,
  isPlusExtraProvider,
} from '@/lib/provider-config';
import type { UpdateVariant, Variant } from '@/lib/api-client';
import { isDeniedAgyModelId } from '@/lib/utils';

const singleProviderSchema = z.object({
  provider: z.enum(CLIPROXY_PROVIDERS, { message: 'Provider is required' }),
  model: z.string().optional(),
  account: z.string().optional(),
  target: z.enum(['claude', 'droid', 'codex']),
});

const compositeSchema = z.object({
  default_tier: z.enum(['opus', 'sonnet', 'haiku'], { message: 'Default tier is required' }),
  target: z.enum(['claude', 'droid', 'codex']),
  tiers: z.object({
    opus: z.object({
      provider: z.enum(CLIPROXY_PROVIDERS, { message: 'Provider is required' }),
      model: z.string().trim().min(1, 'Model is required'),
      account: z.string().optional(),
    }),
    sonnet: z.object({
      provider: z.enum(CLIPROXY_PROVIDERS, { message: 'Provider is required' }),
      model: z.string().trim().min(1, 'Model is required'),
      account: z.string().optional(),
    }),
    haiku: z.object({
      provider: z.enum(CLIPROXY_PROVIDERS, { message: 'Provider is required' }),
      model: z.string().trim().min(1, 'Model is required'),
      account: z.string().optional(),
    }),
  }),
});

type SingleProviderFormData = z.infer<typeof singleProviderSchema>;
type CompositeFormData = z.infer<typeof compositeSchema>;

interface CliproxyEditDialogProps {
  variant: Variant | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const providerOptions = CLIPROXY_PROVIDERS.map((id) => ({
  value: id,
  label: getProviderDisplayName(id),
}));

const COMPOSITE_TIERS = ['opus', 'sonnet', 'haiku'] as const;
const AGY_DENYLIST_MESSAGE =
  'Antigravity denylist: Claude Opus 4.5 and Claude Sonnet 4.5 are deprecated.'; // TODO i18n: use t('providerEditor.agyDenylist')

function normalizeOptionalValue(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isDeniedAgyModelForProvider(provider: string, modelId: string | undefined): boolean {
  return provider === 'agy' && typeof modelId === 'string' && isDeniedAgyModelId(modelId);
}

function isSingleVariantOnlyTargetChange(variant: Variant, data: SingleProviderFormData): boolean {
  const currentTarget = variant.target || 'claude';
  const currentModel = normalizeOptionalValue(variant.model);
  const currentAccount = normalizeOptionalValue(variant.account);
  const nextModel = normalizeOptionalValue(data.model);
  const nextAccount = normalizeOptionalValue(data.account);

  return (
    data.target !== currentTarget &&
    data.provider === variant.provider &&
    nextModel === currentModel &&
    nextAccount === currentAccount
  );
}

function normalizeCompositeTier(tier: { provider: string; model: string; account?: string }) {
  return {
    provider: tier.provider,
    model: tier.model.trim(),
    account: normalizeOptionalValue(tier.account),
  };
}

function isCompositeVariantOnlyTargetChange(variant: Variant, data: CompositeFormData): boolean {
  const currentTarget = variant.target || 'claude';
  const existingTiers = variant.tiers;

  if (!existingTiers || !variant.default_tier) {
    return false;
  }

  if (data.target === currentTarget) {
    return false;
  }

  if (data.default_tier !== variant.default_tier) {
    return false;
  }

  return COMPOSITE_TIERS.every((tier) => {
    const current = normalizeCompositeTier(existingTiers[tier]);
    const next = normalizeCompositeTier(data.tiers[tier]);
    return (
      next.provider === current.provider &&
      next.model === current.model &&
      next.account === current.account
    );
  });
}

export function CliproxyEditDialog({ variant, open, onOpenChange }: CliproxyEditDialogProps) {
  const { t } = useTranslation();
  const updateMutation = useUpdateVariant();
  const isComposite = variant?.type === 'composite';

  const singleForm = useForm<SingleProviderFormData>({
    resolver: zodResolver(singleProviderSchema),
  });

  const compositeForm = useForm<CompositeFormData>({
    resolver: zodResolver(compositeSchema),
  });
  const selectedProvider = useWatch({ control: singleForm.control, name: 'provider' });
  const compositeTiers = useWatch({ control: compositeForm.control, name: 'tiers' });

  // Pre-populate form when variant changes
  useEffect(() => {
    if (!variant) return;

    if (isComposite && variant.tiers && variant.default_tier) {
      const mapTier = (t: { provider: string; model: string; account?: string }) => ({
        provider: t.provider as (typeof CLIPROXY_PROVIDERS)[number],
        model: t.model,
        account: t.account || '',
      });
      compositeForm.reset({
        default_tier: variant.default_tier,
        target: variant.target || 'claude',
        tiers: {
          opus: mapTier(variant.tiers.opus),
          sonnet: mapTier(variant.tiers.sonnet),
          haiku: mapTier(variant.tiers.haiku),
        },
      });
    } else {
      singleForm.reset({
        provider: variant.provider,
        model: variant.model ?? undefined,
        account: variant.account ?? undefined,
        target: variant.target || 'claude',
      });
    }
  }, [variant, isComposite, singleForm, compositeForm]);

  const onSubmitSingle = async (data: SingleProviderFormData) => {
    if (!variant) return;

    let payload: UpdateVariant = {};

    if (isSingleVariantOnlyTargetChange(variant, data)) {
      payload = { target: data.target };
    } else {
      const currentTarget = variant.target || 'claude';
      const currentModel = normalizeOptionalValue(variant.model);
      const currentAccount = normalizeOptionalValue(variant.account);
      const nextModel = normalizeOptionalValue(data.model);
      const nextAccount = normalizeOptionalValue(data.account);

      if (data.provider !== variant.provider) {
        payload.provider = data.provider;
      }

      if (nextModel !== currentModel) {
        payload.model = nextModel;
      }

      if (nextAccount !== currentAccount) {
        payload.account = nextAccount;
      }

      if (data.target !== currentTarget) {
        payload.target = data.target;
      }
    }

    const nextProvider = payload.provider || data.provider || variant.provider;
    const nextModelForValidation = payload.model ?? normalizeOptionalValue(data.model);
    if (isDeniedAgyModelForProvider(nextProvider, nextModelForValidation)) {
      singleForm.setError('model', { message: AGY_DENYLIST_MESSAGE });
      toast.error(AGY_DENYLIST_MESSAGE);
      return;
    }

    if (Object.keys(payload).length === 0) {
      onOpenChange(false);
      return;
    }

    try {
      await updateMutation.mutateAsync({ name: variant.name, data: payload });
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to update variant:', error);
    }
  };

  const onSubmitComposite = async (data: CompositeFormData) => {
    if (!variant) return;

    let payload: UpdateVariant = {};

    if (isCompositeVariantOnlyTargetChange(variant, data)) {
      payload = { target: data.target };
    } else {
      const existingTiers = variant.tiers;
      const normalizedTiers: NonNullable<UpdateVariant['tiers']> = {
        opus: normalizeCompositeTier(data.tiers.opus),
        sonnet: normalizeCompositeTier(data.tiers.sonnet),
        haiku: normalizeCompositeTier(data.tiers.haiku),
      };

      const tiersChanged = !existingTiers
        ? true
        : COMPOSITE_TIERS.some((tier) => {
            const current = normalizeCompositeTier(existingTiers[tier]);
            const next = normalizedTiers[tier];
            return (
              next.provider !== current.provider ||
              next.model !== current.model ||
              next.account !== current.account
            );
          });

      if (variant.default_tier !== data.default_tier) {
        payload.default_tier = data.default_tier;
      }

      if ((variant.target || 'claude') !== data.target) {
        payload.target = data.target;
      }

      if (tiersChanged) {
        payload.tiers = normalizedTiers;
      }
    }

    const tiersToValidate = payload.tiers ?? data.tiers;
    for (const tier of COMPOSITE_TIERS) {
      const tierConfig = tiersToValidate[tier];
      if (!isDeniedAgyModelForProvider(tierConfig.provider, tierConfig.model)) continue;
      compositeForm.setError(`tiers.${tier}.model`, { message: AGY_DENYLIST_MESSAGE });
      toast.error(AGY_DENYLIST_MESSAGE);
      return;
    }

    if (Object.keys(payload).length === 0) {
      onOpenChange(false);
      return;
    }

    try {
      await updateMutation.mutateAsync({
        name: variant.name,
        data: payload,
      });
      onOpenChange(false);
    } catch (error) {
      console.error('Failed to update composite variant:', error);
    }
  };

  if (!variant) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isComposite
              ? t('cliproxyDialog.editCompositeTitle', { name: variant.name })
              : t('cliproxyDialog.editSingleTitle', { name: variant.name })}
          </DialogTitle>
        </DialogHeader>

        {isComposite ? (
          <form onSubmit={compositeForm.handleSubmit(onSubmitComposite)} className="space-y-4">
            <div>
              <Label>{t('cliproxyDialog.tierConfig')}</Label>
              <Tabs defaultValue="opus" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="opus">{t('cliproxyDialog.opus')}</TabsTrigger>
                  <TabsTrigger value="sonnet">{t('cliproxyDialog.sonnet')}</TabsTrigger>
                  <TabsTrigger value="haiku">{t('cliproxyDialog.haiku')}</TabsTrigger>
                </TabsList>
                {(['opus', 'sonnet', 'haiku'] as const).map((tier) => (
                  <TabsContent key={tier} value={tier} className="space-y-3">
                    <div>
                      <Label htmlFor={`edit-${tier}-provider`}>
                        {t('cliproxyDialog.provider')}
                      </Label>
                      <select
                        id={`edit-${tier}-provider`}
                        {...compositeForm.register(`tiers.${tier}.provider`)}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        {CLIPROXY_PROVIDER_SECTIONS.map((section) => (
                          <optgroup key={section.id} label={t(section.labelKey)}>
                            {providerOptions
                              .filter((opt) => section.providers.includes(opt.value))
                              .map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                      </select>
                      {compositeTiers?.[tier]?.provider && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {t(getProviderSection(compositeTiers[tier].provider)?.hintKey || '')}
                          {isPlusExtraProvider(compositeTiers[tier].provider)
                            ? ` ${t('providerConfig.plusTrackNote')}`
                            : ''}
                        </p>
                      )}
                    </div>
                    <div>
                      <Label htmlFor={`edit-${tier}-model`}>{t('cliproxyDialog.model')}</Label>
                      <Input
                        id={`edit-${tier}-model`}
                        {...compositeForm.register(`tiers.${tier}.model`)}
                        placeholder={t('cliproxyDialog.placeholderModelId')}
                      />
                      {compositeForm.formState.errors.tiers?.[tier]?.model && (
                        <span className="text-xs text-red-500">
                          {compositeForm.formState.errors.tiers[tier]?.model?.message}
                        </span>
                      )}
                    </div>
                    <div>
                      <Label htmlFor={`edit-${tier}-account`}>
                        {t('cliproxyDialog.accountOptional')}
                      </Label>
                      <Input
                        id={`edit-${tier}-account`}
                        {...compositeForm.register(`tiers.${tier}.account`)}
                        placeholder={t('cliproxyDialog.placeholderAccountId')}
                      />
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            </div>

            <div>
              <Label htmlFor="edit-default-tier">{t('cliproxyDialog.defaultTier')}</Label>
              <select
                id="edit-default-tier"
                {...compositeForm.register('default_tier')}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="opus">{t('cliproxyDialog.opus')}</option>
                <option value="sonnet">{t('cliproxyDialog.sonnet')}</option>
                <option value="haiku">{t('cliproxyDialog.haiku')}</option>
              </select>
            </div>

            <div>
              <Label htmlFor="edit-composite-target">{t('cliproxyDialog.defaultTarget')}</Label>
              <select
                id="edit-composite-target"
                {...compositeForm.register('target')}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="claude">{t('cliproxyDialog.claudeCode')}</option>
                <option value="droid">{t('cliproxyDialog.factoryDroid')}</option>
                <option value="codex">Codex CLI</option>
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('cliproxyDialog.cancel')}
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending
                  ? t('cliproxyDialog.saving')
                  : t('cliproxyDialog.saveChanges')}
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={singleForm.handleSubmit(onSubmitSingle)} className="space-y-4">
            <div>
              <Label htmlFor="edit-provider">{t('cliproxyDialog.provider')}</Label>
              <select
                id="edit-provider"
                {...singleForm.register('provider')}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {CLIPROXY_PROVIDER_SECTIONS.map((section) => (
                  <optgroup key={section.id} label={t(section.labelKey)}>
                    {providerOptions
                      .filter((opt) => section.providers.includes(opt.value))
                      .map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
              {selectedProvider && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t(getProviderSection(selectedProvider)?.hintKey || '')}
                  {isPlusExtraProvider(selectedProvider)
                    ? ` ${t('providerConfig.plusTrackNote')}`
                    : ''}
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="edit-model">{t('cliproxyDialog.model')}</Label>
              <Input
                id="edit-model"
                {...singleForm.register('model')}
                placeholder={t('cliproxyDialog.placeholderModelId')}
              />
            </div>

            <div>
              <Label htmlFor="edit-account">{t('cliproxyDialog.accountOptional')}</Label>
              <Input
                id="edit-account"
                {...singleForm.register('account')}
                placeholder={t('cliproxyDialog.placeholderAccountId')}
              />
            </div>

            <div>
              <Label htmlFor="edit-target">{t('cliproxyDialog.defaultTarget')}</Label>
              <select
                id="edit-target"
                {...singleForm.register('target')}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="claude">{t('cliproxyDialog.claudeCode')}</option>
                <option value="droid">{t('cliproxyDialog.factoryDroid')}</option>
                <option value="codex">Codex CLI</option>
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('cliproxyDialog.cancel')}
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending
                  ? t('cliproxyDialog.saving')
                  : t('cliproxyDialog.saveChanges')}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
