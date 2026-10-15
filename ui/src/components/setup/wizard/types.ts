/**
 * Types for Quick Setup Wizard
 */

import type { CliproxyProviderCatalog, OAuthAccount } from '@/lib/api-client';

export type WizardStep = 'provider' | 'auth' | 'account' | 'variant' | 'success';

export interface QuickSetupWizardProps {
  open: boolean;
  onClose: () => void;
}

export interface ProviderOption {
  id: string;
  name: string;
  description: string;
}

export interface ProviderStepProps {
  providers: ProviderOption[];
  onSelect: (providerId: string) => void;
}

export interface AuthStepProps {
  selectedProvider: string;
  providers: ProviderOption[];
  authCommand: string;
  isRefreshing: boolean;
  isPending: boolean;
  onBack: () => void;
  onStartAuth: () => void;
  onRefresh: () => void;
}

export interface AccountStepProps {
  accounts: OAuthAccount[];
  privacyMode: boolean;
  onSelect: (account: OAuthAccount) => void;
  onAddNew: () => void;
  onBack: () => void;
}

export interface VariantStepProps {
  selectedProvider: string;
  catalog?: CliproxyProviderCatalog;
  selectedAccount: OAuthAccount | null;
  variantName: string;
  modelName: string;
  isPending: boolean;
  privacyMode: boolean;
  onVariantNameChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onBack: () => void;
  onSkip: () => void;
  onCreate: () => void;
}

export interface SuccessStepProps {
  variantName: string;
  onClose: () => void;
}

export interface ProgressIndicatorProps {
  currentProgress: number;
  allSteps: string[];
}
