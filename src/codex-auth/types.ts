export interface CodexProfileMetadata {
  type: 'codex';
  created: string;
  last_used: string | null;
  email?: string;
  plan_type?: string | null;
  account_id?: string;
}

export interface CodexProfileData {
  version: string;
  default: string | null;
  profiles: Record<string, CodexProfileMetadata>;
}

export interface CodexAccountIdentity {
  email?: string;
  plan_type?: string;
  account_id?: string;
}

export const CODEX_PROFILE_SCHEMA_VERSION = '1.0';
