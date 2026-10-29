/** Login mail. Production wiring is undecided; tests use the fake. */
export interface AuthEmailSender {
  sendLoginCode(input: { to: string; code: string }): Promise<void>;
}

export class FakeAuthEmailSender implements AuthEmailSender {
  readonly sent: Array<{ to: string; code: string }> = [];

  sendLoginCode(input: { to: string; code: string }): Promise<void> {
    this.sent.push({ to: input.to, code: input.code });
    return Promise.resolve();
  }
}

export const AUTH_EMAIL = Symbol('AUTH_EMAIL');
