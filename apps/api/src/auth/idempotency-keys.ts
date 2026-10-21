import { randomUUID } from 'node:crypto';
import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { Mutex } from '../persistence/mutex.js';

export interface IdempotencyInput {
  userId: string;
  key: string;
  route: string;
  requestHash: string;
  now: Date;
  expiresAt: Date;
}

export type ReserveResult =
  | { outcome: 'reserved'; id: string }
  | { outcome: 'replay'; responseStatus: number; responseBody: unknown }
  | { outcome: 'in_progress' };

interface StoredKey {
  id: string;
  userId: string;
  key: string;
  route: string;
  requestHash: string;
  responseStatus: number | null;
  responseBody: unknown;
  createdAt: Date;
  expiresAt: Date;
}

export class MemoryIdempotencyKeys {
  private readonly rows = new Map<string, StoredKey>();
  private readonly mutex = new Mutex();

  reserve(input: IdempotencyInput): Promise<ReserveResult> {
    return this.mutex.run(async () => reserveStored(this.rows, input));
  }

  complete(id: string, responseStatus: number, responseBody: unknown): Promise<void> {
    return this.mutex.run(async () => {
      const row = [...this.rows.values()].find((item) => item.id === id);
      if (!row || row.responseStatus !== null) {
        return;
      }
      row.responseStatus = responseStatus;
      row.responseBody = responseBody;
    });
  }
}

export class PrismaIdempotencyKeys {
  constructor(private readonly prisma: PrismaClient) {}

  async reserve(input: IdempotencyInput): Promise<ReserveResult> {
    try {
      return await this.prisma.$transaction((tx) => reservePrisma(tx, input));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.$transaction((tx) => reservePrisma(tx, input));
      }
      throw error;
    }
  }

  async complete(id: string, responseStatus: number, responseBody: unknown): Promise<void> {
    await this.prisma.idempotencyKey.updateMany({
      where: { id, responseStatus: null },
      data: { responseStatus, responseBody: responseBody as Prisma.InputJsonValue },
    });
  }
}

function reserveStored(rows: Map<string, StoredKey>, input: IdempotencyInput): ReserveResult {
  const mapKey = `${input.userId}\0${input.key}`;
  const existing = rows.get(mapKey);
  if (existing && existing.expiresAt > input.now) {
    return decision(existing, input.requestHash);
  }
  if (existing) {
    rows.delete(mapKey);
  }
  const created: StoredKey = {
    id: randomUUID(),
    userId: input.userId,
    key: input.key,
    route: input.route,
    requestHash: input.requestHash,
    responseStatus: null,
    responseBody: null,
    createdAt: input.now,
    expiresAt: input.expiresAt,
  };
  rows.set(mapKey, created);
  return { outcome: 'reserved', id: created.id };
}

async function reservePrisma(tx: Prisma.TransactionClient, input: IdempotencyInput): Promise<ReserveResult> {
  const existing = await tx.idempotencyKey.findUnique({
    where: { userId_key: { userId: input.userId, key: input.key } },
  });
  if (existing && existing.expiresAt > input.now) {
    return decision(
      {
        requestHash: existing.requestHash,
        responseStatus: existing.responseStatus,
        responseBody: existing.responseBody,
      },
      input.requestHash,
    );
  }
  if (existing) {
    await tx.idempotencyKey.delete({ where: { id: existing.id } });
  }
  const created = await tx.idempotencyKey.create({
    data: {
      id: randomUUID(),
      userId: input.userId,
      key: input.key,
      route: input.route,
      requestHash: input.requestHash,
      expiresAt: input.expiresAt,
      createdAt: input.now,
    },
  });
  return { outcome: 'reserved', id: created.id };
}

function decision(
  existing: { requestHash: string; responseStatus: number | null; responseBody: unknown },
  requestHash: string,
): ReserveResult {
  if (existing.requestHash !== requestHash) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'idempotency_key_mismatch',
      message: 'This idempotency key was already used with a different request.',
    });
  }
  if (existing.responseStatus !== null) {
    return {
      outcome: 'replay',
      responseStatus: existing.responseStatus,
      responseBody: existing.responseBody,
    };
  }
  return { outcome: 'in_progress' };
}
