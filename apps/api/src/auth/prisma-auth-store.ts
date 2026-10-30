import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import type { AuthAuditEvent, AuthAuditLog } from './auth-audit.js';
import type { AuthCodeRow, AuthCodeStore, ReservedAttempt } from './auth-codes.js';
import type { AuthUsers } from './auth.service.js';
import type { SessionDirectory } from './session-directory.js';

interface RawCode {
  id: string;
  email_hmac: string;
  code_hmac: string;
  expires_at: Date;
  used_at: Date | null;
  attempts: number;
  created_at: Date;
}

export class PrismaAuthUsers implements AuthUsers {
  constructor(private readonly prisma: PrismaClient) {}

  async findOrCreate(emailHmac: string): Promise<{ id: string }> {
    const existing = await this.prisma.user.findUnique({ where: { emailHmac }, select: { id: true } });
    if (existing) {
      return existing;
    }
    const id = randomUUID();
    try {
      await this.prisma.user.create({ data: { id, trustSub: id, emailHmac } });
      return { id };
    } catch {
      const again = await this.prisma.user.findUnique({ where: { emailHmac }, select: { id: true } });
      if (!again) {
        throw new Error('Auth user was not created.');
      }
      return again;
    }
  }
}

export class PrismaAuthCodes implements AuthCodeStore {
  constructor(private readonly prisma: PrismaClient) {}

  async invalidateActive(emailHmac: string, now: Date): Promise<void> {
    await this.prisma.authCode.updateMany({
      where: { emailHmac, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
  }

  async insert(row: AuthCodeRow): Promise<void> {
    await this.prisma.authCode.create({
      data: {
        id: row.id,
        emailHmac: row.emailHmac,
        codeHmac: row.codeHmac,
        expiresAt: row.expiresAt,
        usedAt: row.usedAt,
        attempts: row.attempts,
        createdAt: row.createdAt,
      },
    });
  }

  async findLatest(emailHmac: string): Promise<AuthCodeRow | null> {
    const row = await this.prisma.authCode.findFirst({
      where: { emailHmac },
      orderBy: { createdAt: 'desc' },
    });
    return row
      ? {
          id: row.id,
          emailHmac: row.emailHmac,
          codeHmac: row.codeHmac,
          expiresAt: row.expiresAt,
          usedAt: row.usedAt,
          attempts: row.attempts,
          createdAt: row.createdAt,
        }
      : null;
  }

  async claimMatching(emailHmac: string, codeHmac: string, now: Date): Promise<AuthCodeRow | null> {
    const rows = await this.prisma.$queryRaw<RawCode[]>`
      UPDATE auth_codes
      SET used_at = ${now}
      WHERE id = (
        SELECT id FROM auth_codes
        WHERE email_hmac = ${emailHmac}
          AND code_hmac = ${codeHmac}
          AND used_at IS NULL
          AND attempts < 5
          AND expires_at > ${now}
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      )
      RETURNING id, email_hmac, code_hmac, expires_at, used_at, attempts, created_at
    `;
    const row = rows[0];
    return row ? fromRaw(row) : null;
  }

  async recordFailure(id: string): Promise<AuthCodeRow | null> {
    const rows = await this.prisma.$queryRaw<RawCode[]>`
      UPDATE auth_codes
      SET attempts = attempts + 1
      WHERE id = CAST(${id} AS uuid)
        AND used_at IS NULL
      RETURNING id, email_hmac, code_hmac, expires_at, used_at, attempts, created_at
    `;
    const row = rows[0];
    return row ? fromRaw(row) : null;
  }

  async reserveAttempt(emailHmac: string, now: Date): Promise<ReservedAttempt | null> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; code_hmac: string }>>`
      UPDATE auth_codes
      SET attempts = attempts + 1
      WHERE id = (
        SELECT id FROM auth_codes
        WHERE email_hmac = ${emailHmac}
          AND used_at IS NULL
          AND expires_at > ${now}
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      )
        AND attempts < 5
      RETURNING id, code_hmac
    `;
    const row = rows[0];
    return row ? { id: row.id, codeHmac: row.code_hmac } : null;
  }

  async claimUnused(id: string, now: Date): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE auth_codes
      SET used_at = ${now}
      WHERE id = CAST(${id} AS uuid)
        AND used_at IS NULL
      RETURNING id
    `;
    return rows.length > 0;
  }

  async deleteById(id: string): Promise<void> {
    await this.prisma.authCode.deleteMany({ where: { id } });
  }

  async markUsed(id: string, now: Date): Promise<void> {
    await this.prisma.authCode.updateMany({ where: { id, usedAt: null }, data: { usedAt: now } });
  }
}

export class PrismaAuthSessions implements SessionDirectory {
  constructor(private readonly prisma: PrismaClient) {}

  async open(sid: string, userId: string): Promise<void> {
    await this.prisma.authSession.create({ data: { id: sid, userId } });
  }

  async revoke(sid: string, now: Date = new Date()): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { id: sid, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async isRevoked(sid: string): Promise<boolean> {
    const row = await this.prisma.authSession.findUnique({ where: { id: sid }, select: { revokedAt: true } });
    return !row || row.revokedAt !== null;
  }
}

export class PrismaAuthAudit implements AuthAuditLog {
  constructor(private readonly prisma: PrismaClient) {}

  async append(event: AuthAuditEvent): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: event.userId,
        action: event.action,
        entityType: 'auth_session',
        entityId: event.sessionId,
        metadata: event.emailHmac ? { emailHmac: event.emailHmac } : {},
        createdAt: event.now,
      },
    });
  }

  storedText(): string {
    return '';
  }
}

function fromRaw(row: RawCode): AuthCodeRow {
  return {
    id: row.id,
    emailHmac: row.email_hmac,
    codeHmac: row.code_hmac,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    attempts: row.attempts,
    createdAt: row.created_at,
  };
}
