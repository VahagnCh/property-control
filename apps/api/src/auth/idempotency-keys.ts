import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { Mutex } from '../persistence/mutex.js';

/** 8–128 characters. Hyphens are allowed, so a UUID v4 (36 characters) passes. */
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

export interface IdempotencyInput {
  userId?: string | null;
  emailHmac?: string | null;
  key: string;
  method: string;
  route: string;
  requestHash: string;
  now: Date;
  expiresAt: Date;
}

export type ReserveResult =
  | { outcome: 'reserved'; id: string }
  | { outcome: 'replay'; responseStatus: number; responseBody: unknown }
  | { outcome: 'in_progress' };

/** 2xx and 4xx are stored. 5xx is released so the same key can try again. */
export function isReplayableStatus(status: number): boolean {
  return status >= 200 && status < 500;
}

export interface IdempotencyStore {
  reserve(input: IdempotencyInput): Promise<ReserveResult>;
  complete(id: string, responseStatus: number, responseBody: unknown): Promise<void>;
  release(id: string): Promise<void>;
}

interface StoredKey {
  id: string;
  userId: string | null;
  emailHmac: string | null;
  key: string;
  method: string;
  route: string;
  requestHash: string;
  responseStatus: number | null;
  responseBody: unknown;
  createdAt: Date;
  expiresAt: Date;
}

export class IdempotencyKeyReusedException extends ConflictException {
  constructor() {
    super({
      statusCode: 409,
      error: 'idempotency_key_reused',
      message: 'This idempotency key was already used with a different request.',
    });
  }
}

export class IdempotencyKeyInvalidException extends BadRequestException {
  constructor() {
    super({
      statusCode: 400,
      error: 'idempotency_key_invalid',
      message: 'Idempotency-Key must be 8 to 128 characters of letters, digits, underscores, or hyphens.',
    });
  }
}

export function assertIdempotencyKey(key: string): void {
  if (!IDEMPOTENCY_KEY.test(key)) {
    throw new IdempotencyKeyInvalidException();
  }
}

function normalizeMethod(method: string): string {
  return method.trim().toUpperCase();
}

export class MemoryIdempotencyKeys implements IdempotencyStore {
  private readonly rows = new Map<string, StoredKey>();
  private readonly mutex = new Mutex();

  /** Stored rows. Tests use this to prove a plain email was never written. */
  storedText(): string {
    return JSON.stringify([...this.rows.values()]);
  }

  reserve(input: IdempotencyInput): Promise<ReserveResult> {
    return this.mutex.run(async () => reserveStored(this.rows, input));
  }

  complete(id: string, responseStatus: number, responseBody: unknown): Promise<void> {
    if (!isReplayableStatus(responseStatus)) {
      return this.release(id);
    }
    return this.mutex.run(async () => {
      const row = [...this.rows.values()].find((item) => item.id === id);
      if (!row || row.responseStatus !== null) {
        return;
      }
      row.responseStatus = responseStatus;
      row.responseBody = responseBody;
    });
  }

  release(id: string): Promise<void> {
    return this.mutex.run(async () => {
      for (const [key, row] of this.rows) {
        if (row.id === id && row.responseStatus === null) {
          this.rows.delete(key);
        }
      }
    });
  }
}

export class PrismaIdempotencyKeys implements IdempotencyStore {
  constructor(private readonly prisma: PrismaClient) {}

  async reserve(input: IdempotencyInput): Promise<ReserveResult> {
    assertIdempotencyKey(input.key);
    scopeOf(input);
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
    if (!isReplayableStatus(responseStatus)) {
      await this.release(id);
      return;
    }
    await this.prisma.idempotencyKey.updateMany({
      where: { id, responseStatus: null },
      data: { responseStatus, responseBody: responseBody as Prisma.InputJsonValue },
    });
  }

  async release(id: string): Promise<void> {
    await this.prisma.idempotencyKey.deleteMany({ where: { id, responseStatus: null } });
  }
}

function reserveStored(rows: Map<string, StoredKey>, raw: IdempotencyInput): ReserveResult {
  const input = { ...raw, method: normalizeMethod(raw.method) };
  assertIdempotencyKey(input.key);
  const scope = scopeOf(input);
  const mapKey = scopeKey(scope, input);
  const existing = rows.get(mapKey);
  if (existing && existing.expiresAt > input.now) {
    return decision(existing, input.requestHash);
  }
  if (existing) {
    rows.delete(mapKey);
  }
  const created: StoredKey = {
    id: randomUUID(),
    userId: scope.kind === 'user' ? scope.subject : null,
    emailHmac: scope.kind === 'email' ? scope.subject : null,
    key: input.key,
    method: input.method,
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

async function reservePrisma(tx: Prisma.TransactionClient, raw: IdempotencyInput): Promise<ReserveResult> {
  const input = { ...raw, method: normalizeMethod(raw.method) };
  const scope = scopeOf(input);
  const existing = await tx.idempotencyKey.findFirst({
    where:
      scope.kind === 'user'
        ? { userId: scope.subject, method: input.method, route: input.route, key: input.key }
        : { emailHmac: scope.subject, method: input.method, route: input.route, key: input.key },
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
      userId: scope.kind === 'user' ? scope.subject : null,
      emailHmac: scope.kind === 'email' ? scope.subject : null,
      key: input.key,
      method: input.method,
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
    throw new IdempotencyKeyReusedException();
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

interface Scope {
  kind: 'user' | 'email';
  subject: string;
}

function scopeOf(input: IdempotencyInput): Scope {
  const userId = input.userId ?? null;
  const emailHmac = input.emailHmac ?? null;
  if ((userId === null) === (emailHmac === null)) {
    throw new Error('An idempotency key needs exactly one of userId or emailHmac.');
  }
  if (userId !== null) {
    return { kind: 'user', subject: userId };
  }
  return { kind: 'email', subject: emailHmac ?? '' };
}

function scopeKey(scope: Scope, input: IdempotencyInput): string {
  return [scope.kind, scope.subject, input.method, input.route, input.key].join('\u001e');
}
