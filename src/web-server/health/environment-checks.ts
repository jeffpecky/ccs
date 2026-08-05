/**
 * Environment Health Checks
 *
 * Check platform and SSH status.
 */

import { getEnvironmentDiagnostics } from '../../management/environment-diagnostics';
import type { HealthCheck } from './types';

/**
 * Check environment (platform, SSH, TTY)
 */
export function checkEnvironment(): HealthCheck {
  const diag = getEnvironmentDiagnostics();

  let status: 'ok' | 'warning' | 'info' = 'ok';
  let message = `${diag.platformName}`;

  if (diag.sshSession) {
    status = 'info';
    message += ' (SSH session)';
  }

  return {
    id: 'environment',
    name: 'Environment',
    status,
    message,
    details: `${diag.platformName} | SSH: ${diag.sshSession ? 'Yes' : 'No'}`,
  };
}
