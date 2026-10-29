import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import type { OcrAuditAppend, OcrTargetLookup, SavedFieldQuery } from '../ocr/ocr-target-lookup.js';
import { centavosToWireAmount, wireAmountToCentavos } from '../payments/wire-money.js';

type Db = Prisma.TransactionClient | PrismaClient;

/**
 * Reads and writes OCR target fields inside `prisma.$transaction`.
 * The transaction client lives in AsyncLocalStorage, one per confirm, so two
 * overlapping confirms cannot see each other's transaction.
 * `savedValue` takes `FOR UPDATE` while a transaction is open so confirm can
 * re-check the value captured by `plan()`.
 */
export class PrismaOcrFieldStore implements OcrTargetLookup {
  private readonly transactions = new AsyncLocalStorage<Prisma.TransactionClient>();

  constructor(private readonly prisma: PrismaClient) {}

  async belongsToProperty(input: {
    propertyId: string;
    entityType: SavedFieldQuery['entityType'];
    entityId: string;
  }): Promise<boolean> {
    const db = this.client();
    const where = { id: input.entityId, propertyId: input.propertyId, deletedAt: null };
    if (input.entityType === 'obligation') {
      return (await db.obligation.findFirst({ where, select: { id: true } })) !== null;
    }
    if (input.entityType === 'document_meta') {
      return (await db.document.findFirst({ where, select: { id: true } })) !== null;
    }
    if (input.entityType === 'payment') {
      return (await db.payment.findFirst({ where: { id: input.entityId, propertyId: input.propertyId }, select: { id: true } })) !== null;
    }
    if (input.entityType === 'property') {
      return (await db.property.findFirst({ where, select: { id: true } })) !== null;
    }
    return false;
  }

  async paymentStatus(input: { propertyId: string; entityId: string }): Promise<'recorded' | 'voided' | undefined> {
    const row = await this.client().payment.findFirst({
      where: { id: input.entityId, propertyId: input.propertyId },
      select: { status: true },
    });
    return row?.status;
  }

  async timeZone(propertyId: string): Promise<string | undefined> {
    const row = await this.client().property.findFirst({
      where: { id: propertyId, deletedAt: null },
      select: { timezone: true },
    });
    return row?.timezone;
  }

  async savedValue(input: SavedFieldQuery): Promise<unknown> {
    return this.readField(input, this.transactions.getStore() !== undefined);
  }

  async saveValue(input: SavedFieldQuery, value: unknown): Promise<void> {
    const db = this.client();
    if (input.entityType === 'obligation') {
      const data = obligationData(input.fieldPath, value);
      const result = await db.obligation.updateMany({
        where: { id: input.entityId, propertyId: input.propertyId, deletedAt: null },
        data,
      });
      if (result.count !== 1) {
        throw new Error('OCR target obligation was not updated.');
      }
      return;
    }
    if (input.entityType === 'document_meta' && input.fieldPath === 'title' && typeof value === 'string') {
      const result = await db.document.updateMany({
        where: { id: input.entityId, propertyId: input.propertyId, deletedAt: null },
        data: { title: value },
      });
      if (result.count !== 1) {
        throw new Error('OCR target document was not updated.');
      }
      return;
    }
    throw new Error('OCR target field was not updated.');
  }

  runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => this.transactions.run(tx, work));
  }

  async appendAudit(event: OcrAuditAppend): Promise<void> {
    await this.client().auditEvent.create({
      data: {
        id: randomUUID(),
        propertyId: event.propertyId,
        actorUserId: event.actorUserId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        beforeState: event.beforeState ?? undefined,
        afterState: event.afterState ?? undefined,
        metadata: event.metadata as Prisma.InputJsonValue,
      },
    });
  }

  private client(): Db {
    return this.transactions.getStore() ?? this.prisma;
  }

  private async readField(input: SavedFieldQuery, lock: boolean): Promise<unknown> {
    if (input.entityType === 'obligation') {
      const rows = lock
        ? await this.client().$queryRaw<ObligationField[]>`
            SELECT provider_name, notes, next_due_date, expected_amount
            FROM obligations
            WHERE id = CAST(${input.entityId} AS uuid)
              AND property_id = CAST(${input.propertyId} AS uuid)
              AND deleted_at IS NULL
            FOR UPDATE
          `
        : await this.client().$queryRaw<ObligationField[]>`
            SELECT provider_name, notes, next_due_date, expected_amount
            FROM obligations
            WHERE id = CAST(${input.entityId} AS uuid)
              AND property_id = CAST(${input.propertyId} AS uuid)
              AND deleted_at IS NULL
          `;
      return obligationField(rows[0], input.fieldPath);
    }
    if (input.entityType === 'document_meta' && input.fieldPath === 'title') {
      const rows = lock
        ? await this.client().$queryRaw<Array<{ title: string }>>`
            SELECT title FROM documents
            WHERE id = CAST(${input.entityId} AS uuid)
              AND property_id = CAST(${input.propertyId} AS uuid)
              AND deleted_at IS NULL
            FOR UPDATE
          `
        : await this.client().$queryRaw<Array<{ title: string }>>`
            SELECT title FROM documents
            WHERE id = CAST(${input.entityId} AS uuid)
              AND property_id = CAST(${input.propertyId} AS uuid)
              AND deleted_at IS NULL
          `;
      return rows[0]?.title ?? null;
    }
    return null;
  }
}

interface ObligationField {
  provider_name: string | null;
  notes: string | null;
  next_due_date: Date | null;
  expected_amount: bigint | number | string | null;
}

function obligationField(row: ObligationField | undefined, fieldPath: string): unknown {
  if (!row) {
    return null;
  }
  if (fieldPath === 'providerName') {
    return row.provider_name;
  }
  if (fieldPath === 'notes') {
    return row.notes;
  }
  if (fieldPath === 'nextDueDate') {
    return row.next_due_date ? row.next_due_date.toISOString().slice(0, 10) : null;
  }
  if (fieldPath === 'expectedAmount') {
    return row.expected_amount === null ? null : centavosToWireAmount(asCentavos(row.expected_amount));
  }
  return null;
}

function obligationData(fieldPath: string, value: unknown): Prisma.ObligationUpdateManyMutationInput {
  if (fieldPath === 'providerName' && typeof value === 'string') {
    return { providerName: value };
  }
  if (fieldPath === 'notes' && typeof value === 'string') {
    return { notes: value };
  }
  if (fieldPath === 'nextDueDate' && typeof value === 'string') {
    return { nextDueDate: new Date(`${value}T00:00:00.000Z`) };
  }
  if (fieldPath === 'expectedAmount' && typeof value === 'string') {
    return { expectedAmount: wireAmountToCentavos(value) };
  }
  throw new Error(`Unsupported obligation field ${fieldPath}.`);
}

function asCentavos(value: bigint | number | string): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}
