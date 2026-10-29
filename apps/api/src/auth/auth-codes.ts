import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 60 * 1000;
export const VERIFY_FAILURES_BEFORE_LIMIT = 5;

export const AUTH_ACCEPTED_BODY = {
  message: 'Si el correo es válido, te enviamos un código.',
} as const;

export function normalizeAuthEmail(value: string): string {
  return value.normalize('NFC').trim().toLowerCase();
}

export function randomAuthCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** HMAC-SHA256 with the server pepper. The code itself is never stored. */
export function authCodeHmac(code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(`auth-code\u001e${code}`).digest('hex');
}

export function authCodesMatch(presentedHmac: string, storedHmac: string): boolean {
  const left = Buffer.from(presentedHmac, 'hex');
  const right = Buffer.from(storedHmac, 'hex');
  if (left.length === 0 || left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export interface AuthCodeRow {
  id: string;
  emailHmac: string;
  codeHmac: string;
  expiresAt: Date;
  usedAt: Date | null;
  attempts: number;
  createdAt: Date;
}

export interface AuthCodeStore {
  invalidateActive(emailHmac: string, now: Date): Promise<void>;
  insert(row: AuthCodeRow): Promise<void>;
  findLatest(emailHmac: string): Promise<AuthCodeRow | null>;
  /**
   * One claim. Succeeds only when this hmac is still unused, under the
   * attempt cap, and unexpired.
   */
  claimMatching(emailHmac: string, codeHmac: string, now: Date): Promise<AuthCodeRow | null>;
  recordFailure(id: string): Promise<AuthCodeRow | null>;
  markUsed(id: string, now: Date): Promise<void>;
}

export class MemoryAuthCodes implements AuthCodeStore {
  private readonly rows: AuthCodeRow[] = [];

  /** Tests use this to prove the plain code and email were not stored. */
  storedText(): string {
    return JSON.stringify(this.rows);
  }

  async invalidateActive(emailHmac: string, now: Date): Promise<void> {
    for (const row of this.rows) {
      if (row.emailHmac === emailHmac && !row.usedAt && row.expiresAt > now) {
        row.usedAt = now;
      }
    }
  }

  async insert(row: AuthCodeRow): Promise<void> {
    this.rows.push({ ...row });
  }

  async claimMatching(emailHmac: string, codeHmac: string, now: Date): Promise<AuthCodeRow | null> {
    const row = this.rows.find(
      (item) =>
        item.emailHmac === emailHmac &&
        item.codeHmac === codeHmac &&
        !item.usedAt &&
        item.attempts < 5 &&
        item.expiresAt > now,
    );
    if (!row) {
      return null;
    }
    row.usedAt = now;
    return { ...row };
  }

  async findLatest(emailHmac: string): Promise<AuthCodeRow | null> {
    const matches = this.rows.filter((row) => row.emailHmac === emailHmac);
    const latest = matches.at(-1);
    return latest ? { ...latest } : null;
  }

  async recordFailure(id: string): Promise<AuthCodeRow | null> {
    const row = this.rows.find((item) => item.id === id);
    if (!row) {
      return null;
    }
    row.attempts += 1;
    return { ...row };
  }

  async markUsed(id: string, now: Date): Promise<void> {
    const row = this.rows.find((item) => item.id === id);
    if (row) {
      row.usedAt = now;
    }
  }
}

export const AUTH_CODE_STORE = Symbol('AUTH_CODE_STORE');
