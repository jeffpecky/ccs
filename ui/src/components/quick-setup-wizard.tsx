/**
 * Quick Setup Wizard - Re-export from modular structure
 * @deprecated Import from '@/components/setup/wizard' directly
 */

/* eslint-disable react-refresh/only-export-components */
export {
  QuickSetupWizard,
  ProgressIndicator,
  ProviderStep,
  AuthStep,
  AccountStep,
  VariantStep,
  SuccessStep,
  PROVIDERS,
  ALL_STEPS,
  getStepProgress,
} from './setup/wizard';

export type {
  WizardStep,
  QuickSetupWizardProps,
  ProviderOption,
  ProviderStepProps,
  AuthStepProps,
  AccountStepProps,
  VariantStepProps,
  SuccessStepProps,
  ProgressIndicatorProps,
} from './setup/wizard';
