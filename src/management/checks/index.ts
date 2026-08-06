/**
 * Health Check Registry - Central export for all checks
 */

// Types and utilities
export type {
  HealthCheckDetails,
  HealthCheckItem,
  HealthIssue,
  Spinner,
  IHealthChecker,
} from './types';

export { HealthCheck, createSpinner } from './types';

// System checks
export { ClaudeCliChecker, CcsDirectoryChecker, runSystemChecks } from './system-check';

// Environment checks
export { EnvironmentChecker, runEnvironmentCheck } from './env-check';

// Config checks
export { ConfigFilesChecker, ClaudeSettingsChecker, runConfigChecks } from './config-check';

// Profile checks
export {
  ProfilesChecker,
  InstancesChecker,
  DelegationChecker,
  runProfileChecks,
} from './profile-check';

// Symlink checks
export {
  PermissionsChecker,
  CcsSymlinksChecker,
  SettingsSymlinksChecker,
  runSymlinkChecks,
} from './symlink-check';

// CLIProxy checks
export {
  CLIProxyBinaryChecker,
  CLIProxyConfigChecker,
  CLIProxyAuthChecker,
  CLIProxyPortChecker,
  runCLIProxyChecks,
} from './cliproxy-check';

// OAuth checks
export { OAuthPortsChecker, runOAuthChecks } from './oauth-check';
