/**
 * Types for Copilot Config Form
 */

import type { CopilotModel, CopilotPlanTier } from '@/hooks/use-copilot';

export interface FlexibleModelSelectorProps {
  label: string;
  description?: string;
  value: string | undefined;
  onChange: (model: string) => void;
  models: CopilotModel[];
  disabled?: boolean;
}

export interface ModelPreset {
  name: string;
  description: string;
  default: string;
  opus: string;
  sonnet: string;
  haiku: string;
}

export type { CopilotModel, CopilotPlanTier };
