import { Prisma, PrismaClient } from '@prisma/client';
import { ConsentRepository, ConsentRow, UniqueConsentError } from './consent.repository.js';

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
