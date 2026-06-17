/**
 * Antigravity OAuth Responsibility Gate
 *
 * Enforces explicit user acknowledgement for Antigravity OAuth usage.
 * This is used by:
 * - Dashboard auth endpoints (server-side payload validation)
 */

import { createInterface, Interface } from 'readline';
import { fail, info, ok, warn } from '../../utils/ui';
import { getCliproxySafetyConfig } from '../../config/config-loader-facade';

export const ANTIGRAVITY_RISK_ISSUE_URL = 'https://github.com/jeffpecky/ccs/issues/509';
export const ANTIGRAVITY_ACK_VERSION = '2026-02-24-antigravity-oauth-v2';
export const RISK_ACK_PHRASE = 'I ACCEPT RISK';
export const ANTIGRAVITY_ACK_PHRASE = RISK_ACK_PHRASE;
export const ANTIGRAVITY_ACCEPT_RISK_FLAGS = ['--accept-agr-risk', '--accept-antigravity-risk'];

type AgyRiskContext = 'oauth' | 'run';

export interface AntigravityRiskAcknowledgement {
  version: string;
  reviewedIssue509: boolean;
  understandsBanRisk: boolean;
  acceptsFullResponsibility: boolean;
  typedPhrase: string;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

interface EnsureCliRiskOptions {
  context: AgyRiskContext;
  acceptedByFlag?: boolean;
}

function normalizePhrase(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

export function isAntigravityResponsibilityBypassEnabled(): boolean {
  if (isTruthyEnv(process.env.CCS_ACCEPT_AGY_RISK)) {
    return true;
  }

  try {
    const safety = getCliproxySafetyConfig();
    return safety.antigravity_ack_bypass === true;
  } catch {
    return false;
  }
}

function askQuestion(rl: Interface, prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;

    const onClose = () => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    };

    rl.once('close', onClose);
    rl.question(prompt, (answer) => {
      if (settled) return;
      settled = true;
      rl.removeListener('close', onClose);
      resolve(answer.trim());
    });
  });
}

async function askYesNoStep(rl: Interface, step: string, message: string): Promise<boolean> {
  while (true) {
    const answer = await askQuestion(
      rl,
      `[?] ${step}\n    ${message}\n    Type YES to continue (NO to cancel): `
    );

    if (answer === null) return false;
    const normalized = answer.toUpperCase();
    if (normalized === 'YES') return true;
    if (normalized === 'NO' || normalized === 'N' || normalized === '') return false;
    console.error(warn('Please type YES or NO.'));
  }
}

async function askResponsibilityPhrase(rl: Interface): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const answer = await askQuestion(
      rl,
      `[?] Step 4/4\n    Type exactly "${ANTIGRAVITY_ACK_PHRASE}": `
    );
    if (answer === null || answer === '') return false;

    if (normalizePhrase(answer) === ANTIGRAVITY_ACK_PHRASE) {
      return true;
    }
    console.error(warn('Phrase mismatch. Try again.'));
  }
  return false;
}

function printResponsibilityHeader(context: AgyRiskContext): void {
  const contextLine =
    context === 'oauth'
      ? 'You are starting Antigravity OAuth account authorization.'
      : 'You are starting a live Antigravity session from the dashboard.';

  console.error('');
  console.error('╔══════════════════════════════════════════════════════════════════════╗');
  console.error('║ Antigravity Responsibility Confirmation (Mandatory)                  ║');
  console.error('╚══════════════════════════════════════════════════════════════════════╝');
  console.error(`    ${contextLine}`);
  console.error('    Antigravity has active ban/suspension patterns for risky OAuth usage.');
  console.error(`    Policy issue: ${ANTIGRAVITY_RISK_ISSUE_URL}`);
  console.error('');
}

export function hasAntigravityRiskAcceptanceFlag(args: string[]): boolean {
  return args.some((arg) => ANTIGRAVITY_ACCEPT_RISK_FLAGS.includes(arg));
}

export function validateAntigravityRiskAcknowledgement(payload: unknown): ValidationResult {
  if (!payload || typeof payload !== 'object') {
    return {
      valid: false,
      error: 'Antigravity OAuth requires a full responsibility acknowledgement payload.',
    };
  }

  const data = payload as Partial<AntigravityRiskAcknowledgement>;

  if (data.version !== ANTIGRAVITY_ACK_VERSION) {
    return {
      valid: false,
      error: 'Antigravity acknowledgement version mismatch. Re-open add account and try again.',
    };
  }

  if (!data.reviewedIssue509 || !data.understandsBanRisk || !data.acceptsFullResponsibility) {
    return {
      valid: false,
      error: 'Complete all Antigravity responsibility checklist steps before authenticating.',
    };
  }

  if (
    typeof data.typedPhrase !== 'string' ||
    normalizePhrase(data.typedPhrase) !== ANTIGRAVITY_ACK_PHRASE
  ) {
    return {
      valid: false,
      error: `Type exact acknowledgement phrase: "${ANTIGRAVITY_ACK_PHRASE}".`,
    };
  }

  return { valid: true };
}

export async function ensureCliAntigravityResponsibility(
  options: EnsureCliRiskOptions
): Promise<boolean> {
  if (options.acceptedByFlag || isAntigravityResponsibilityBypassEnabled()) {
    return true;
  }

  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    console.error(fail('Antigravity responsibility acknowledgement required.'));
    console.error('    Re-run interactively and complete the 4-step confirmation.');
    console.error('    Non-interactive override: --accept-agr-risk');
    return false;
  }

  printResponsibilityHeader(options.context);

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    const step1 = await askYesNoStep(
      rl,
      'Step 1/4',
      'I reviewed issue #509 and understand AGY OAuth can trigger bans/suspensions.'
    );
    if (!step1) return false;

    const step2 = await askYesNoStep(
      rl,
      'Step 2/4',
      'I understand this OAuth operation is my own decision and I choose to continue.'
    );
    if (!step2) return false;

    const step3 = await askYesNoStep(
      rl,
      'Step 3/4',
      'I accept that CCS provides no responsibility coverage for account loss, bans, or suspension.'
    );
    if (!step3) return false;

    const step4 = await askResponsibilityPhrase(rl);
    if (!step4) return false;

    console.error(ok('Antigravity responsibility acknowledgement accepted for this command.'));
    console.error(info('Proceeding with Antigravity flow...'));
    return true;
  } finally {
    rl.close();
  }
}
