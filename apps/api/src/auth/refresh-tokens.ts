import { createHash, randomUUID } from 'node:crypto';
import { Mutex } from '../persistence/mutex.js';
import { openSealed, sealString } from './server-secret.js';

/** Sliding refresh lifetime. The family cannot outlive the absolute cap. */
export const REFRESH_SLIDING_MS = 30 * 24 * 60 * 60 * 1000;
/** 90-day cap copied onto every rotation and never extended. */
export const REFRESH_ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000;
/**
 * A second refresh that loses the atomic claim returns the winner's pair
 * when the winner's `usedAt` is at most this old. Later reuse revokes the family.
 */
export const REFRESH_GRACE_MS = 30_000;

export interface RefreshTokenRow {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  issuedAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  replacedById: string | null;
  graceRefreshToken: string | null;
}

export type RotateResult =
  | { outcome: 'rotated' | 'grace'; refreshToken: string; token: RefreshTokenRow }
  | { outcome: 'expired' | 'revoked' | 'not_found' }
  | { outcome: 'reused'; familyId: string };

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function refreshExpiry(now: Date, absoluteExpiresAt: Date): Date {
  const sliding = now.getTime() + REFRESH_SLIDING_MS;
  return new Date(Math.min(sliding, absoluteExpiresAt.getTime()));
}

interface RefreshTokenTx {
  claimUnused(tokenHash: string, now: Date): Promise<RefreshTokenRow | null>;
  findByHash(tokenHash: string): Promise<RefreshTokenRow | null>;
  findById(id: string): Promise<RefreshTokenRow | null>;
  insert(row: RefreshTokenRow): Promise<RefreshTokenRow>;
  attachSuccessor(parentId: string, successorId: string, graceToken: string): Promise<void>;
  clearGrace(parentId: string): Promise<void>;
  revokeFamily(familyId: string, now: Date): Promise<void>;
}

export async function rotateInStore(
  store: RefreshTokenTx,
  input: { rawToken: string; now: Date; nextRawToken: string },
): Promise<RotateResult> {
  const tokenHash = hashToken(input.rawToken);
  const claimed = await store.claimUnused(tokenHash, input.now);
  if (claimed) {
    const expiresAt = refreshExpiry(input.now, claimed.absoluteExpiresAt);
    const next: RefreshTokenRow = {
      id: randomUUID(),
      userId: claimed.userId,
      familyId: claimed.familyId,
      tokenHash: hashToken(input.nextRawToken),
      issuedAt: input.now,
      expiresAt,
      absoluteExpiresAt: claimed.absoluteExpiresAt,
      usedAt: null,
      revokedAt: null,
      replacedById: null,
      graceRefreshToken: null,
    };
    await store.insert(next);
    await store.attachSuccessor(claimed.id, next.id, input.nextRawToken);
    return { outcome: 'rotated', refreshToken: input.nextRawToken, token: next };
  }
  const row = await store.findByHash(tokenHash);
  if (!row) {
    return { outcome: 'not_found' };
  }
  if (row.revokedAt) {
    return { outcome: 'revoked' };
  }
  if (!row.usedAt && (row.expiresAt <= input.now || row.absoluteExpiresAt <= input.now)) {
    return { outcome: 'expired' };
  }
  if (row.usedAt && row.replacedById) {
    const age = input.now.getTime() - row.usedAt.getTime();
    const successor = await store.findById(row.replacedById);
    const successorLive = Boolean(successor && !successor.usedAt && !successor.revokedAt);
    if (row.graceRefreshToken && age <= REFRESH_GRACE_MS && successorLive && successor) {
      return { outcome: 'grace', refreshToken: row.graceRefreshToken, token: successor };
    }
    await store.clearGrace(row.id);
    await store.revokeFamily(row.familyId, input.now);
    return { outcome: 'reused', familyId: row.familyId };
  }
  if (row.usedAt) {
    await store.clearGrace(row.id);
    await store.revokeFamily(row.familyId, input.now);
    return { outcome: 'reused', familyId: row.familyId };
  }
  return { outcome: 'not_found' };
}

export class MemoryRefreshTokens {
  private readonly rows = new Map<string, RefreshTokenRow>();
  private readonly mutex = new Mutex();

  constructor(private readonly secret: string) {}

  list(): RefreshTokenRow[] {
    return [...this.rows.values()].map((row) => ({ ...row }));
  }

  async issue(input: { userId: string; rawToken: string; now: Date }): Promise<RefreshTokenRow> {
    return this.mutex.run(async () => {
      const issuedAt = input.now;
      const absoluteExpiresAt = new Date(issuedAt.getTime() + REFRESH_ABSOLUTE_MS);
      const row: RefreshTokenRow = {
        id: randomUUID(),
        userId: input.userId,
        familyId: randomUUID(),
        tokenHash: hashToken(input.rawToken),
        issuedAt,
        expiresAt: refreshExpiry(issuedAt, absoluteExpiresAt),
        absoluteExpiresAt,
        usedAt: null,
        revokedAt: null,
        replacedById: null,
        graceRefreshToken: null,
      };
      this.rows.set(row.id, row);
      return { ...row };
    });
  }

  async rotate(input: { rawToken: string; now: Date; nextRawToken: string }): Promise<RotateResult> {
    return this.mutex.run(() => rotateInStore(new MemoryRefreshTx(this.rows, this.secret), input));
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    await this.mutex.run(() => new MemoryRefreshTx(this.rows, this.secret).revokeFamily(familyId, now));
  }
}

class MemoryRefreshTx implements RefreshTokenTx {
  constructor(
    private readonly rows: Map<string, RefreshTokenRow>,
    private readonly secret: string,
  ) {}

  async claimUnused(tokenHash: string, now: Date): Promise<RefreshTokenRow | null> {
    const row = [...this.rows.values()].find((item) => item.tokenHash === tokenHash);
    if (!row || row.usedAt || row.revokedAt || row.expiresAt <= now || row.absoluteExpiresAt <= now) {
      return null;
    }
    row.usedAt = now;
    return { ...row };
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRow | null> {
    const row = [...this.rows.values()].find((item) => item.tokenHash === tokenHash);
    return row ? this.reveal(row) : null;
  }

  async findById(id: string): Promise<RefreshTokenRow | null> {
    const row = this.rows.get(id);
    return row ? this.reveal(row) : null;
  }

  async insert(row: RefreshTokenRow): Promise<RefreshTokenRow> {
    this.rows.set(row.id, { ...row });
    return { ...row };
  }

  async attachSuccessor(parentId: string, successorId: string, graceToken: string): Promise<void> {
    const parent = this.rows.get(parentId);
    if (!parent) {
      return;
    }
    parent.replacedById = successorId;
    parent.graceRefreshToken = sealString(graceToken, this.secret);
  }

  async clearGrace(parentId: string): Promise<void> {
    const parent = this.rows.get(parentId);
    if (parent) {
      parent.graceRefreshToken = null;
    }
  }

  private reveal(row: RefreshTokenRow): RefreshTokenRow {
    if (!row.graceRefreshToken) {
      return { ...row };
    }
    return { ...row, graceRefreshToken: openSealed(row.graceRefreshToken, this.secret) };
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    for (const row of this.rows.values()) {
      if (row.familyId === familyId && !row.revokedAt) {
        row.revokedAt = now;
      }
    }
  }
}
