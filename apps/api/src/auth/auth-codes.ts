import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Mutex } from '../persistence/mutex.js';

export const CODE_TTL_MS = 10 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 60 * 1000;
export const VERIFY_FAILURES_BEFORE_LIMIT = 5;
/** Wrong verifies one IP may spend against a single email before that IP stops. */
export const VERIFY_EMAIL_IP_LIMIT = 3;

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

/** Verify calls this object so tests can see that `authCodesMatch` ran. */
export const authCodeCompare = {
  authCodesMatch,
};

export interface AuthCodeRow {
  id: string;
  emailHmac: string;
  codeHmac: string;
  expiresAt: Date;
  usedAt: Date | null;
  attempts: number;
  createdAt: Date;
}

export interface ReservedAttempt {
  id: string;
  codeHmac: string;
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
  /**
   * Increment attempts on the latest live code before any compare.
   * No row means the caller must not compare.
   */
  reserveAttempt(emailHmac: string, now: Date): Promise<ReservedAttempt | null>;
  /** Mark the reserved row used only when it is still unused. */
  claimUnused(id: string, now: Date): Promise<boolean>;
  recordFailure(id: string): Promise<AuthCodeRow | null>;
  markUsed(id: string, now: Date): Promise<void>;
  deleteById(id: string): Promise<void>;
}

export class MemoryAuthCodes implements AuthCodeStore {
  private readonly rows: AuthCodeRow[] = [];
  private readonly mutex = new Mutex();

  /** Tests use this to prove the plain code and email were not stored. */
  storedText(): string {
    return JSON.stringify(this.rows);
  }

  async invalidateActive(emailHmac: string, now: Date): Promise<void> {
    await this.mutex.run(async () => {
      for (const row of this.rows) {
        if (row.emailHmac === emailHmac && !row.usedAt && row.expiresAt > now) {
          row.usedAt = now;
        }
      }
    });
  }

  async insert(row: AuthCodeRow): Promise<void> {
    await this.mutex.run(async () => {
      this.rows.push({ ...row });
    });
  }

  async claimMatching(emailHmac: string, codeHmac: string, now: Date): Promise<AuthCodeRow | null> {
    return this.mutex.run(async () => {
      const row = this.rows.find(
        (item) =>
          item.emailHmac === emailHmac &&
          item.codeHmac === codeHmac &&
          !item.usedAt &&
          item.attempts < VERIFY_FAILURES_BEFORE_LIMIT &&
          item.expiresAt > now,
      );
      if (!row) {
        return null;
      }
      row.usedAt = now;
      return { ...row };
    });
  }

  async reserveAttempt(emailHmac: string, now: Date): Promise<ReservedAttempt | null> {
    return this.mutex.run(async () => {
      const row = this.latestLive(emailHmac, now);
      if (!row || row.attempts >= VERIFY_FAILURES_BEFORE_LIMIT) {
        return null;
      }
      row.attempts += 1;
      return { id: row.id, codeHmac: row.codeHmac };
    });
  }

  async claimUnused(id: string, now: Date): Promise<boolean> {
    return this.mutex.run(async () => {
      const row = this.rows.find((item) => item.id === id);
      if (!row || row.usedAt) {
        return false;
      }
      row.usedAt = now;
      return true;
    });
  }

  async findLatest(emailHmac: string): Promise<AuthCodeRow | null> {
    return this.mutex.run(async () => {
      const latest = this.rows.filter((row) => row.emailHmac === emailHmac).at(-1);
      return latest ? { ...latest } : null;
    });
  }

  async recordFailure(id: string): Promise<AuthCodeRow | null> {
    return this.mutex.run(async () => {
      const row = this.rows.find((item) => item.id === id);
      if (!row) {
        return null;
      }
      row.attempts += 1;
      return { ...row };
    });
  }

  async markUsed(id: string, now: Date): Promise<void> {
    await this.mutex.run(async () => {
      const row = this.rows.find((item) => item.id === id);
      if (row) {
        row.usedAt = now;
      }
    });
  }

  async deleteById(id: string): Promise<void> {
    await this.mutex.run(async () => {
      const index = this.rows.findIndex((item) => item.id === id);
      if (index >= 0) {
        this.rows.splice(index, 1);
      }
    });
  }

  private latestLive(emailHmac: string, now: Date): AuthCodeRow | undefined {
    return [...this.rows]
      .reverse()
      .find((row) => row.emailHmac === emailHmac && !row.usedAt && row.expiresAt > now);
  }
}

export const AUTH_CODE_STORE = Symbol('AUTH_CODE_STORE');
