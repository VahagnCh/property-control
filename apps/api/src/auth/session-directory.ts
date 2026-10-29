/** Session revocation checked on every access token. */
export interface SessionDirectory {
  open(sid: string, userId: string): Promise<void>;
  revoke(sid: string, now?: Date): Promise<void>;
  isRevoked(sid: string): Promise<boolean>;
}

export class MemorySessionDirectory implements SessionDirectory {
  private readonly revoked = new Set<string>();

  open(): Promise<void> {
    return Promise.resolve();
  }

  revoke(sid: string): Promise<void> {
    this.revoked.add(sid);
    return Promise.resolve();
  }

  isRevoked(sid: string): Promise<boolean> {
    return Promise.resolve(this.revoked.has(sid));
  }
}

export const SESSION_DIRECTORY = Symbol('SESSION_DIRECTORY');
export const AUTH_CLOCK = Symbol('AUTH_CLOCK');
export const AUTH_JWT = Symbol('AUTH_JWT');
export const AUTH_LIMITS = Symbol('AUTH_LIMITS');
export const AUTH_USERS = Symbol('AUTH_USERS');
export const AUTH_REFRESH = Symbol('AUTH_REFRESH');

export interface AuthLimits {
  emailSendLimit: number;
  ipSendLimit: number;
  verifyIpLimit: number;
  windowMs: number;
}

export function authLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): AuthLimits {
  return {
    emailSendLimit: positive(env.AUTH_CODE_EMAIL_LIMIT, 5),
    ipSendLimit: positive(env.AUTH_CODE_IP_LIMIT, 20),
    verifyIpLimit: positive(env.AUTH_VERIFY_IP_LIMIT, 20),
    windowMs: 60 * 60 * 1000,
  };
}

function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}
