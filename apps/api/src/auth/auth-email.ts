import { UnconfiguredAuthEmailSender, ResendAuthEmailSender } from './resend-auth-email.js';

/** Login mail. Production uses Resend. Tests and local dev use the fake when no key is set. */
export interface AuthEmailSender {
  readonly configured: boolean;
  sendLoginCode(input: { to: string; code: string }): Promise<void>;
}

export class FakeAuthEmailSender implements AuthEmailSender {
  readonly configured = true;
  readonly sent: Array<{ to: string; code: string }> = [];

  sendLoginCode(input: { to: string; code: string }): Promise<void> {
    this.sent.push({ to: input.to, code: input.code });
    return Promise.resolve();
  }
}

export function authEmailFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.AUTH_EMAIL_FROM?.trim() || 'DueRecord <onboarding@resend.dev>';
}

/** True when From is unset or still the Resend onboarding sandbox sender. */
export function isDefaultAuthEmailFrom(env: NodeJS.ProcessEnv = process.env): boolean {
  const from = env.AUTH_EMAIL_FROM?.trim().toLowerCase() ?? '';
  return from.length === 0 || from.includes('onboarding@resend.dev');
}

const NON_PRODUCTION_APP_ENVS = new Set(['staging', 'development', 'test']);

/** Trim, then lower-case. Allow-list checks use this exact form on both sides. */
export function normalizeAllowListEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Addresses that may receive a code while the sandbox sender is in use.
 * Null means the variable is unset, so every valid address may be sent.
 * Entries are trim + lower-case, and comparison is exact.
 */
export function authEmailAllowList(env: NodeJS.ProcessEnv = process.env): Set<string> | null {
  const raw = env.AUTH_EMAIL_ALLOWED_RECIPIENTS?.trim() ?? '';
  if (raw.length === 0) {
    return null;
  }
  return new Set(
    raw
      .split(',')
      .map((item) => normalizeAllowListEmail(item))
      .filter((item) => item.length > 0),
  );
}

/** Missing or unknown APP_ENV is production, so the sandbox sender cannot slip through. */
export function appEnvIsProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.APP_ENV?.trim() ?? '';
  return !NON_PRODUCTION_APP_ENVS.has(value);
}

/** Production, including a missing or unknown APP_ENV, cannot boot on memory stores. */
export function assertAuthDatabaseConfigured(env: NodeJS.ProcessEnv): void {
  if (appEnvIsProduction(env) && !(env.DATABASE_URL?.trim())) {
    throw new Error('DATABASE_URL is required in production.');
  }
}

export function assertAuthEmailFrom(env: NodeJS.ProcessEnv): void {
  if (!isDefaultAuthEmailFrom(env)) {
    return;
  }
  if (appEnvIsProduction(env)) {
    throw new Error('AUTH_EMAIL_FROM must be a verified sender when APP_ENV is production.');
  }
  const allowList = authEmailAllowList(env);
  if (!allowList || allowList.size === 0) {
    throw new Error(
      'AUTH_EMAIL_ALLOWED_RECIPIENTS is required when AUTH_EMAIL_FROM is the Resend onboarding sender.',
    );
  }
}

/** Production never falls back to the fake. No key means auth/code fails closed. */
export function authEmailSenderFromEnv(env: NodeJS.ProcessEnv = process.env): AuthEmailSender {
  const apiKey = env.RESEND_API_KEY?.trim() ?? '';
  if (apiKey) {
    return new ResendAuthEmailSender({ apiKey, from: authEmailFromEnv(env) });
  }
  if (env.NODE_ENV === 'production') {
    return new UnconfiguredAuthEmailSender();
  }
  return new FakeAuthEmailSender();
}

export const AUTH_EMAIL = Symbol('AUTH_EMAIL');
