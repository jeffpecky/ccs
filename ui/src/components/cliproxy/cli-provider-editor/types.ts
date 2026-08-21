/**
 * Type definitions for CLIProviderEditor components
 */

import type { ReactNode } from 'react';
import type {
  AuthStatus,
  CliTarget,
  CliproxyProviderRoutingHints,
} from '@/lib/api-client';
import type { ProviderCatalog } from '../provider-model-selector';

export interface SettingsResponse {
  profile: string;
  settings: {
    env?: Record<string, string>;
  };
  mtime: number;
  path: string;
}

export interface CLIProviderEditorProps {
  provider: string;
  toolId?: string;
  displayName: string;
  authStatus: AuthStatus;
  catalog?: ProviderCatalog;
  routing?: CliproxyProviderRoutingHints;
  logoProvider?: string;
  baseProvider?: string;
  isRemoteMode?: boolean;
  port?: number;
  defaultTarget?: CliTarget;
  topNotice?: ReactNode;
}

export interface ModelMappingValues {
  default: string;
  opus: string;
  sonnet: string;
  haiku: string;
}

export interface CustomPresetDialogProps {
  open: boolean;
  onClose: () => void;
  currentValues: ModelMappingValues;
  onApply: (values: ModelMappingValues, presetName?: string) => void;
  onSave?: (values: ModelMappingValues, presetName?: string) => void;
  isSaving?: boolean;
  catalog?: ProviderCatalog;
  allModels: { id: string; owned_by: string }[];
  routing?: CliproxyProviderRoutingHints;
}

export interface RawEditorSectionProps {
  rawJsonContent: string;
  isRawJsonValid: boolean;
  rawJsonEdits: string | null;
  onRawJsonChange: (value: string) => void;
  profileEnv?: Record<string, string>;
  missingRequiredFields?: string[];
}

export interface ModelConfigSectionProps {
  catalog?: ProviderCatalog;
  savedPresets: Array<{
    name: string;
    default: string;
    opus: string;
    sonnet: string;
    haiku: string;
  }>;
  currentModel?: string;
  opusModel?: string;
  sonnetModel?: string;
  haikuModel?: string;
  providerModels: Array<{ id: string; owned_by: string }>;
  routing?: CliproxyProviderRoutingHints;
  provider: string;
  toolId?: string;
  extendedContextEnabled?: boolean;
  onExtendedContextToggle?: (enabled: boolean) => void;
  onApplyPreset: (updates: Record<string, string>) => void;
  onUpdateEnvValue: (key: string, value: string) => void;
  onOpenCustomPreset: () => void;
  onDeletePreset: (name: string) => void;
  isDeletePending?: boolean;
}

export interface UseCLIProviderEditorReturn {
  data: SettingsResponse | undefined;
  isLoading: boolean;
  refetch: () => void;
  rawJsonContent: string;
  rawJsonEdits: string | null;
  isRawJsonValid: boolean;
  hasChanges: boolean;
  currentSettings: { env?: Record<string, string> };
  currentModel?: string;
  opusModel?: string;
  sonnetModel?: string;
  haikuModel?: string;
  extendedContextEnabled: boolean;
  toggleExtendedContext: (enabled: boolean) => void;
  handleRawJsonChange: (value: string) => void;
  updateEnvValue: (key: string, value: string) => void;
  updateEnvValues: (updates: Record<string, string>) => void;
  saveMutation: {
    mutate: () => void;
    isPending: boolean;
  };
  conflictDialog: boolean;
  setConflictDialog: (open: boolean) => void;
  handleConflictResolve: (overwrite: boolean) => Promise<void>;
  missingRequiredFields: string[];
}
