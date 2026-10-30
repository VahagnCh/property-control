import { AUTH_CODE_EMAIL_SUBJECT, authCodeEmailBody } from './login-email.js';
import type { AuthEmailSender } from './auth-email.js';

export interface ResendEmailConfig {
  apiKey: string;
  from: string;
  fetchImpl?: typeof fetch;
}

/** Plain text only, so there is no open-tracking pixel and no click-tracked link. */
export class ResendAuthEmailSender implements AuthEmailSender {
  readonly configured = true;

  constructor(private readonly config: ResendEmailConfig) {}

  async sendLoginCode(input: { to: string; code: string }): Promise<void> {
    const send = this.config.fetchImpl ?? fetch;
    const response = await send('https://api.resend.com/emails', {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.config.from,
        to: [input.to],
        subject: AUTH_CODE_EMAIL_SUBJECT,
        text: authCodeEmailBody(input.code),
      }),
    });
    if (!response.ok) {
      throw new Error('Resend rejected the login email.');
    }
  }
}

export class UnconfiguredAuthEmailSender implements AuthEmailSender {
  readonly configured = false;

  sendLoginCode(): Promise<void> {
    return Promise.reject(new Error('Login email is not configured.'));
  }
}
