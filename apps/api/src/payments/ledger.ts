import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { calendarDateInTimeZone, parseIsoDate } from '../common/property-calendar.js';
import { notFoundException } from '../common/not-found.js';
import { periodAfter, type ScheduleCadence } from '../obligations/schedule.js';

const MONTHS_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

export interface ObligationSnapshot {
  id: string;
  propertyId: string;
  recurrence: ScheduleCadence;
  dueDay: number | null;
  scheduleAnchor: string | null;
  nextDueDate: string | null;
  expectedAmount: number | null;
  currency: string;
}

export interface PaymentSnapshot {
  id: string;
  propertyId: string;
  obligationId: string;
  periodDueDate: string;
  amount: number;
  currency: string;
  paidAt: Date;
  status: 'recorded' | 'voided';
  voidedAt: Date | null;
  voidedByUserId: string | null;
  voidReason: string | null;
  createdAt: Date;
  recordedByUserId: string;
  /** True only when expectedAmount is null and this payment must not settle the period. */
  markPartial: boolean;
  idempotencyKey?: string;
  notes?: string | null;
  method?: string | null;
  reference?: string | null;
}

export interface PeriodOutcomeSnapshot {
  obligationId: string;
  propertyId: string;
  periodDueDate: string;
  outcome: 'paid' | 'partial';
  paymentId: string;
  overpaidAmount: number;
}

export interface LedgerTx {
  lockObligation(id: string): Promise<ObligationSnapshot | null>;
  saveNextDueDate(id: string, nextDueDate: string | null): Promise<void>;
  insertPayment(row: PaymentSnapshot): Promise<void>;
  findPayment(id: string): Promise<PaymentSnapshot | null>;
  lockPayment(id: string): Promise<PaymentSnapshot | null>;
  markVoided(row: PaymentSnapshot): Promise<void>;
  lockPayments(obligationId: string): Promise<PaymentSnapshot[]>;
  saveOutcome(row: PeriodOutcomeSnapshot): Promise<void>;
  deleteOutcome(obligationId: string, periodDueDate: string): Promise<void>;
}

export interface LedgerStore {
  transaction<T>(work: (tx: LedgerTx) => Promise<T>): Promise<T>;
}

export interface DuplicateWarning {
  code: 'possible_duplicate';
  message: string;
}

export interface RecordPaymentInput {
  id: string;
  obligationId: string;
  amountCentavos: number;
  currency?: string;
  paidAt: Date;
  timeZone: string;
  actorUserId: string;
  periodDueDate?: string;
  markPartial?: boolean;
  createdAt?: Date;
  idempotencyKey?: string;
  notes?: string | null;
  method?: string | null;
  reference?: string | null;
}

export interface RecordPaymentResult {
  payment: PaymentSnapshot;
  warnings: DuplicateWarning[];
  nextDueDate: string | null;
}

export interface VoidPaymentInput {
  paymentId: string;
  actorUserId: string;
  reason: string;
  now: Date;
}

export function formatMxn(centavos: number): string {
  const negative = centavos < 0;
  const abs = Math.abs(centavos);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}$${whole}.${frac}`;
}

export function duplicateWarningMessage(centavos: number, isoDate: string): string {
  const parsed = parseIsoDate(isoDate);
  if (!parsed) {
    throw new Error('Invalid calendar date.');
  }
  const month = MONTHS_ES[parsed.month - 1];
  return `Ya registraste un pago de ${formatMxn(centavos)} el ${parsed.day} de ${month} de ${parsed.year}. ¿Registrar otro?`;
}

export function assertDueDateSanity(iso: string): void {
  if (iso < '1990-01-01' || iso > '2100-12-31') {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'next_due_date_out_of_range',
      message: 'nextDueDate is outside 1990-01-01 through 2100-12-31.',
    });
  }
}

export async function recordPayment(store: LedgerStore, input: RecordPaymentInput): Promise<RecordPaymentResult> {
  if (!Number.isInteger(input.amountCentavos) || input.amountCentavos <= 0) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'amount_invalid',
      message: 'amount must be a positive number of centavos.',
    });
  }
  if ((input.currency ?? 'MXN') !== 'MXN') {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'currency_invalid',
      message: 'currency must be MXN.',
    });
  }
  return store.transaction(async (tx) => {
    const obligation = await tx.lockObligation(input.obligationId);
    if (!obligation) {
      throw notFoundException();
    }
    if (obligation.expectedAmount !== null && input.markPartial) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'mark_partial_invalid',
        message: 'markPartial is only valid when expectedAmount is unset.',
      });
    }
    const payments = await tx.lockPayments(obligation.id);
    const periodDueDate = input.periodDueDate ?? obligation.nextDueDate;
    if (!periodDueDate) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        error: 'period_required',
        message: 'periodDueDate is required when the obligation has no next due date.',
      });
    }
    const paidOn = calendarDateInTimeZone(input.paidAt, input.timeZone);
    const warnings = duplicateWarnings(payments, input.amountCentavos, paidOn, input.timeZone);
    const payment: PaymentSnapshot = {
      id: input.id,
      propertyId: obligation.propertyId,
      obligationId: obligation.id,
      periodDueDate,
      amount: input.amountCentavos,
      currency: 'MXN',
      paidAt: input.paidAt,
      status: 'recorded',
      voidedAt: null,
      voidedByUserId: null,
      voidReason: null,
      createdAt: input.createdAt ?? input.paidAt,
      recordedByUserId: input.actorUserId,
      markPartial: input.markPartial === true,
      idempotencyKey: input.idempotencyKey,
      notes: input.notes,
      method: input.method,
      reference: input.reference,
    };
    const wasSettled = periodSettled(obligation, payments, periodDueDate);
    await tx.insertPayment(payment);
    const withPayment = [...payments, payment];
    await syncPeriod(tx, obligation, withPayment, periodDueDate);
    const nextDueDate = wasSettled
      ? obligation.nextDueDate
      : advancedDueDate(obligation, withPayment, periodDueDate);
    if (nextDueDate) {
      assertDueDateSanity(nextDueDate);
    }
    if (nextDueDate !== obligation.nextDueDate) {
      await tx.saveNextDueDate(obligation.id, nextDueDate);
    }
    return { payment, warnings, nextDueDate };
  });
}

export async function voidPayment(store: LedgerStore, input: VoidPaymentInput): Promise<PaymentSnapshot> {
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > 500) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'void_reason_invalid',
      message: 'voidReason must be 1 to 500 characters.',
    });
  }
  return store.transaction(async (tx) => {
    const peek = await tx.findPayment(input.paymentId);
    if (!peek) {
      throw notFoundException();
    }
    await tx.lockObligation(peek.obligationId);
    const payment = await tx.lockPayment(input.paymentId);
    if (!payment) {
      throw notFoundException();
    }
    if (payment.status === 'voided') {
      throw new ConflictException({
        statusCode: 409,
        error: 'already_voided',
        message: 'A voided payment cannot be voided again.',
      });
    }
    const voided: PaymentSnapshot = {
      ...payment,
      status: 'voided',
      voidedAt: input.now,
      voidedByUserId: input.actorUserId,
      voidReason: reason,
    };
    await tx.markVoided(voided);
    const obligation = await tx.lockObligation(payment.obligationId);
    if (!obligation) {
      throw notFoundException();
    }
    const payments = (await tx.lockPayments(obligation.id)).map((row) =>
      row.id === voided.id ? voided : row,
    );
    await syncPeriod(tx, obligation, payments, voided.periodDueDate);
    const nextDueDate = earliestUnsettled(obligation, payments);
    if (nextDueDate) {
      assertDueDateSanity(nextDueDate);
    }
    if (nextDueDate !== obligation.nextDueDate) {
      await tx.saveNextDueDate(obligation.id, nextDueDate);
    }
    return voided;
  });
}

function duplicateWarnings(
  payments: PaymentSnapshot[],
  amount: number,
  paidOn: string,
  timeZone: string,
): DuplicateWarning[] {
  const matches = payments
    .filter((payment) => payment.status === 'recorded' && payment.amount === amount)
    .map((payment) => ({ payment, on: calendarDateInTimeZone(payment.paidAt, timeZone) }))
    .filter((match) => calendarDaysApart(match.on, paidOn) <= 3)
    .sort((left, right) => {
      const paid = right.payment.paidAt.getTime() - left.payment.paidAt.getTime();
      if (paid !== 0) {
        return paid;
      }
      return right.payment.createdAt.getTime() - left.payment.createdAt.getTime();
    });
  const match = matches[0];
  if (!match) {
    return [];
  }
  return [{ code: 'possible_duplicate', message: duplicateWarningMessage(amount, match.on) }];
}

function calendarDaysApart(left: string, right: string): number {
  const a = parseIsoDate(left);
  const b = parseIsoDate(right);
  if (!a || !b) {
    return 99;
  }
  const leftMs = Date.UTC(a.year, a.month - 1, a.day);
  const rightMs = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round(Math.abs(leftMs - rightMs) / 86_400_000);
}

export function periodOutcomeOf(
  obligation: ObligationSnapshot,
  payments: PaymentSnapshot[],
  periodDue: string,
): PeriodOutcomeSnapshot | null {
  const recorded = payments.filter((payment) => payment.status === 'recorded' && payment.periodDueDate === periodDue);
  if (recorded.length === 0) {
    return null;
  }
  const sum = recorded.reduce((total, payment) => total + payment.amount, 0);
  const latest = [...recorded].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
  if (!latest || sum <= 0) {
    return null;
  }
  if (obligation.expectedAmount === null) {
    return {
      obligationId: obligation.id,
      propertyId: obligation.propertyId,
      periodDueDate: periodDue,
      outcome: recorded.some((payment) => !payment.markPartial) ? 'paid' : 'partial',
      paymentId: latest.id,
      overpaidAmount: 0,
    };
  }
  if (sum < obligation.expectedAmount) {
    return {
      obligationId: obligation.id,
      propertyId: obligation.propertyId,
      periodDueDate: periodDue,
      outcome: 'partial',
      paymentId: latest.id,
      overpaidAmount: 0,
    };
  }
  return {
    obligationId: obligation.id,
    propertyId: obligation.propertyId,
    periodDueDate: periodDue,
    outcome: 'paid',
    paymentId: latest.id,
    overpaidAmount: sum - obligation.expectedAmount,
  };
}

async function syncPeriod(
  tx: LedgerTx,
  obligation: ObligationSnapshot,
  payments: PaymentSnapshot[],
  periodDue: string,
): Promise<void> {
  const outcome = periodOutcomeOf(obligation, payments, periodDue);
  if (!outcome) {
    await tx.deleteOutcome(obligation.id, periodDue);
    return;
  }
  await tx.saveOutcome(outcome);
}

function periodSettled(obligation: ObligationSnapshot, payments: PaymentSnapshot[], periodDue: string): boolean {
  const recorded = payments.filter((payment) => payment.status === 'recorded' && payment.periodDueDate === periodDue);
  if (obligation.expectedAmount === null) {
    return recorded.some((payment) => !payment.markPartial);
  }
  const sum = recorded.reduce((total, payment) => total + payment.amount, 0);
  return sum >= obligation.expectedAmount;
}

function advancedDueDate(
  obligation: ObligationSnapshot,
  payments: PaymentSnapshot[],
  periodDue: string,
): string | null {
  if (!periodSettled(obligation, payments, periodDue)) {
    return obligation.nextDueDate;
  }
  if (obligation.recurrence === 'custom' || obligation.recurrence === 'irregular') {
    return null;
  }
  if (obligation.dueDay === null || obligation.scheduleAnchor === null) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      error: 'schedule_incomplete',
      message: 'A recurring obligation needs dueDay and scheduleAnchor.',
    });
  }
  return periodAfter(obligation.scheduleAnchor, obligation.dueDay, obligation.recurrence, periodDue);
}

function earliestUnsettled(obligation: ObligationSnapshot, payments: PaymentSnapshot[]): string | null {
  const candidates = new Set<string>();
  for (const payment of payments) {
    candidates.add(payment.periodDueDate);
  }
  if (obligation.nextDueDate) {
    candidates.add(obligation.nextDueDate);
  }
  const unsettled = [...candidates]
    .filter((period) => !periodSettled(obligation, payments, period))
    .sort();
  return unsettled[0] ?? obligation.nextDueDate;
}
