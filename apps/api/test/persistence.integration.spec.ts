import { randomUUID } from 'node:crypto';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaIdempotencyKeys } from '../src/auth/idempotency-keys.js';
import { PrismaRateLimits, bucketKey } from '../src/auth/rate-limit.js';
import { PrismaRefreshTokens } from '../src/auth/prisma-refresh-tokens.js';
import { PrismaConsentRepository } from '../src/consent/prisma-consent.repository.js';
import { ConsentService } from '../src/consent/consent.service.js';
import type { ConsentAuditEntry, ConsentAuditLog } from '../src/consent/consent.repository.js';
import type { OcrExtractor } from '../src/ocr/ocr-extractor.js';
import { OcrService } from '../src/ocr/ocr.service.js';
import type { OcrTargetLookup } from '../src/ocr/ocr-target-lookup.js';
import { PrismaOcrFieldStore } from '../src/persistence/prisma-ocr-field-store.js';
import { seedDatabase, DEMO_OBLIGATION_ID, DEMO_USER_ID } from '../src/persistence/seed-data.js';
import { PrismaLedger } from '../src/persistence/prisma-ledger.js';
import { recordPayment, voidPayment } from '../src/payments/ledger.js';

const enabled = Boolean(process.env.DATABASE_URL && process.env.DIRECT_URL);

describe.skipIf(!enabled)('persistence against Postgres', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('has no storage_key column', async () => {
    const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'storage_key'
    `;
    expect(rows).toEqual([]);
    const sourceKeys = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'source_key'
      ORDER BY table_name
    `;
    expect(sourceKeys.map((row) => row.table_name)).toEqual(['documents', 'evidence', 'ocr_jobs']);
  });

  it('rejects amount 0, a nextDueDate outside 1990–2100, and a void without a reason', async () => {
    const fixture = await createFixture(prisma);
    try {
      const paymentId = randomUUID();
      await expect(
        prisma.payment.create({
          data: {
            id: paymentId,
            propertyId: fixture.propertyId,
            obligationId: fixture.obligationId,
            periodDueDate: new Date('2026-03-15T00:00:00.000Z'),
            recordedByUserId: fixture.userId,
            amount: 0,
            currency: 'MXN',
            paidAt: new Date('2026-03-03T18:00:00.000Z'),
            status: 'recorded',
            idempotencyKey: paymentId,
          },
        }),
      ).rejects.toThrow(/payments_amount_positive/);

      await expect(
        prisma.$executeRaw`
          UPDATE obligations
          SET next_due_date = DATE '1989-12-31'
          WHERE id = CAST(${fixture.obligationId} AS uuid)
        `,
      ).rejects.toThrow(/obligations_next_due_date_sanity/);
      await expect(
        prisma.$executeRaw`
          UPDATE obligations
          SET next_due_date = DATE '2101-01-01'
          WHERE id = CAST(${fixture.obligationId} AS uuid)
        `,
      ).rejects.toThrow(/obligations_next_due_date_sanity/);

      const recordedId = randomUUID();
      await prisma.$executeRaw`
        INSERT INTO payments (
          id, property_id, obligation_id, period_due_date, recorded_by_user_id,
          amount, currency, paid_at, status, idempotency_key, created_at, updated_at
        ) VALUES (
          CAST(${recordedId} AS uuid),
          CAST(${fixture.propertyId} AS uuid),
          CAST(${fixture.obligationId} AS uuid),
          DATE '2026-03-15',
          CAST(${fixture.userId} AS uuid),
          10000,
          'MXN',
          TIMESTAMPTZ '2026-03-03 18:00:00+00',
          'recorded',
          ${recordedId},
          NOW(),
          NOW()
        )
      `;
      await expect(
        prisma.$executeRaw`
          UPDATE payments
          SET status = 'voided', voided_at = TIMESTAMPTZ '2026-03-04 18:00:00+00',
              voided_by = CAST(${fixture.userId} AS uuid), void_reason = NULL
          WHERE id = CAST(${recordedId} AS uuid)
        `,
      ).rejects.toThrow(/payments_void_fields_match_status/);
      const stillRecorded = await prisma.payment.findUnique({ where: { id: recordedId } });
      expect(stillRecorded?.status).toBe('recorded');
      expect(stillRecorded?.voidReason).toBeNull();
    } finally {
      await deleteFixture(prisma, fixture);
    }
  });

  it('rolls a confirm back when the second save fails and leaves suggestions pending', async () => {
    const fixture = await createFixture(prisma);
    try {
      const store = new PrismaOcrFieldStore(prisma);
      let saves = 0;
      const lookup: OcrTargetLookup = {
        belongsToProperty: (input) => store.belongsToProperty(input),
        timeZone: (propertyId) => store.timeZone(propertyId),
        savedValue: (input) => store.savedValue(input),
        saveValue: async (input, value) => {
          saves += 1;
          if (saves >= 2) {
            throw new Error('second write failed');
          }
          await store.saveValue(input, value);
        },
        runInTransaction: (work) => store.runInTransaction(work),
        appendAudit: (event) => store.appendAudit(event),
      };
      const service = new OcrService(
        { enabled: true, jobsMax: 10, jobTtlMs: 60_000 },
        lookup,
        undefined,
        twoFields('CFE', 'nota'),
      );
      const { job } = service.enqueue(fixture.propertyId, randomUUID());
      const suggestions = service.getJob(fixture.propertyId, job.id).suggestions;
      await expect(
        service.confirm(fixture.propertyId, job.id, {
          decisions: suggestions.map((row) => ({
            suggestionId: row.id,
            action: 'accept',
            targetEntityId: fixture.obligationId,
          })),
        }),
      ).rejects.toThrow(/second write failed/);
      const after = service.getJob(fixture.propertyId, job.id);
      expect(after.job.status).toBe('suggested');
      expect(after.suggestions.every((row) => row.applyStatus === 'pending')).toBe(true);
      const obligation = await prisma.obligation.findUnique({ where: { id: fixture.obligationId } });
      expect(obligation?.providerName).toBeNull();
      expect(obligation?.notes).toBeNull();
    } finally {
      await deleteFixture(prisma, fixture);
    }
  });

  it('persists a saved replace audit on audit_events', async () => {
    const fixture = await createFixture(prisma);
    try {
      await prisma.obligation.update({
        where: { id: fixture.obligationId },
        data: { providerName: 'Antes' },
      });
      const store = new PrismaOcrFieldStore(prisma);
      const service = new OcrService(
        { enabled: true, jobsMax: 10, jobTtlMs: 60_000 },
        store,
        undefined,
        oneField('providerName', 'CFE Norte'),
      );
      const { job } = service.enqueue(fixture.propertyId, randomUUID());
      const suggestion = service.getJob(fixture.propertyId, job.id).suggestions[0];
      expect(suggestion).toBeDefined();
      const confirmed = await service.confirm(
        fixture.propertyId,
        job.id,
        {
          decisions: [
            {
              suggestionId: suggestion!.id,
              action: 'replace',
              editedValue: 'CFE Norte',
              targetEntityId: fixture.obligationId,
            },
          ],
        },
        { actorUserId: fixture.userId },
      );
      expect(confirmed.persisted).toBe(true);
      expect(confirmed.suggestions[0]?.applyStatus).toBe('accepted');
      const obligation = await prisma.obligation.findUnique({ where: { id: fixture.obligationId } });
      expect(obligation?.providerName).toBe('CFE Norte');
      const audit = await prisma.auditEvent.findFirst({
        where: { propertyId: fixture.propertyId, action: 'ocr.replace' },
      });
      expect(audit?.entityType).toBe('obligation');
      expect(audit?.entityId).toBe(fixture.obligationId);
      expect(audit?.actorUserId).toBe(fixture.userId);
      expect(audit?.metadata).toMatchObject({
        suggestionId: suggestion!.id,
        field: 'providerName',
        action: 'replace',
        actorUserId: fixture.userId,
        previousValue: 'Antes',
        newValue: 'CFE Norte',
      });
    } finally {
      await deleteFixture(prisma, fixture);
    }
  });

  it('lets one void win and leaves that void unchanged', async () => {
    const fixture = await createFixture(prisma);
    try {
      const paymentId = randomUUID();
      await recordPayment(new PrismaLedger(prisma), {
        id: paymentId,
        obligationId: fixture.obligationId,
        amountCentavos: 10000,
        paidAt: new Date('2026-03-03T18:00:00.000Z'),
        timeZone: 'America/Mexico_City',
        actorUserId: fixture.userId,
        periodDueDate: '2026-03-15',
      });
      const attempts = await Promise.allSettled([
        voidPayment(new PrismaLedger(prisma), {
          paymentId,
          actorUserId: fixture.userId,
          reason: 'Primera',
          now: new Date('2026-04-01T18:00:00.000Z'),
        }),
        voidPayment(new PrismaLedger(prisma), {
          paymentId,
          actorUserId: fixture.userId,
          reason: 'Segunda',
          now: new Date('2026-04-02T18:00:00.000Z'),
        }),
      ]);
      const won = attempts.filter((result) => result.status === 'fulfilled');
      const lost = attempts.filter((result) => result.status === 'rejected');
      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(1);
      const error = (lost[0] as PromiseRejectedResult).reason as ConflictException;
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toMatchObject({ statusCode: 409, error: 'already_voided' });
      const stored = await prisma.payment.findUnique({ where: { id: paymentId } });
      const winner = won[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof voidPayment>>>;
      expect(stored?.voidReason).toBe(winner.value.voidReason);
      expect(stored?.voidedAt?.toISOString()).toBe(winner.value.voidedAt?.toISOString());
      expect(stored?.voidedByUserId).toBe(fixture.userId);
      expect(stored?.status).toBe('voided');
    } finally {
      await deleteFixture(prisma, fixture);
    }
  });

  it('keeps one consent row under concurrent accepts and rejects updates', async () => {
    const fixture = await createFixture(prisma);
    const version = `aviso-${randomUUID()}`;
    try {
      await prisma.avisoVersion.create({
        data: {
          version,
          url: 'https://example.com/aviso',
          textSha256: 'a'.repeat(64),
        },
      });
      const service = new ConsentService(
        new PrismaConsentRepository(prisma),
        new PrismaConsentAudit(prisma),
        () => ({ avisoVersion: version, avisoUrl: 'https://example.com/aviso' }),
        { now: () => new Date() },
      );
      const [left, right] = await Promise.all([
        service.recordConsent({ userId: fixture.userId, avisoVersion: version, appVersion: '1.0.0' }),
        service.recordConsent({ userId: fixture.userId, avisoVersion: version, appVersion: '2.0.0' }),
      ]);
      expect(left.consent.id).toBe(right.consent.id);
      expect(left.consent.acceptedAt.toISOString()).toBe(right.consent.acceptedAt.toISOString());
      expect(await prisma.consent.count({ where: { userId: fixture.userId, avisoVersion: version } })).toBe(1);
      const repeat = await service.recordConsent({
        userId: fixture.userId,
        avisoVersion: version,
        appVersion: '9.0.0',
      });
      expect(repeat.outcome).toBe('existing');
      expect(repeat.consent.appVersion).toBe(left.consent.appVersion);
      expect(repeat.consent.acceptedAt.toISOString()).toBe(left.consent.acceptedAt.toISOString());
      await expect(
        service.recordConsent({ userId: fixture.userId, avisoVersion: 'older', appVersion: '1.0.0' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      await expect(
        prisma.$executeRaw`
          UPDATE consents SET app_version = 'changed' WHERE id = CAST(${left.consent.id} AS uuid)
        `,
      ).rejects.toThrow(/consents are append-only/);
      await expect(
        prisma.$executeRaw`DELETE FROM consents WHERE id = CAST(${left.consent.id} AS uuid)`,
      ).rejects.toThrow(/consents are append-only/);
      const still = await prisma.consent.findUnique({ where: { id: left.consent.id } });
      expect(still?.appVersion).toBe(left.consent.appVersion);
    } finally {
      await deleteFixture(prisma, fixture);
    }
  });

  it('returns one rotated refresh pair inside the grace window', async () => {
    const fixture = await createFixture(prisma);
    try {
      const tokens = new PrismaRefreshTokens(prisma);
      const raw = randomUUID();
      const now = new Date('2026-10-21T12:00:00.000Z');
      const issued = await tokens.issue({ userId: fixture.userId, rawToken: raw, now });
      const [left, right] = await Promise.all([
        tokens.rotate({ rawToken: raw, now, nextRawToken: randomUUID() }),
        tokens.rotate({ rawToken: raw, now, nextRawToken: randomUUID() }),
      ]);
      const pair = [left, right];
      const rotated = pair.find((result) => result.outcome === 'rotated');
      const grace = pair.find((result) => result.outcome === 'grace');
      expect(rotated?.outcome).toBe('rotated');
      expect(grace?.outcome).toBe('grace');
      if (rotated?.outcome === 'rotated' && grace?.outcome === 'grace') {
        expect(grace.refreshToken).toBe(rotated.refreshToken);
      }
      expect(await tokens.countByFamily(issued.familyId)).toBe(2);
    } finally {
      await deleteFixture(prisma, fixture);
    }
  });

  it('rejects an idempotency key reused with a different hash', async () => {
    const fixture = await createFixture(prisma);
    try {
      const keys = new PrismaIdempotencyKeys(prisma);
      const now = new Date('2026-10-21T12:00:00.000Z');
      const key = randomUUID();
      const reserved = await keys.reserve({
        userId: fixture.userId,
        key,
        route: 'POST /v1/payments',
        requestHash: 'hash-a',
        now,
        expiresAt: new Date('2026-10-22T12:00:00.000Z'),
      });
      expect(reserved.outcome).toBe('reserved');
      if (reserved.outcome !== 'reserved') {
        return;
      }
      await keys.complete(reserved.id, 201, { ok: true });
      try {
        await keys.reserve({
          userId: fixture.userId,
          key,
          route: 'POST /v1/payments',
          requestHash: 'hash-b',
          now,
          expiresAt: new Date('2026-10-22T12:00:00.000Z'),
        });
        throw new Error('expected an idempotency mismatch');
      } catch (error) {
        expect(error).toBeInstanceOf(UnprocessableEntityException);
        expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
          statusCode: 422,
          error: 'idempotency_key_mismatch',
        });
      }
    } finally {
      await deleteFixture(prisma, fixture);
    }
  });

  it('stores auth-code rate limits in Postgres and returns Retry-After', async () => {
    const limits = new PrismaRateLimits(prisma);
    const subject = `user-${randomUUID()}`;
    const now = new Date('2026-10-21T12:00:00.000Z');
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const decision = await limits.record({
          subject,
          purpose: 'login',
          success: false,
          now,
          limit: 3,
          windowMs: 60_000,
        });
        expect(decision.allowed).toBe(true);
      }
      const blocked = await limits.record({
        subject,
        purpose: 'login',
        success: false,
        now: new Date(now.getTime() + 1000),
        limit: 3,
        windowMs: 60_000,
      });
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfterSeconds).toBe(59);
    } finally {
      await prisma.authCodeAttempt.deleteMany({ where: { subject } });
      await prisma.rateLimit.deleteMany({
        where: { bucketKey: bucketKey({ purpose: 'login', subject }) },
      });
    }
  });

  it('seeds the demo rows twice without a consent row', async () => {
    const env = {
      AVISO_VERSION: 'seed-v1',
      AVISO_URL: 'https://example.com/aviso',
    };
    await seedDatabase(prisma, env);
    await seedDatabase(prisma, env);
    const obligation = await prisma.obligation.findUnique({ where: { id: DEMO_OBLIGATION_ID } });
    expect(obligation?.title).toBe('CFE');
    expect(obligation?.expectedAmount).toBe(85000);
    expect(obligation?.dueDay).toBe(15);
    expect(await prisma.consent.count({ where: { userId: DEMO_USER_ID } })).toBe(0);
    const aviso = await prisma.avisoVersion.findUnique({ where: { version: 'seed-v1' } });
    expect(aviso?.url).toBe('https://example.com/aviso');
    expect(await prisma.obligation.count({ where: { id: DEMO_OBLIGATION_ID } })).toBe(1);
  });
});

interface Fixture {
  userId: string;
  propertyId: string;
  obligationId: string;
}

async function createFixture(prisma: PrismaClient): Promise<Fixture> {
  const userId = randomUUID();
  const propertyId = randomUUID();
  const obligationId = randomUUID();
  await prisma.user.create({
    data: { id: userId, trustSub: `it-${userId}`, displayName: 'Integration' },
  });
  await prisma.property.create({
    data: { id: propertyId, name: 'Casa', timezone: 'America/Mexico_City' },
  });
  await prisma.propertyMembership.create({
    data: { id: randomUUID(), propertyId, userId, role: 'owner', status: 'active' },
  });
  await prisma.obligation.create({
    data: {
      id: obligationId,
      propertyId,
      category: 'electricity',
      title: 'CFE',
      recurrence: 'monthly',
      dueDay: 15,
      scheduleAnchor: new Date('2026-03-01T00:00:00.000Z'),
      nextDueDate: new Date('2026-03-15T00:00:00.000Z'),
      expectedAmount: 10000,
      currency: 'MXN',
    },
  });
  return { userId, propertyId, obligationId };
}

async function deleteFixture(prisma: PrismaClient, fixture: Fixture): Promise<void> {
  await prisma.auditEvent.deleteMany({
    where: { OR: [{ propertyId: fixture.propertyId }, { actorUserId: fixture.userId }] },
  });
  await prisma.payment.deleteMany({ where: { propertyId: fixture.propertyId } });
  await prisma.refreshToken.deleteMany({ where: { userId: fixture.userId } });
  await prisma.idempotencyKey.deleteMany({ where: { userId: fixture.userId } });
  await prisma.obligation.deleteMany({ where: { propertyId: fixture.propertyId } });
  await prisma.propertyMembership.deleteMany({ where: { propertyId: fixture.propertyId } });
  await prisma.property.delete({ where: { id: fixture.propertyId } });
  await prisma.user.delete({ where: { id: fixture.userId } }).catch(() => undefined);
}

function twoFields(providerName: string, notes: string): OcrExtractor {
  return {
    extract: () => ({
      outcome: 'suggested',
      suggestions: [
        {
          targetEntityType: 'obligation',
          fieldPath: 'providerName',
          suggestedValue: providerName,
          confidence: 0.95,
        },
        {
          targetEntityType: 'obligation',
          fieldPath: 'notes',
          suggestedValue: notes,
          confidence: 0.95,
        },
      ],
    }),
  };
}

function oneField(fieldPath: string, suggestedValue: string): OcrExtractor {
  return {
    extract: () => ({
      outcome: 'suggested',
      suggestions: [
        {
          targetEntityType: 'obligation',
          fieldPath,
          suggestedValue,
          confidence: 0.95,
        },
      ],
    }),
  };
}

class PrismaConsentAudit implements ConsentAuditLog {
  constructor(private readonly prisma: PrismaClient) {}

  async append(entry: ConsentAuditEntry): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId: entry.userId,
        action: entry.action,
        entityType: 'consent',
        entityId: entry.consentId,
        metadata: {
          userId: entry.userId,
          avisoVersion: entry.avisoVersion,
          appVersion: entry.appVersion,
        },
      },
    });
  }
}
