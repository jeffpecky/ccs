/**
 * System Health Checks
 *
 * Checks for CCS directory and permissions.
 */

import * as fs from 'fs';
import type { HealthCheck } from './types';

/**
 * Check CCS directory existence
 */
export function checkCcsDirectory(ccsDir: string): HealthCheck {
  if (fs.existsSync(ccsDir)) {
    return {
      id: 'ccs-dir',
      name: 'CCS Directory',
      status: 'ok',
      message: 'Exists',
      details: '~/.ccs/',
    };
  }

  return {
    id: 'ccs-dir',
    name: 'CCS Directory',
    status: 'error',
    message: 'Not found',
    details: ccsDir,
    fix: 'Run: npm install -g @jeffpecky/ccs --force',
    fixable: true,
  };
}

/**
 * Check permissions on CCS directory
 */
export function checkPermissions(ccsDir: string): HealthCheck {
  const testFile = `${ccsDir}/.permission-test`;

  try {
    fs.writeFileSync(testFile, 'test', 'utf8');
    fs.unlinkSync(testFile);
    return {
      id: 'permissions',
      name: 'Permissions',
      status: 'ok',
      message: 'Write access verified',
    };
  } catch {
    return {
      id: 'permissions',
      name: 'Permissions',
      status: 'error',
      message: 'Cannot write to ~/.ccs/',
      fix: 'sudo chown -R $USER ~/.ccs ~/.claude && chmod 755 ~/.ccs ~/.claude',
    };
  }
}
