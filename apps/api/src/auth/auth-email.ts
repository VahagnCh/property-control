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

export function assertProductionEmailFrom(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }
  if (!env.RESEND_API_KEY?.trim()) {
    return;
  }
  const from = env.AUTH_EMAIL_FROM?.trim() ?? '';
  if (from.length === 0 || from.includes('onboarding@resend.dev')) {
    throw new Error('AUTH_EMAIL_FROM must be a verified sender when RESEND_API_KEY is set.');
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
