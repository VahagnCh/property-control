import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { openSealed, sealString } from './server-secret.js';
import {
  REFRESH_ABSOLUTE_MS,
  hashToken,
  refreshExpiry,
  rotateInStore,
  type RefreshTokenRow,
  type RotateResult,
} from './refresh-tokens.js';

type Tx = Prisma.TransactionClient;

export class PrismaRefreshTokens {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly secret: string,
  ) {}

  async issue(input: { userId: string; rawToken: string; now: Date }): Promise<RefreshTokenRow> {
    const issuedAt = input.now;
    const absoluteExpiresAt = new Date(issuedAt.getTime() + REFRESH_ABSOLUTE_MS);
    const created = await this.prisma.refreshToken.create({
      data: {
        id: randomUUID(),
        userId: input.userId,
        familyId: randomUUID(),
        tokenHash: hashToken(input.rawToken),
        issuedAt,
        expiresAt: refreshExpiry(issuedAt, absoluteExpiresAt),
        absoluteExpiresAt,
      },
    });
    return toRow(created);
  }

  async rotate(input: { rawToken: string; now: Date; nextRawToken: string }): Promise<RotateResult> {
    return this.prisma.$transaction((tx) => rotateInStore(new PrismaRefreshTx(tx, this.secret), input));
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now, graceRefreshToken: null },
    });
  }

  async countByFamily(familyId: string): Promise<number> {
    return this.prisma.refreshToken.count({ where: { familyId } });
  }
}

class PrismaRefreshTx {
  constructor(
    private readonly tx: Tx,
    private readonly secret: string,
  ) {}

  async claimUnused(tokenHash: string, now: Date): Promise<RefreshTokenRow | null> {
    const rows = await this.tx.$queryRaw<RawRefresh[]>`
      UPDATE refresh_tokens
      SET used_at = ${now}
      WHERE token_hash = ${tokenHash}
        AND used_at IS NULL
        AND revoked_at IS NULL
        AND expires_at > ${now}
        AND absolute_expires_at > ${now}
      RETURNING id, user_id, family_id, token_hash, issued_at, expires_at, absolute_expires_at,
                used_at, revoked_at, replaced_by_id, grace_refresh_token
    `;
    const row = rows[0];
    return row ? fromRaw(row) : null;
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRow | null> {
    const rows = await this.tx.$queryRaw<RawRefresh[]>`
      SELECT id, user_id, family_id, token_hash, issued_at, expires_at, absolute_expires_at,
             used_at, revoked_at, replaced_by_id, grace_refresh_token
      FROM refresh_tokens
      WHERE token_hash = ${tokenHash}
      FOR UPDATE
    `;
    const row = rows[0];
    return row ? this.reveal(fromRaw(row)) : null;
  }

  async findById(id: string): Promise<RefreshTokenRow | null> {
    const rows = await this.tx.$queryRaw<RawRefresh[]>`
      SELECT id, user_id, family_id, token_hash, issued_at, expires_at, absolute_expires_at,
             used_at, revoked_at, replaced_by_id, grace_refresh_token
      FROM refresh_tokens
      WHERE id = CAST(${id} AS uuid)
    `;
    const row = rows[0];
    return row ? this.reveal(fromRaw(row)) : null;
  }

  async insert(row: RefreshTokenRow): Promise<RefreshTokenRow> {
    const created = await this.tx.refreshToken.create({
      data: {
        id: row.id,
        userId: row.userId,
        familyId: row.familyId,
        tokenHash: row.tokenHash,
        issuedAt: row.issuedAt,
        expiresAt: row.expiresAt,
        absoluteExpiresAt: row.absoluteExpiresAt,
      },
    });
    return toRow(created);
  }

  async attachSuccessor(parentId: string, successorId: string, graceToken: string): Promise<void> {
    await this.tx.refreshToken.update({
      where: { id: parentId },
      data: { replacedById: successorId, graceRefreshToken: sealString(graceToken, this.secret) },
    });
  }

  async clearGrace(parentId: string): Promise<void> {
    await this.tx.refreshToken.update({
      where: { id: parentId },
      data: { graceRefreshToken: null },
    });
  }

  private reveal(row: RefreshTokenRow): RefreshTokenRow {
    if (!row.graceRefreshToken) {
      return row;
    }
    return { ...row, graceRefreshToken: openSealed(row.graceRefreshToken, this.secret) };
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    await this.tx.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now, graceRefreshToken: null },
    });
  }
}

interface RawRefresh {
  id: string;
  user_id: string;
  family_id: string;
  token_hash: string;
  issued_at: Date;
  expires_at: Date;
  absolute_expires_at: Date;
  used_at: Date | null;
  revoked_at: Date | null;
  replaced_by_id: string | null;
  grace_refresh_token: string | null;
}

function fromRaw(row: RawRefresh): RefreshTokenRow {
  return {
    id: row.id,
    userId: row.user_id,
    familyId: row.family_id,
    tokenHash: row.token_hash,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
    usedAt: row.used_at,
    revokedAt: row.revoked_at,
    replacedById: row.replaced_by_id,
    graceRefreshToken: row.grace_refresh_token,
  };
}

function toRow(row: {
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
}): RefreshTokenRow {
  return { ...row };
}
