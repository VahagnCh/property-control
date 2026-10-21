import { Prisma, PrismaClient } from '@prisma/client';
import type { LedgerStore, LedgerTx, ObligationSnapshot, PaymentSnapshot } from '../payments/ledger.js';
import { centavosToLedgerNumber } from '../payments/wire-money.js';
import type { ScheduleCadence } from '../obligations/schedule.js';

type Tx = Prisma.TransactionClient;

export class PrismaLedger implements LedgerStore {
  constructor(private readonly prisma: PrismaClient) {}

  transaction<T>(work: (tx: LedgerTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => work(new PrismaLedgerTx(tx)));
  }
}

class PrismaLedgerTx implements LedgerTx {
  constructor(private readonly tx: Tx) {}

  async lockObligation(id: string): Promise<ObligationSnapshot | null> {
    const rows = await this.tx.$queryRaw<ObligationRaw[]>`
      SELECT id, property_id, recurrence::text AS recurrence, due_day, schedule_anchor,
             next_due_date, expected_amount, currency
      FROM obligations
      WHERE id = CAST(${id} AS uuid) AND deleted_at IS NULL
      FOR UPDATE
    `;
    const row = rows[0];
    return row ? toObligation(row) : null;
  }

  async saveNextDueDate(id: string, nextDueDate: string | null): Promise<void> {
    await this.tx.obligation.update({
      where: { id },
      data: { nextDueDate: nextDueDate ? utcDate(nextDueDate) : null },
    });
  }

  async insertPayment(row: PaymentSnapshot): Promise<void> {
    await this.tx.payment.create({
      data: {
        id: row.id,
        propertyId: row.propertyId,
        obligationId: row.obligationId,
        periodDueDate: utcDate(row.periodDueDate),
        recordedByUserId: row.recordedByUserId,
        amount: BigInt(row.amount),
        currency: 'MXN',
        paidAt: row.paidAt,
        status: 'recorded',
        idempotencyKey: row.id,
        createdAt: row.createdAt,
      },
    });
  }

  async findPayment(id: string): Promise<PaymentSnapshot | null> {
    const row = await this.tx.payment.findUnique({ where: { id } });
    return row ? toPayment(row) : null;
  }

  async lockPayment(id: string): Promise<PaymentSnapshot | null> {
    const rows = await this.tx.$queryRaw<PaymentRaw[]>`
      SELECT id, property_id, obligation_id, period_due_date, amount, currency, paid_at,
             status::text AS status, voided_at, voided_by, void_reason, created_at, recorded_by_user_id
      FROM payments
      WHERE id = CAST(${id} AS uuid)
      FOR UPDATE
    `;
    const row = rows[0];
    return row ? toPaymentRaw(row) : null;
  }

  async markVoided(row: PaymentSnapshot): Promise<void> {
    await this.tx.payment.update({
      where: { id: row.id },
      data: {
        status: 'voided',
        voidedAt: row.voidedAt,
        voidedByUserId: row.voidedByUserId,
        voidReason: row.voidReason,
      },
    });
  }

  async lockPayments(obligationId: string): Promise<PaymentSnapshot[]> {
    const rows = await this.tx.$queryRaw<PaymentRaw[]>`
      SELECT id, property_id, obligation_id, period_due_date, amount, currency, paid_at,
             status::text AS status, voided_at, voided_by, void_reason, created_at, recorded_by_user_id
      FROM payments
      WHERE obligation_id = CAST(${obligationId} AS uuid)
      FOR UPDATE
    `;
    return rows.map(toPaymentRaw);
  }
}

interface ObligationRaw {
  id: string;
  property_id: string;
  recurrence: ScheduleCadence;
  due_day: number | null;
  schedule_anchor: Date | null;
  next_due_date: Date | null;
  expected_amount: bigint | number | string | null;
  currency: string;
}

interface PaymentRaw {
  id: string;
  property_id: string;
  obligation_id: string;
  period_due_date: Date;
  amount: bigint | number | string;
  currency: string;
  paid_at: Date;
  status: 'recorded' | 'voided';
  voided_at: Date | null;
  voided_by: string | null;
  void_reason: string | null;
  created_at: Date;
  recorded_by_user_id: string;
}

function toObligation(row: ObligationRaw): ObligationSnapshot {
  return {
    id: row.id,
    propertyId: row.property_id,
    recurrence: row.recurrence,
    dueDay: row.due_day,
    scheduleAnchor: row.schedule_anchor ? isoDate(row.schedule_anchor) : null,
    nextDueDate: row.next_due_date ? isoDate(row.next_due_date) : null,
    expectedAmount: centavosToLedgerNumber(row.expected_amount),
    currency: row.currency,
  };
}

function toPayment(row: {
  id: string;
  propertyId: string;
  obligationId: string;
  periodDueDate: Date;
  amount: bigint | number | string;
  currency: string;
  paidAt: Date;
  status: 'recorded' | 'voided';
  voidedAt: Date | null;
  voidedByUserId: string | null;
  voidReason: string | null;
  createdAt: Date;
  recordedByUserId: string;
}): PaymentSnapshot {
  return {
    id: row.id,
    propertyId: row.propertyId,
    obligationId: row.obligationId,
    periodDueDate: isoDate(row.periodDueDate),
    amount: ledgerCentavos(row.amount),
    currency: row.currency,
    paidAt: row.paidAt,
    status: row.status,
    voidedAt: row.voidedAt,
    voidedByUserId: row.voidedByUserId,
    voidReason: row.voidReason,
    createdAt: row.createdAt,
    recordedByUserId: row.recordedByUserId,
    markPartial: false,
  };
}

function toPaymentRaw(row: PaymentRaw): PaymentSnapshot {
  return {
    id: row.id,
    propertyId: row.property_id,
    obligationId: row.obligation_id,
    periodDueDate: isoDate(row.period_due_date),
    amount: ledgerCentavos(row.amount),
    currency: row.currency,
    paidAt: row.paid_at,
    status: row.status,
    voidedAt: row.voided_at,
    voidedByUserId: row.voided_by,
    voidReason: row.void_reason,
    createdAt: row.created_at,
    recordedByUserId: row.recorded_by_user_id,
    markPartial: false,
  };
}

function ledgerCentavos(value: bigint | number | string): number {
  const cents = centavosToLedgerNumber(value);
  if (cents === null) {
    throw new Error('payment amount is missing');
  }
  return cents;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
