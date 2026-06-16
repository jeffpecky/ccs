import * as path from 'path';
import { info, warn } from '../utils/ui';
import {
  parseResumeFlagIntent,
  resolveRuntimePlainCcsResumeLane,
  type ResumeLaneSummary,
} from './resume-lane-diagnostics';

interface ResumeLaneWarningDependencies {
  resolvePlainLane?: () => Promise<ResumeLaneSummary>;
  log?: (message: string) => void;
  debug?: boolean;
}

export async function maybeWarnAboutResumeLaneMismatch(
  profileName: string,
  accountConfigDir: string,
  args: string[],
  deps: ResumeLaneWarningDependencies = {}
): Promise<void> {
  const resumeIntent = parseResumeFlagIntent(args);
  if (!resumeIntent) {
    return;
  }

  const log = deps.log ?? console.error;

  try {
    const plainLane = await (deps.resolvePlainLane ?? resolveRuntimePlainCcsResumeLane)();
    if (path.resolve(plainLane.configDir) === path.resolve(accountConfigDir)) {
      return;
    }

    log(
      warn(
        `Resume for account "${profileName}" will search that account lane, not the current plain ccs lane.`
      )
    );
    log(info(`  Account lane: ${accountConfigDir}`));
    log(info(`  Plain ccs lane: ${plainLane.label} (${plainLane.configDir})`));
    if (resumeIntent.explicitSessionId) {
      log(
        info(
          '  This explicit session ID may have been created in a different lane, so Claude may not find it here.'
        )
      );
    }
    log(info('  Recover the original lane first: ccs -r'));
    log(info('  Back it up before changing setup: Backup from the dashboard settings'));
    log(
      info(`  For future work, align plain ccs with this account: Set default from the dashboard settings`)
    );
    log('');
  } catch (error) {
    log(
      warn(
        'Resume lane guidance skipped because diagnostics failed; continuing with the account lane.'
      )
    );
    if (deps.debug ?? Boolean(process.env.CCS_DEBUG)) {
      log(info(`  Diagnostic error: ${(error as Error).message}`));
    }
  }
}
