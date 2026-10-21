import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { duplicateWarningMessage, recordPayment, voidPayment, type ObligationSnapshot } from './ledger.js';
import { MemoryLedger } from './memory-ledger.js';

const OBLIGATION = '33333333-3333-4333-8333-333333333333';
const PROPERTY = '11111111-1111-4111-8111-111111111111';
const ACTOR = '00000000-0000-4000-8000-000000000001';

function obligation(overrides: Partial<ObligationSnapshot> = {}): ObligationSnapshot {
  return {
    id: OBLIGATION,
    propertyId: PROPERTY,
    recurrence: 'monthly',
    dueDay: 31,
    scheduleAnchor: '2026-01-01',
    nextDueDate: '2026-01-31',
    expectedAmount: 10000,
    currency: 'MXN',
    ...overrides,
  };
}

describe('payment ledger', () => {
  it('advances a full payment from the anchor and moves a void back', async () => {
    const ledger = MemoryLedger.create([obligation()]);
    const paid = await recordPayment(ledger, {
      id: '44444444-4444-4444-8444-111111111111',
      obligationId: OBLIGATION,
      amountCentavos: 10000,
      paidAt: new Date('2026-01-31T18:00:00.000Z'),
      timeZone: 'America/Mexico_City',
      actorUserId: ACTOR,
    });
    expect(paid.nextDueDate).toBe('2026-02-28');
    expect(paid.warnings).toEqual([]);
    const voided = await voidPayment(ledger, {
      paymentId: paid.payment.id,
      actorUserId: ACTOR,
      reason: 'Captura duplicada',
      now: new Date('2026-02-01T18:00:00.000Z'),
    });
    expect(voided.status).toBe('voided');
    expect(ledger.obligation(OBLIGATION)?.nextDueDate).toBe('2026-01-31');
    await expect(
      voidPayment(ledger, {
        paymentId: paid.payment.id,
        actorUserId: ACTOR,
        reason: 'Otra vez',
        now: new Date('2026-02-02T18:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ledger.payment(paid.payment.id)).toMatchObject({
      voidedAt: voided.voidedAt,
      voidedByUserId: ACTOR,
      voidReason: 'Captura duplicada',
    });
  });

  it('does not advance a partial payment and warns on a near duplicate', async () => {
    const ledger = MemoryLedger.create([
      obligation({ dueDay: 15, scheduleAnchor: '2026-03-01', nextDueDate: '2026-03-15', expectedAmount: 300000 }),
    ]);
    const first = await recordPayment(ledger, {
      id: '44444444-4444-4444-8444-222222222222',
      obligationId: OBLIGATION,
      amountCentavos: 123450,
      paidAt: new Date('2026-03-03T18:00:00.000Z'),
      timeZone: 'America/Mexico_City',
      actorUserId: ACTOR,
      periodDueDate: '2026-03-15',
    });
    expect(first.nextDueDate).toBe('2026-03-15');
    const second = await recordPayment(ledger, {
      id: '44444444-4444-4444-8444-333333333333',
      obligationId: OBLIGATION,
      amountCentavos: 123450,
      paidAt: new Date('2026-03-04T05:30:00.000Z'),
      timeZone: 'America/Mexico_City',
      actorUserId: ACTOR,
      periodDueDate: '2026-03-15',
      createdAt: new Date('2026-03-04T05:30:00.000Z'),
    });
    expect(second.warnings).toEqual([
      {
        code: 'possible_duplicate',
        message: duplicateWarningMessage(123450, '2026-03-03'),
      },
    ]);
    expect(second.warnings[0]?.message).toBe(
      'Ya registraste un pago de $1,234.50 el 3 de marzo de 2026. ¿Registrar otro?',
    );
    expect(ledger.obligation(OBLIGATION)?.nextDueDate).toBe('2026-03-15');
  });

  it('skips the warning four days away, for a void, and for a different amount', async () => {
    const ledger = MemoryLedger.create([
      obligation({ dueDay: 15, scheduleAnchor: '2026-03-01', nextDueDate: '2026-03-15', expectedAmount: null }),
    ]);
    await recordPayment(ledger, {
      id: '44444444-4444-4444-8444-222222222222',
      obligationId: OBLIGATION,
      amountCentavos: 123450,
      paidAt: new Date('2026-03-03T06:00:00.000Z'),
      timeZone: 'America/Mexico_City',
      actorUserId: ACTOR,
    });
    await voidPayment(ledger, {
      paymentId: '44444444-4444-4444-8444-222222222222',
      actorUserId: ACTOR,
      reason: 'Anulado',
      now: new Date('2026-03-03T12:00:00.000Z'),
    });
    const afterVoid = await recordPayment(ledger, {
      id: '44444444-4444-4444-8444-333333333333',
      obligationId: OBLIGATION,
      amountCentavos: 123450,
      paidAt: new Date('2026-03-03T18:00:00.000Z'),
      timeZone: 'America/Mexico_City',
      actorUserId: ACTOR,
    });
    expect(afterVoid.warnings).toEqual([]);
    const different = await recordPayment(ledger, {
      id: '44444444-4444-4444-8444-444444444444',
      obligationId: OBLIGATION,
      amountCentavos: 100,
      paidAt: new Date('2026-03-07T06:00:00.000Z'),
      timeZone: 'America/Mexico_City',
      actorUserId: ACTOR,
      periodDueDate: '2026-03-15',
    });
    expect(different.warnings).toEqual([]);
    const fourDays = await recordPayment(ledger, {
      id: '44444444-4444-4444-8444-555555555555',
      obligationId: OBLIGATION,
      amountCentavos: 123450,
      paidAt: new Date('2026-03-07T06:00:00.000Z'),
      timeZone: 'America/Mexico_City',
      actorUserId: ACTOR,
      periodDueDate: '2026-03-15',
    });
    expect(fourDays.warnings).toEqual([]);
  });

  it('rejects a non-positive amount and a bad void reason without writing', async () => {
    const ledger = MemoryLedger.create([obligation()]);
    await expect(
      recordPayment(ledger, {
        id: '44444444-4444-4444-8444-111111111111',
        obligationId: OBLIGATION,
        amountCentavos: 0,
        paidAt: new Date('2026-01-31T18:00:00.000Z'),
        timeZone: 'America/Mexico_City',
        actorUserId: ACTOR,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    const paid = await recordPayment(ledger, {
      id: '44444444-4444-4444-8444-111111111111',
      obligationId: OBLIGATION,
      amountCentavos: 10000,
      paidAt: new Date('2026-01-31T18:00:00.000Z'),
      timeZone: 'America/Mexico_City',
      actorUserId: ACTOR,
    });
    await expect(
      voidPayment(ledger, { paymentId: paid.payment.id, actorUserId: ACTOR, reason: '   ', now: new Date() }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(ledger.payment(paid.payment.id)?.status).toBe('recorded');
  });

  it('rolls the obligation date back when the transaction throws', async () => {
    const ledger = MemoryLedger.create([obligation()]);
    await expect(
      ledger.transaction(async (tx) => {
        await tx.saveNextDueDate(OBLIGATION, '2026-02-28');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(ledger.obligation(OBLIGATION)?.nextDueDate).toBe('2026-01-31');
  });

  it('sets nextDueDate null when a custom period is paid', async () => {
    const ledger = MemoryLedger.create([
      obligation({ recurrence: 'custom', dueDay: null, scheduleAnchor: null, nextDueDate: '2026-03-15' }),
    ]);
    const paid = await recordPayment(ledger, {
      id: '44444444-4444-4444-8444-111111111111',
      obligationId: OBLIGATION,
      amountCentavos: 10000,
      paidAt: new Date('2026-03-15T18:00:00.000Z'),
      timeZone: 'America/Mexico_City',
      actorUserId: ACTOR,
    });
    expect(paid.nextDueDate).toBeNull();
  });
});
