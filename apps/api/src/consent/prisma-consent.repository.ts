import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  AvisoVersionMissingError,
  ConsentAuditEntry,
  ConsentAuditLog,
  ConsentRepository,
  ConsentRow,
  UniqueConsentError,
} from './consent.repository.js';

export class PrismaConsentRepository implements ConsentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async find(userId: string, avisoVersion: string): Promise<ConsentRow | null> {
    const row = await this.prisma.consent.findUnique({
      where: { userId_avisoVersion: { userId, avisoVersion } },
    });
    return row ? toRow(row) : null;
  }

  async insert(row: ConsentRow): Promise<ConsentRow> {
    try {
      const created = await this.prisma.consent.create({
        data: {
          id: row.id,
          userId: row.userId,
          avisoVersion: row.avisoVersion,
          acceptedAt: row.acceptedAt,
          appVersion: row.appVersion,
          createdAt: row.createdAt,
        },
      });
      return toRow(created);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new UniqueConsentError();
      }
      throw error;
    }
  }

  /**
   * The consent row and its audit event commit together. The external audit
   * log is not called, so a repeat cannot write a second entry from here.
   */
  async acceptAtomic(row: ConsentRow, entry: ConsentAuditEntry, _audit: ConsentAuditLog): Promise<ConsentRow> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.consent.create({
          data: {
            id: row.id,
            userId: row.userId,
            avisoVersion: row.avisoVersion,
            acceptedAt: row.acceptedAt,
            appVersion: row.appVersion,
            createdAt: row.createdAt,
          },
        });
        await tx.auditEvent.create({
          data: {
            id: randomUUID(),
            actorUserId: entry.userId,
            action: entry.action,
            entityType: 'consent',
            entityId: entry.consentId,
            metadata: {
              avisoVersion: entry.avisoVersion,
              appVersion: entry.appVersion,
              consentId: entry.consentId,
            },
          },
        });
        return toRow(created);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new UniqueConsentError();
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003' && mentionsAviso(error)) {
        throw new AvisoVersionMissingError();
      }
      throw error;
    }
  }
}

function mentionsAviso(error: Prisma.PrismaClientKnownRequestError): boolean {
  return `${error.message} ${JSON.stringify(error.meta ?? {})}`.toLowerCase().includes('aviso');
}

function toRow(row: {
  id: string;
  userId: string;
  avisoVersion: string;
  acceptedAt: Date;
  appVersion: string | null;
  createdAt: Date;
}): ConsentRow {
  return {
    id: row.id,
    userId: row.userId,
    avisoVersion: row.avisoVersion,
    acceptedAt: row.acceptedAt,
    appVersion: row.appVersion,
    createdAt: row.createdAt,
  };
}
