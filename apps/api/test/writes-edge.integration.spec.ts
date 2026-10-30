import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateAuthJwtKeys, signAccessToken } from '../src/auth/access-jwt.js';
import { ACCESS_TOKEN_VERIFIER } from '../src/auth/access-token.verifier.js';
import { Es256AccessTokenVerifier } from '../src/auth/es256-access-token.verifier.js';
import { MemorySessionDirectory } from '../src/auth/session-directory.js';
import { AppModule } from '../src/app.module.js';
import {
  addCalendarDays,
  calendarDateInTimeZone,
  formatIsoDate,
  isPastDueDate,
  parseIsoDate,
} from '../src/common/property-calendar.js';
import { configureApp } from '../src/configure-app.js';
import { AVISO_TEXT } from '../src/consent/aviso-text.js';
import { duplicateWarningMessage } from '../src/payments/ledger.js';
import { redactedTextState } from '../src/ocr/audit-text.js';
import { AvisoVersionConflictError, publishAvisoVersion } from '../src/persistence/seed-data.js';
import { database } from '../src/persistence/database.js';

const enabled = Boolean(process.env.DATABASE_URL && process.env.DIRECT_URL);
const TZ = 'America/Mexico_City';

describe.skipIf(!enabled)('payment periods, void, and duplicates', () => {
  const jwt = generateAuthJwtKeys('writes-edge');
  const verifier = new Es256AccessTokenVerifier(jwt, new MemorySessionDirectory());
  const ownerId = randomUUID();
  const otherId = randomUUID();
  const viewerId = randomUUID();
  const avisoVersion = process.env.AVISO_VERSION?.trim() || '2026-10-21';
  const avisoUrl = process.env.AVISO_URL?.trim() || 'https://example.com/aviso';
  const tokens = new Map<string, string>();
  const extraIds: string[] = [];
  let app: INestApplication;
  let db: PrismaClient;
  let ownerDb: PrismaClient;
  let propertyId = '';
  let obligationId = '';
  const due = dueDates();

  beforeAll(async () => {
    for (const id of [ownerId, otherId, viewerId]) {
      tokens.set(id, signAccessToken(jwt, { sub: id, sid: randomUUID(), now: new Date() }));
    }
    ownerDb = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    db = new PrismaClient();
    try {
      await publishAvisoVersion(ownerDb, { version: avisoVersion, url: avisoUrl, text: AVISO_TEXT });
    } catch (error) {
      if (!(error instanceof AvisoVersionConflictError)) {
        throw error;
      }
    }
    await db.user.create({ data: { id: ownerId, trustSub: ownerId } });
    await db.consent.create({
      data: { id: randomUUID(), userId: ownerId, avisoVersion, acceptedAt: new Date() },
    });
    app = await boot(verifier);
    const created = await request(app.getHttpServer())
      .post('/v1/properties')
      .set(auth(tokens, ownerId))
      .set('Idempotency-Key', 'edge-casa')
      .send({ name: 'Casa', timezone: TZ });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    propertyId = created.body.id as string;
    const obligation = await request(app.getHttpServer())
      .post(`/v1/properties/${propertyId}/obligations`)
      .set(auth(tokens, ownerId))
      .set('Idempotency-Key', 'edge-cfe')
      .send({
        category: 'electricity',
        title: 'CFE',
        expectedAmount: '300.00',
        dueDay: 15,
        scheduleAnchor: due.anchor,
        nextDueDate: due.current,
      });
    expect(obligation.status, JSON.stringify(obligation.body)).toBe(201);
    obligationId = obligation.body.id as string;
    await db.user.create({ data: { id: viewerId, trustSub: viewerId } });
    await db.propertyMembership.create({
      data: { id: randomUUID(), propertyId, userId: viewerId, role: 'viewer', status: 'active' },
    });
  });

  afterAll(async () => {
    const ids = [ownerId, otherId, viewerId, ...extraIds];
    if (ownerDb) {
      await ownerDb.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('session_replication_role', 'replica', true)`;
        await tx.auditEvent.deleteMany({ where: { actorUserId: { in: ids } } });
        await tx.consent.deleteMany({ where: { userId: { in: ids } } });
        await tx.obligationPeriodOutcome.deleteMany({ where: { propertyId: { in: [propertyId, ...extraIds] } } });
        await tx.payment.deleteMany({ where: { propertyId: { in: [propertyId, ...extraIds] } } });
        await tx.idempotencyKey.deleteMany({ where: { userId: { in: ids } } });
        await tx.membershipInvite.deleteMany({ where: { propertyId: { in: [propertyId, ...extraIds] } } });
        await tx.obligation.deleteMany({ where: { propertyId: { in: [propertyId, ...extraIds] } } });
        await tx.propertyMembership.deleteMany({ where: { userId: { in: ids } } });
        const propertyIds = [propertyId, ...extraIds].filter((id) => id.length > 0);
        if (propertyIds.length > 0) {
          await tx.property.deleteMany({ where: { id: { in: propertyIds } } });
        }
        await tx.user.deleteMany({ where: { id: { in: ids } } });
      });
    }
    await app?.close();
    await ownerDb?.$disconnect();
    await db?.$disconnect();
    await database()?.$disconnect();
  });

  it('keeps a partial period in place and advances exactly one period when the sum is reached', async () => {
    const server = app.getHttpServer();
    const partial = await pay(server, 'partial-100', { amount: '100.00', periodDueDate: due.current });
    expect(partial.status, JSON.stringify(partial.body)).toBe(201);
    expect(partial.body.warnings).toEqual([]);
    expect(await nextDue()).toBe(due.current);
    expect(await outcome(due.current)).toMatchObject({ outcome: 'partial', overpaidAmount: 0n });

    const settled = await pay(server, 'settle-250', { amount: '250.00', periodDueDate: due.current });
    expect(settled.status).toBe(201);
    expect(await nextDue()).toBe(due.next);
    const paid = await outcome(due.current);
    expect(paid?.outcome).toBe('paid');
    expect(paid?.overpaidAmount).toBe(5000n);
    expect(await outcome(due.next)).toBeNull();
    expect((await db.obligation.findUnique({ where: { id: obligationId } }))?.expectedAmount).toBe(30000n);

    const extra = await pay(server, 'extra-10', { amount: '10.00', periodDueDate: due.current });
    expect(extra.status).toBe(201);
    expect(await nextDue()).toBe(due.next);
    expect((await outcome(due.current))?.overpaidAmount).toBe(6000n);
  });

  it('rejects markPartial when an expected amount is set, and uses it only when the amount is null', async () => {
    const server = app.getHttpServer();
    const rejected = await pay(server, 'mark-partial-rejected', {
      amount: '1.00',
      periodDueDate: due.current,
      markPartial: true,
    });
    expect(rejected.status).toBe(422);
    expect(rejected.body.error).toBe('mark_partial_invalid');

    const openEnded = await request(server)
      .post(`/v1/properties/${propertyId}/obligations`)
      .set(auth(tokens, ownerId))
      .set('Idempotency-Key', 'open-ended-obligation')
      .send({
        category: 'other',
        title: 'Variable',
        dueDay: 15,
        scheduleAnchor: due.anchor,
        nextDueDate: due.current,
      });
    expect(openEnded.status, JSON.stringify(openEnded.body)).toBe(201);
    const variableId = openEnded.body.id as string;
    const partial = await pay(server, 'variable-partial', {
      obligationId: variableId,
      amount: '20.00',
      periodDueDate: due.current,
      markPartial: true,
    });
    expect(partial.status, JSON.stringify(partial.body)).toBe(201);
    expect(await dueOf(variableId)).toBe(due.current);
    expect(await outcome(due.current, variableId)).toMatchObject({ outcome: 'partial', overpaidAmount: 0n });
    const full = await pay(server, 'variable-full', {
      obligationId: variableId,
      amount: '20.00',
      periodDueDate: due.current,
    });
    expect(full.status, JSON.stringify(full.body)).toBe(201);
    expect(await dueOf(variableId)).toBe(due.next);
  });

  it('voids once, rolls the period back, and refuses to un-void', async () => {
    const server = app.getHttpServer();
    const past = await request(server)
      .post(`/v1/properties/${propertyId}/obligations`)
      .set(auth(tokens, ownerId))
      .set('Idempotency-Key', 'past-obligation')
      .send({
        category: 'water',
        title: 'Agua',
        expectedAmount: '80.00',
        dueDay: 15,
        scheduleAnchor: due.pastAnchor,
        nextDueDate: due.past,
      });
    expect(past.status, JSON.stringify(past.body)).toBe(201);
    const pastId = past.body.id as string;
    const paidAt = '2026-09-15T18:00:00.000Z';
    const created = await pay(server, 'past-pay', {
      obligationId: pastId,
      amount: '80.00',
      periodDueDate: due.past,
      paidAt,
    });
    expect(created.status).toBe(201);
    const paymentId = created.body.payment.id as string;
    expect(await dueOf(pastId)).not.toBe(due.past);

    const missing = await request(server).post(`/v1/properties/${propertyId}/payments/${paymentId}/void`);
    expect(missing.status).toBe(401);
    const blank = await voidPayment(server, paymentId, 'void-blank', { voidReason: '   ' });
    expect(blank.status).toBe(422);
    expect(blank.body.error).toBe('void_reason_invalid');
    const long = await voidPayment(server, paymentId, 'void-long', { voidReason: 'a'.repeat(501) });
    expect(long.status).toBe(422);

    const outsider = await voidPayment(server, paymentId, 'void-outsider', { voidReason: 'No' }, otherId);
    expect(outsider.status).toBe(404);
    expect(outsider.body.error).toBe('not_found');
    const viewer = await voidPayment(server, paymentId, 'void-viewer', { voidReason: 'No' }, viewerId);
    expect(viewer.status).toBe(403);

    const createKey = 'past-pay';
    const sameKey = await voidPayment(server, paymentId, createKey, { voidReason: 'Captura duplicada' });
    expect(sameKey.status, JSON.stringify(sameKey.body)).toBe(200);
    expect(sameKey.body.status).toBe('voided');
    expect(sameKey.body.voidReason).toBe('Captura duplicada');
    const replayedCreate = await pay(server, createKey, {
      obligationId: pastId,
      amount: '80.00',
      periodDueDate: due.past,
      paidAt,
    });
    expect(replayedCreate.status).toBe(201);
    expect(await db.payment.count({ where: { obligationId: pastId } })).toBe(1);
    expect((await db.payment.findUnique({ where: { id: paymentId } }))?.status).toBe('voided');

    const again = await voidPayment(server, paymentId, 'void-again', { voidReason: 'Otra vez' });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('already_voided');
    const stored = await db.payment.findUnique({ where: { id: paymentId } });
    expect(stored?.voidReason).toBe('Captura duplicada');
    expect(stored?.voidedByUserId).toBe(ownerId);
    const replay = await voidPayment(server, paymentId, createKey, { voidReason: 'Captura duplicada' });
    expect(replay.status).toBe(200);
    expect(replay.body.voidedAt).toBe(stored?.voidedAt?.toISOString());

    expect(await outcome(due.past, pastId)).toBeNull();
    expect(await dueOf(pastId)).toBe(due.past);
    expect(isPastDueDate(due.past, new Date(), TZ)).toBe(true);

    const undone = await request(server)
      .patch(`/v1/properties/${propertyId}/payments/${paymentId}`)
      .set(auth(tokens, ownerId))
      .set('Idempotency-Key', 'unvoid-attempt')
      .send({ status: 'recorded' });
    expect(undone.status).toBe(409);
    expect(undone.body.error).toBe('payment_voided');
    const noted = await request(server)
      .patch(`/v1/properties/${propertyId}/payments/${paymentId}`)
      .set(auth(tokens, ownerId))
      .set('Idempotency-Key', 'unvoid-notes')
      .send({ notes: 'Cambiar la nota' });
    const amount = await request(server)
      .patch(`/v1/properties/${propertyId}/payments/${paymentId}`)
      .set(auth(tokens, ownerId))
      .set('Idempotency-Key', 'unvoid-amount')
      .send({ amount: '1.00' });
    expect(noted.status).toBe(409);
    expect(amount.status).toBe(409);
    expect(noted.body.error).toBe('payment_voided');
    expect(amount.body.error).toBe('payment_voided');
    const replayNotes = await request(server)
      .patch(`/v1/properties/${propertyId}/payments/${paymentId}`)
      .set(auth(tokens, ownerId))
      .set('Idempotency-Key', 'unvoid-notes')
      .send({ notes: 'Cambiar la nota' });
    expect(replayNotes.status).toBe(409);
    expect(replayNotes.body).toEqual(noted.body);
    const row = await db.payment.findUnique({ where: { id: paymentId } });
    expect(row?.status).toBe('voided');
    expect(row?.voidReason).toBe('Captura duplicada');
    expect(row?.notes).toBeNull();
    expect(row?.amount).toBe(8000n);
    expect(await db.auditEvent.count({ where: { entityId: paymentId, action: 'payment.updated' } })).toBe(0);
    const audit = await db.auditEvent.findFirst({ where: { entityId: paymentId, action: 'payment.voided' } });
    expect(audit?.afterState).toEqual(redactedTextState('Captura duplicada'));
    expect(JSON.stringify(audit)).not.toContain('Captura duplicada');
  });

  it('does not apply an edit that loses the race with a void', async () => {
    const server = app.getHttpServer();
    const pairs = 25;
    const paymentIds: string[] = [];
    for (let index = 0; index < pairs; index += 1) {
      const created = await pay(server, `race-create-${index}-${randomUUID()}`, {
        amount: '10.00',
        periodDueDate: due.current,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      paymentIds.push(created.body.payment.id as string);
    }
    const results = await Promise.all(
      paymentIds.map(async (paymentId, index) => {
        const note = `nota-${index}`;
        const [edit, voided] = await Promise.all([
          request(server)
            .patch(`/v1/properties/${propertyId}/payments/${paymentId}`)
            .set(auth(tokens, ownerId))
            .set('Idempotency-Key', `race-edit-${index}-${randomUUID()}`)
            .send({ notes: note }),
          voidPayment(server, paymentId, `race-void-${index}-${randomUUID()}`, { voidReason: `carrera ${index}` }),
        ]);
        return { paymentId, note, edit, voided };
      }),
    );
    for (const { paymentId, note, edit, voided } of results) {
      expect(voided.status, JSON.stringify(voided.body)).toBe(200);
      expect([200, 409]).toContain(edit.status);
      const row = await db.payment.findUnique({ where: { id: paymentId } });
      expect(row?.status).toBe('voided');
      if (edit.status === 409) {
        expect(edit.body).toMatchObject({
          statusCode: 409,
          error: 'payment_voided',
          message: 'A voided payment cannot be changed.',
        });
        expect(row?.notes).toBeNull();
        expect(await db.auditEvent.count({ where: { entityId: paymentId, action: 'payment.updated' } })).toBe(0);
      } else {
        expect(row?.notes).toBe(note);
        const updated = await db.auditEvent.findFirst({ where: { entityId: paymentId, action: 'payment.updated' } });
        const voidAudit = await db.auditEvent.findFirst({ where: { entityId: paymentId, action: 'payment.voided' } });
        expect(updated?.createdAt.getTime()).toBeLessThanOrEqual(voidAudit?.createdAt.getTime() ?? 0);
      }
    }
  }, 60_000);

  it('returns the same 404 for a foreign obligation and a foreign void', async () => {
    const server = app.getHttpServer();
    const other = await request(server)
      .post('/v1/properties')
      .set(auth(tokens, ownerId))
      .set('Idempotency-Key', `idor-home-${randomUUID()}`)
      .send({ name: 'Otra casa', timezone: TZ });
    expect(other.status, JSON.stringify(other.body)).toBe(201);
    const otherPropertyId = other.body.id as string;
    extraIds.push(otherPropertyId);
    const obligation = await request(server)
      .post(`/v1/properties/${otherPropertyId}/obligations`)
      .set(auth(tokens, ownerId))
      .set('Idempotency-Key', `idor-obligation-${randomUUID()}`)
      .send({
        category: 'other',
        title: 'Ajena',
        expectedAmount: '10.00',
        dueDay: 15,
        scheduleAnchor: due.anchor,
        nextDueDate: due.current,
      });
    expect(obligation.status, JSON.stringify(obligation.body)).toBe(201);
    const foreignObligationId = obligation.body.id as string;
    const hiddenPayment = await pay(server, `idor-pay-${randomUUID()}`, {
      obligationId: foreignObligationId,
      amount: '10.00',
      periodDueDate: due.current,
    });
    const foreignPayment = await request(server)
      .post(`/v1/properties/${otherPropertyId}/payments`)
      .set(auth(tokens, ownerId))
      .set('Idempotency-Key', `idor-foreign-pay-${randomUUID()}`)
      .send({
        obligationId: foreignObligationId,
        amount: '10.00',
        paidAt: new Date().toISOString(),
        periodDueDate: due.current,
      });
    expect(foreignPayment.status, JSON.stringify(foreignPayment.body)).toBe(201);
    const hiddenVoid = await request(server)
      .post(`/v1/properties/${propertyId}/payments/${foreignPayment.body.payment.id as string}/void`)
      .set(auth(tokens, ownerId))
      .set('Idempotency-Key', `idor-void-${randomUUID()}`)
      .send({ voidReason: 'No es de esta casa' });
    const notFound = { statusCode: 404, error: 'not_found', message: 'Not found.' };
    expect(hiddenPayment.status).toBe(404);
    expect(hiddenVoid.status).toBe(404);
    expect(hiddenPayment.body).toEqual(notFound);
    expect(hiddenVoid.body).toEqual(hiddenPayment.body);
  });

  it('warns about a near duplicate and does not warn again on replay', async () => {
    const server = app.getHttpServer();
    const firstPaid = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const secondPaid = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const first = await pay(server, 'dup-first', {
      amount: '40.00',
      periodDueDate: due.current,
      paidAt: firstPaid.toISOString(),
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.warnings).toEqual([]);
    const second = await pay(server, 'dup-second', {
      amount: '40.00',
      periodDueDate: due.current,
      paidAt: secondPaid.toISOString(),
    });
    expect(second.status).toBe(201);
    const on = calendarDateInTimeZone(firstPaid, TZ);
    expect(second.body.warnings).toEqual([
      { code: 'possible_duplicate', message: duplicateWarningMessage(4000, on) },
    ]);
    const replay = await pay(server, 'dup-second', {
      amount: '40.00',
      periodDueDate: due.current,
      paidAt: secondPaid.toISOString(),
    });
    expect(replay.status).toBe(201);
    expect(replay.body.warnings).toEqual(second.body.warnings);
    expect(await db.payment.count({ where: { obligationId, amount: 4000n, status: 'recorded' } })).toBe(2);
    const voidedMatch = await voidPayment(server, first.body.payment.id as string, `dup-void-${randomUUID()}`, {
      voidReason: 'No era el pago',
    });
    expect(voidedMatch.status).toBe(200);
    const afterVoid = await pay(server, 'dup-second', {
      amount: '40.00',
      periodDueDate: due.current,
      paidAt: secondPaid.toISOString(),
    });
    expect(afterVoid.status).toBe(201);
    expect(afterVoid.body).toEqual(second.body);
    expect(await db.payment.count({ where: { idempotencyKey: 'dup-second' } })).toBe(1);
    const far = await pay(server, 'dup-far-pay', {
      amount: '40.00',
      periodDueDate: due.current,
      paidAt: new Date(firstPaid.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(far.body.warnings).toEqual([]);
  });

  it('rejects paidAt outside the one-year-plus-one-day window', async () => {
    const server = app.getHttpServer();
    const late = await pay(server, 'paid-late', {
      amount: '1.00',
      periodDueDate: due.current,
      paidAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(late.status).toBe(422);
    expect(late.body.error).toBe('paid_at_out_of_range');
    const early = await pay(server, 'paid-early', {
      amount: '1.00',
      periodDueDate: due.current,
      paidAt: new Date(Date.now() - 370 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(early.status).toBe(422);
    expect(early.body.error).toBe('paid_at_out_of_range');
  });

  it('lets two members reuse one key and rejects that key after the store row expires', async () => {
    const server = app.getHttpServer();
    const memberId = randomUUID();
    extraIds.push(memberId);
    await db.user.create({ data: { id: memberId, trustSub: memberId } });
    await db.consent.create({
      data: { id: randomUUID(), userId: memberId, avisoVersion, acceptedAt: new Date() },
    });
    await db.propertyMembership.create({
      data: { id: randomUUID(), propertyId, userId: memberId, role: 'member', status: 'active' },
    });
    tokens.set(memberId, signAccessToken(jwt, { sub: memberId, sid: randomUUID(), now: new Date() }));
    const body = { obligationId, amount: '15.00', periodDueDate: due.current, paidAt: new Date().toISOString() };
    const first = await request(server)
      .post(`/v1/properties/${propertyId}/payments`)
      .set(auth(tokens, ownerId))
      .set('Idempotency-Key', 'shared-member-key')
      .send(body);
    const second = await request(server)
      .post(`/v1/properties/${propertyId}/payments`)
      .set(auth(tokens, memberId))
      .set('Idempotency-Key', 'shared-member-key')
      .send(body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect(first.body.payment.id).not.toBe(second.body.payment.id);
    const ownerReplay = await request(server)
      .post(`/v1/properties/${propertyId}/payments`)
      .set(auth(tokens, ownerId))
      .set('Idempotency-Key', 'shared-member-key')
      .send(body);
    expect(ownerReplay.status).toBe(201);
    expect(ownerReplay.body.payment.id).toBe(first.body.payment.id);
    expect(ownerReplay.body.payment.id).not.toBe(second.body.payment.id);

    const expiring = await pay(server, 'expire-this-key', {
      amount: '16.00',
      periodDueDate: due.current,
      paidAt: new Date().toISOString(),
    });
    expect(expiring.status, JSON.stringify(expiring.body)).toBe(201);
    await db.idempotencyKey.updateMany({
      where: { userId: ownerId, key: 'expire-this-key' },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const afterExpiry = await pay(server, 'expire-this-key', {
      amount: '16.00',
      periodDueDate: due.current,
      paidAt: expiring.body.payment.paidAt,
    });
    expect(afterExpiry.status, JSON.stringify(afterExpiry.body)).toBe(409);
    expect(afterExpiry.body.error).toBe('idempotency_key_reused');
    expect(await db.payment.count({ where: { idempotencyKey: 'expire-this-key' } })).toBe(1);

    const hidden = await request(server)
      .patch(`/v1/properties/${propertyId}`)
      .set(auth(tokens, otherId))
      .set('Idempotency-Key', 'idor-property')
      .send({ name: 'Ajena' });
    const hiddenObligation = await request(server)
      .patch(`/v1/properties/${propertyId}/obligations/${obligationId}`)
      .set(auth(tokens, otherId))
      .set('Idempotency-Key', 'idor-obligation')
      .send({ title: 'Ajena' });
    const hiddenPayment = await request(server)
      .patch(`/v1/properties/${propertyId}/payments/${first.body.payment.id as string}`)
      .set(auth(tokens, otherId))
      .set('Idempotency-Key', 'idor-payment')
      .send({ notes: 'Ajena' });
    expect(hidden.status).toBe(404);
    expect(hiddenObligation.status).toBe(404);
    expect(hiddenPayment.status).toBe(404);
    expect(JSON.stringify(hidden.body)).not.toContain('Ajena');
  });

  it('rejects a bad timezone, an oversized body, and whitespace in an aviso version', async () => {
    const server = app.getHttpServer();
    const zone = await request(server)
      .post('/v1/properties')
      .set(auth(tokens, ownerId))
      .set('Idempotency-Key', 'bad-zone')
      .send({ name: 'Casa', timezone: 'Not/AZone' });
    expect(zone.status).toBe(422);
    expect(zone.body.error).toBe('invalid_timezone');
    const oversized = await request(server)
      .post('/v1/properties')
      .set(auth(tokens, ownerId))
      .set('Content-Type', 'application/json')
      .send(`{"name":"${'a'.repeat(40_000)}"}`);
    expect(oversized.status).toBe(413);
    const text = '   ';
    const version = `blank-${randomUUID()}`;
    await expect(
      ownerDb.avisoVersion.create({
        data: {
          version,
          url: 'https://example.com/aviso',
          text,
          textSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
        },
      }),
    ).rejects.toThrow(/aviso_versions_text_not_blank/);
  });

  function pay(server: Parameters<typeof request>[0], key: string, body: Record<string, unknown>) {
    return request(server)
      .post(`/v1/properties/${propertyId}/payments`)
      .set(auth(tokens, ownerId))
      .set('Idempotency-Key', key)
      .send({
        obligationId,
        paidAt: new Date().toISOString(),
        ...body,
      });
  }

  function voidPayment(
    server: Parameters<typeof request>[0],
    paymentId: string,
    key: string,
    body: Record<string, unknown>,
    userId = ownerId,
  ) {
    return request(server)
      .post(`/v1/properties/${propertyId}/payments/${paymentId}/void`)
      .set(auth(tokens, userId))
      .set('Idempotency-Key', key)
      .send(body);
  }

  async function nextDue(): Promise<string | null> {
    const row = await db.obligation.findUnique({ where: { id: obligationId } });
    return row?.nextDueDate ? row.nextDueDate.toISOString().slice(0, 10) : null;
  }

  async function dueOf(id: string): Promise<string | null> {
    const row = await db.obligation.findUnique({ where: { id } });
    return row?.nextDueDate ? row.nextDueDate.toISOString().slice(0, 10) : null;
  }

  async function outcome(period: string, id = obligationId) {
    return db.obligationPeriodOutcome.findUnique({
      where: { obligationId_periodDueDate: { obligationId: id, periodDueDate: new Date(`${period}T00:00:00.000Z`) } },
    });
  }
});

function dueDates(): { anchor: string; current: string; next: string; afterNext: string; past: string; pastAnchor: string } {
  const today = calendarDateInTimeZone(new Date(), TZ);
  const parts = parseIsoDate(today);
  if (!parts) {
    throw new Error('today is not a calendar date');
  }
  let month = parts.month + 1;
  let year = parts.year;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  const current = formatIsoDate(year, month, 15);
  const nextParts = parseIsoDate(addCalendarDays(current, 32));
  if (!nextParts) {
    throw new Error('next due date is invalid');
  }
  const next = formatIsoDate(nextParts.year, nextParts.month, 15);
  const afterParts = parseIsoDate(addCalendarDays(next, 32));
  if (!afterParts) {
    throw new Error('following due date is invalid');
  }
  let pastMonth = parts.month - 2;
  let pastYear = parts.year;
  if (pastMonth < 1) {
    pastMonth += 12;
    pastYear -= 1;
  }
  return {
    anchor: formatIsoDate(year, month, 1),
    current,
    next,
    afterNext: formatIsoDate(afterParts.year, afterParts.month, 15),
    past: formatIsoDate(pastYear, pastMonth, 15),
    pastAnchor: formatIsoDate(pastYear, pastMonth, 1),
  };
}

function auth(tokens: Map<string, string>, userId: string): { Authorization: string } {
  return { Authorization: `Bearer ${tokens.get(userId) ?? ''}` };
}

async function boot(verifier: Es256AccessTokenVerifier): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ACCESS_TOKEN_VERIFIER)
    .useValue(verifier)
    .compile();
  const application = moduleRef.createNestApplication({ bodyParser: false, logger: false });
  configureApp(application);
  await application.init();
  return application;
}
