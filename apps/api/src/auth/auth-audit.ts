export type AuthAuditAction =
  | 'auth.login.succeeded'
  | 'auth.login.failed'
  | 'auth.refresh.reuse_detected'
  | 'auth.logout';

export interface AuthAuditEvent {
  action: AuthAuditAction;
  userId: string | null;
  sessionId: string | null;
  emailHmac: string | null;
  now: Date;
}

export interface AuthAuditLog {
  append(event: AuthAuditEvent): Promise<void>;
  /** Tests use this to prove the cleartext code, token, and email were not stored. */
  storedText(): string;
}

export class MemoryAuthAudit implements AuthAuditLog {
  readonly events: AuthAuditEvent[] = [];

  append(event: AuthAuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  storedText(): string {
    return JSON.stringify(this.events);
  }
}

export const AUTH_AUDIT = Symbol('AUTH_AUDIT');
