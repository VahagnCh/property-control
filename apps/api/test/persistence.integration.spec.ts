import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateAuthJwtKeys } from '../src/auth/access-jwt.js';
import { FakeAuthEmailSender } from '../src/auth/auth-email.js';
import * as authCodes from '../src/auth/auth-codes.js';
import { AuthService } from '../src/auth/auth.service.js';
import { MemorySessionDirectory } from '../src/auth/session-directory.js';
import { PrismaIdempotencyKeys } from '../src/auth/idempotency-keys.js';
import { PrismaRateLimits, authSubjectHmac, bucketKey } from '../src/auth/rate-limit.js';
import { PrismaRefreshTokens } from '../src/auth/prisma-refresh-tokens.js';
import { authCodeHmac } from '../src/auth/auth-codes.js';
import { PrismaAuthAudit, PrismaAuthCodes, PrismaAuthSessions, PrismaAuthUsers } from '../src/auth/prisma-auth-store.js';
import { hashToken } from '../src/auth/refresh-tokens.js';
import { keyedHmac, serverSecret } from '../src/auth/server-secret.js';
import { TEST_SERVER_SECRET } from './test-server-secret.js';
import { PrismaConsentRepository } from '../src/consent/prisma-consent.repository.js';
import { ConsentService } from '../src/consent/consent.service.js';
import type { ConsentAuditEntry, ConsentAuditLog } from '../src/consent/consent.repository.js';
import { AVISO_TEXT } from '../src/consent/aviso-text.js';
import { inviteEmailHmac } from '../src/invites/invite-accept.js';
import { centavosToWireAmount, wireAmountToCentavos } from '../src/payments/wire-money.js';
import { redactedTextState } from '../src/ocr/audit-text.js';
import type { OcrExtractor } from '../src/ocr/ocr-extractor.js';
import { OcrService } from '../src/ocr/ocr.service.js';
import type { OcrTargetLookup } from '../src/ocr/ocr-target-lookup.js';
import { PrismaOcrFieldStore } from '../src/persistence/prisma-ocr-field-store.js';
import {
  AvisoVersionConflictError,
  DEMO_OBLIGATION_ID,
  DEMO_USER_ID,
  publishAvisoVersion,
  seedDatabase,
} from '../src/persistence/seed-data.js';
import { PrismaLedger } from '../src/persistence/prisma-ledger.js';
import { recordPayment, voidPayment } from '../src/payments/ledger.js';
import { documentSourceKey, evidenceSourceKey } from '../src/evidence/storage-key.js';

const enabled = Boolean(process.env.DATABASE_URL && process.env.DIRECT_URL);
let ownerClient: PrismaClient;

describe.skipIf(!enabled)('persistence against Postgres', () => {
  let prisma: PrismaClient;
  let owner: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient();
    owner = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    ownerClient = owner;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await owner?.$disconnect();
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

  it('rejects an old source_key and accepts env/kind/uuid', async () => {
    const fixture = await createFixture(prisma);
    const paymentId = randomUUID();
    const evidenceId = randomUUID();
    const documentId = randomUUID();
    const jobId = randomUUID();
    const oldEvidence = `properties/${fixture.propertyId}/evidence/${evidenceId}/${randomUUID()}`;
    const oldDocument = `properties/${fixture.propertyId}/documents/${documentId}/ocr-stub`;
    try {
      await prisma.payment.create({
        data: {
          id: paymentId,
          propertyId: fixture.propertyId,
          obligationId: fixture.obligationId,
          periodDueDate: new Date('2026-03-15T00:00:00.000Z'),
          recordedByUserId: fixture.userId,
          amount: 10000n,
          currency: 'MXN',
          paidAt: new Date('2026-03-03T18:00:00.000Z'),
          status: 'recorded',
          idempotencyKey: paymentId,
        },
      });
      await prisma.evidence.create({
        data: {
          id: evidenceId,
          propertyId: fixture.propertyId,
          paymentId,
          uploadedByUserId: fixture.userId,
          sourceKey: evidenceSourceKey('staging'),
          type: 'photo',
          contentType: 'image/jpeg',
          sizeBytes: 10n,
          idempotencyKey: evidenceId,
        },
      });
      await expect(
        prisma.evidence.create({
          data: {
            id: randomUUID(),
            propertyId: fixture.propertyId,
            paymentId,
            uploadedByUserId: fixture.userId,
            sourceKey: oldEvidence,
            type: 'photo',
            contentType: 'image/jpeg',
            sizeBytes: 10n,
            idempotencyKey: randomUUID(),
          },
        }),
      ).rejects.toThrow(/evidence_source_key_shape/);
      expect(oldEvidence).toContain(fixture.propertyId);
      expect(oldEvidence).not.toMatch(/^(staging|prod)\/evidence\//);

      await prisma.document.create({
        data: {
          id: documentId,
          propertyId: fixture.propertyId,
          uploadedByUserId: fixture.userId,
          title: 'Deed',
          sourceKey: documentSourceKey('prod'),
          contentType: 'application/pdf',
          byteSize: 10n,
        },
      });
      await expect(
        prisma.document.create({
          data: {
            id: randomUUID(),
            propertyId: fixture.propertyId,
            uploadedByUserId: fixture.userId,
            title: 'Old',
            sourceKey: oldDocument,
            contentType: 'application/pdf',
            byteSize: 10n,
          },
        }),
      ).rejects.toThrow(/documents_source_key_shape/);

      await prisma.ocrJob.create({
        data: {
          id: jobId,
          propertyId: fixture.propertyId,
          documentId,
          sourceKey: documentSourceKey('staging'),
        },
      });
      await expect(
        prisma.ocrJob.create({
          data: {
            id: randomUUID(),
            propertyId: fixture.propertyId,
            documentId,
            sourceKey: oldDocument,
          },
        }),
      ).rejects.toThrow(/ocr_jobs_source_key_shape/);
    } finally {
      await prisma.ocrJob.deleteMany({ where: { propertyId: fixture.propertyId } });
      await prisma.evidence.deleteMany({ where: { propertyId: fixture.propertyId } });
      await prisma.document.deleteMany({ where: { propertyId: fixture.propertyId } });
      await ownerClient.payment.deleteMany({ where: { propertyId: fixture.propertyId } });
      await deleteFixture(prisma, fixture);
    }
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
            amount: 0n,
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
        where: { propertyId: fixture.propertyId, action: 'ocr.replaced' },
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

  it('writes an ocr.accepted audit when an accept commits', async () => {
    const fixture = await createFixture(prisma);
    try {
      const store = new PrismaOcrFieldStore(prisma);
      const service = new OcrService(
        { enabled: true, jobsMax: 10, jobTtlMs: 60_000 },
        store,
        undefined,
        oneField('providerName', 'CFE Norte'),
      );
      const { job } = service.enqueue(fixture.propertyId, randomUUID());
      const suggestion = service.getJob(fixture.propertyId, job.id).suggestions[0];
      const confirmed = await service.confirm(
        fixture.propertyId,
        job.id,
        {
          decisions: [
            {
              suggestionId: suggestion!.id,
              action: 'accept',
              targetEntityId: fixture.obligationId,
            },
          ],
        },
        { actorUserId: fixture.userId },
      );
      expect(confirmed.persisted).toBe(true);
      const obligation = await prisma.obligation.findUnique({ where: { id: fixture.obligationId } });
      expect(obligation?.providerName).toBe('CFE Norte');
      const audit = await prisma.auditEvent.findFirst({
        where: { propertyId: fixture.propertyId, action: 'ocr.accepted' },
      });
      expect(audit?.metadata).toMatchObject({
        source: 'ocr',
        ocrJobId: job.id,
        suggestionId: suggestion!.id,
        field: 'providerName',
        confidence: 0.95,
        edited: false,
        newValue: 'CFE Norte',
      });
    } finally {
      await deleteFixture(prisma, fixture);
    }
  });

  it('stores notes audit states as length and sha256 and not the note text', async () => {
    const fixture = await createFixture(prisma);
    const edited = 'Linea 1\r\nNota secreta 88421';
    const stored = 'Linea 1\nNota secreta 88421';
    const replaced = 'Nota nueva 99001';
    try {
      const store = new PrismaOcrFieldStore(prisma);
      const service = new OcrService(
        { enabled: true, jobsMax: 10, jobTtlMs: 60_000 },
        store,
        undefined,
        oneField('notes', 'sugerida'),
      );
      const { job } = service.enqueue(fixture.propertyId, randomUUID());
      const suggestion = service.getJob(fixture.propertyId, job.id).suggestions[0];
      await service.confirm(
        fixture.propertyId,
        job.id,
        {
          decisions: [
            {
              suggestionId: suggestion!.id,
              action: 'edit',
              editedValue: edited,
              targetEntityId: fixture.obligationId,
            },
          ],
        },
        { actorUserId: fixture.userId },
      );
      const obligation = await prisma.obligation.findUnique({ where: { id: fixture.obligationId } });
      expect(obligation?.notes).toBe(stored);
      const audit = await prisma.auditEvent.findFirst({
        where: { propertyId: fixture.propertyId, action: 'ocr.edited' },
      });
      expect(audit?.beforeState).toBeNull();
      expect(audit?.afterState).toEqual(redactedTextState(stored));
      expect(audit?.metadata).toMatchObject({
        ocrJobId: job.id,
        confidence: 0.95,
        field: 'notes',
        edited: true,
      });
      const serialized = JSON.stringify({
        before: audit?.beforeState,
        after: audit?.afterState,
        metadata: audit?.metadata,
      });
      expect(serialized).not.toContain('Nota secreta');
      expect(serialized).not.toContain('sugerida');
      expect(serialized).not.toContain(edited);
      expect(serialized).not.toContain(stored);

      const again = new OcrService(
        { enabled: true, jobsMax: 10, jobTtlMs: 60_000 },
        store,
        undefined,
        oneField('notes', replaced),
      );
      const second = again.enqueue(fixture.propertyId, randomUUID());
      const next = again.getJob(fixture.propertyId, second.job.id).suggestions[0];
      await again.confirm(
        fixture.propertyId,
        second.job.id,
        {
          decisions: [
            {
              suggestionId: next!.id,
              action: 'replace',
              editedValue: replaced,
              targetEntityId: fixture.obligationId,
            },
          ],
        },
        { actorUserId: fixture.userId },
      );
      const replaceAudit = await prisma.auditEvent.findFirst({
        where: { propertyId: fixture.propertyId, action: 'ocr.replaced' },
      });
      expect(replaceAudit?.beforeState).toEqual(redactedTextState(stored));
      expect(replaceAudit?.afterState).toEqual(redactedTextState(replaced));
      const replaceSerialized = JSON.stringify({
        before: replaceAudit?.beforeState,
        after: replaceAudit?.afterState,
        metadata: replaceAudit?.metadata,
      });
      expect(replaceSerialized).not.toContain(stored);
      expect(replaceSerialized).not.toContain(replaced);
      expect(replaceSerialized).not.toContain('Nota secreta');
    } finally {
      await deleteFixture(prisma, fixture);
    }
  });

  it('rolls the field write back when the audit insert fails', async () => {
    const fixture = await createFixture(prisma);
    try {
      const store = new PrismaOcrFieldStore(prisma);
      const lookup: OcrTargetLookup = {
        belongsToProperty: (input) => store.belongsToProperty(input),
        timeZone: (propertyId) => store.timeZone(propertyId),
        savedValue: (input) => store.savedValue(input),
        saveValue: (input, value) => store.saveValue(input, value),
        runInTransaction: (work) => store.runInTransaction(work),
        appendAudit: async () => {
          throw new Error('audit insert failed');
        },
      };
      const service = new OcrService(
        { enabled: true, jobsMax: 10, jobTtlMs: 60_000 },
        lookup,
        undefined,
        oneField('providerName', 'CFE Norte'),
      );
      const { job } = service.enqueue(fixture.propertyId, randomUUID());
      const suggestion = service.getJob(fixture.propertyId, job.id).suggestions[0];
      await expect(
        service.confirm(fixture.propertyId, job.id, {
          decisions: [{ suggestionId: suggestion!.id, action: 'accept', targetEntityId: fixture.obligationId }],
        }),
      ).rejects.toThrow(/audit insert failed/);
      const obligation = await prisma.obligation.findUnique({ where: { id: fixture.obligationId } });
      expect(obligation?.providerName).toBeNull();
      expect(await prisma.auditEvent.count({ where: { propertyId: fixture.propertyId } })).toBe(0);
    } finally {
      await deleteFixture(prisma, fixture);
    }
  });

  it('leaves no audit row when the field write fails', async () => {
    const fixture = await createFixture(prisma);
    try {
      const store = new PrismaOcrFieldStore(prisma);
      const lookup: OcrTargetLookup = {
        belongsToProperty: (input) => store.belongsToProperty(input),
        timeZone: (propertyId) => store.timeZone(propertyId),
        savedValue: (input) => store.savedValue(input),
        saveValue: async () => {
          throw new Error('write failed');
        },
        runInTransaction: (work) => store.runInTransaction(work),
        appendAudit: (event) => store.appendAudit(event),
      };
      const service = new OcrService(
        { enabled: true, jobsMax: 10, jobTtlMs: 60_000 },
        lookup,
        undefined,
        oneField('providerName', 'CFE Norte'),
      );
      const { job } = service.enqueue(fixture.propertyId, randomUUID());
      const suggestion = service.getJob(fixture.propertyId, job.id).suggestions[0];
      await expect(
        service.confirm(fixture.propertyId, job.id, {
          decisions: [{ suggestionId: suggestion!.id, action: 'accept', targetEntityId: fixture.obligationId }],
        }),
      ).rejects.toThrow(/write failed/);
      const obligation = await prisma.obligation.findUnique({ where: { id: fixture.obligationId } });
      expect(obligation?.providerName).toBeNull();
      expect(await prisma.auditEvent.count({ where: { propertyId: fixture.propertyId } })).toBe(0);
    } finally {
      await deleteFixture(prisma, fixture);
    }
  });

  it('rolls back only the confirm whose transaction failed when two overlap', async () => {
    const fixtureA = await createFixture(prisma);
    const fixtureB = await createFixture(prisma);
    try {
      const store = new PrismaOcrFieldStore(prisma);
      let releaseA: () => void = () => undefined;
      const bInside = new Promise<void>((resolve) => {
        releaseA = resolve;
      });
      let markAWrote: () => void = () => undefined;
      const aWriteDone = new Promise<void>((resolve) => {
        markAWrote = resolve;
      });
      const aQuery = {
        propertyId: fixtureA.propertyId,
        entityType: 'obligation' as const,
        entityId: fixtureA.obligationId,
        fieldPath: 'providerName',
      };
      const bQuery = {
        propertyId: fixtureB.propertyId,
        entityType: 'obligation' as const,
        entityId: fixtureB.obligationId,
        fieldPath: 'providerName',
      };
      const a = store.runInTransaction(async () => {
        await store.saveValue(aQuery, 'From A');
        markAWrote();
        await bInside;
        await store.appendAudit({
          propertyId: fixtureA.propertyId,
          actorUserId: fixtureA.userId,
          action: 'ocr.accepted',
          entityType: 'obligation',
          entityId: fixtureA.obligationId,
          metadata: { marker: 'confirm-a' },
        });
        throw new Error('rollback A');
      });
      const b = (async () => {
        await aWriteDone;
        await store.runInTransaction(async () => {
          releaseA();
          await store.saveValue(bQuery, 'From B');
          await store.appendAudit({
            propertyId: fixtureB.propertyId,
            actorUserId: fixtureB.userId,
            action: 'ocr.accepted',
            entityType: 'obligation',
            entityId: fixtureB.obligationId,
            metadata: { marker: 'confirm-b' },
          });
        });
      })();
      const [aResult, bResult] = await Promise.allSettled([a, b]);
      expect(aResult.status).toBe('rejected');
      expect(bResult.status).toBe('fulfilled');
      const obligationA = await prisma.obligation.findUnique({ where: { id: fixtureA.obligationId } });
      const obligationB = await prisma.obligation.findUnique({ where: { id: fixtureB.obligationId } });
      expect(obligationA?.providerName).toBeNull();
      expect(obligationB?.providerName).toBe('From B');
      expect(await prisma.auditEvent.count({ where: { propertyId: fixtureA.propertyId, action: 'ocr.accepted' } })).toBe(0);
      const auditsB = await prisma.auditEvent.findMany({
        where: { propertyId: fixtureB.propertyId, action: 'ocr.accepted' },
      });
      expect(auditsB).toHaveLength(1);
      expect(auditsB[0]?.metadata).toMatchObject({ marker: 'confirm-b' });
    } finally {
      await deleteFixture(prisma, fixtureA);
      await deleteFixture(prisma, fixtureB);
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
      await owner.avisoVersion.create({
        data: {
          version,
          url: 'https://example.com/aviso',
          text: 'Aviso de prueba.',
          textSha256: textSha256('Aviso de prueba.'),
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
      ).rejects.toThrow(/permission denied|consents are append-only/);
      await expect(
        prisma.$executeRaw`DELETE FROM consents WHERE id = CAST(${left.consent.id} AS uuid)`,
      ).rejects.toThrow(/permission denied|consents are append-only/);
      const audits = await prisma.auditEvent.count({
        where: { entityType: 'consent', entityId: left.consent.id },
      });
      expect(audits).toBe(1);
      const still = await prisma.consent.findUnique({ where: { id: left.consent.id } });
      expect(still?.appVersion).toBe(left.consent.appVersion);
    } finally {
      await deleteFixture(prisma, fixture, version);
    }
  });

  it('returns one rotated refresh pair inside the grace window', async () => {
    const fixture = await createFixture(prisma);
    try {
      const tokens = new PrismaRefreshTokens(prisma, TEST_SERVER_SECRET);
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
        method: 'POST',
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
          method: 'POST',
          route: 'POST /v1/payments',
          requestHash: 'hash-b',
          now,
          expiresAt: new Date('2026-10-22T12:00:00.000Z'),
        });
        throw new Error('expected an idempotency mismatch');
      } catch (error) {
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({
          statusCode: 409,
          error: 'idempotency_key_reused',
        });
      }
    } finally {
      await deleteFixture(prisma, fixture);
    }
  });

  it('stores auth-code rate limits in Postgres and returns Retry-After', async () => {
    const limits = new PrismaRateLimits(prisma, TEST_SERVER_SECRET);
    const email = `person-${randomUUID()}@example.com`;
    const subject = authSubjectHmac(email, TEST_SERVER_SECRET);
    const now = new Date('2026-10-21T12:00:00.000Z');
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const decision = await limits.record({
          subject: email,
          purpose: 'login',
          success: false,
          now,
          limit: 3,
          windowMs: 60_000,
        });
        expect(decision.allowed).toBe(true);
      }
      const blocked = await limits.record({
        subject: email,
        purpose: 'login',
        success: false,
        now: new Date(now.getTime() + 1000),
        limit: 3,
        windowMs: 60_000,
      });
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfterSeconds).toBe(59);
      const attempts = await prisma.authCodeAttempt.findMany({ where: { subject } });
      const buckets = await prisma.rateLimit.findMany({
        where: { bucketKey: bucketKey({ purpose: 'login', subject }) },
      });
      expect(attempts).toHaveLength(4);
      expect(buckets).toHaveLength(1);
      expect(JSON.stringify({ attempts, buckets })).not.toContain(email);
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
    await purgeAppendOnly({ avisoVersion: 'seed-v1' });
    await seedDatabase(owner, env);
    await seedDatabase(owner, env);
    const obligation = await prisma.obligation.findUnique({ where: { id: DEMO_OBLIGATION_ID } });
    expect(obligation?.title).toBe('CFE');
    expect(obligation?.expectedAmount).toBe(85000n);
    expect(obligation?.dueDay).toBe(15);
    expect(await prisma.consent.count({ where: { userId: DEMO_USER_ID } })).toBe(0);
    const aviso = await prisma.avisoVersion.findUnique({ where: { version: 'seed-v1' } });
    expect(aviso?.url).toBe('https://example.com/aviso');
    expect(await prisma.obligation.count({ where: { id: DEMO_OBLIGATION_ID } })).toBe(1);
    expect(aviso?.text).toBe(AVISO_TEXT);
  });

  it('round-trips a peso string above int32 through BIGINT and rejects 0 and negative', async () => {
    const fixture = await createFixture(prisma);
    const wire = '21474836.48';
    const cents = wireAmountToCentavos(wire);
    try {
      expect(cents).toBe(2147483648n);
      await prisma.obligation.update({
        where: { id: fixture.obligationId },
        data: { expectedAmount: cents },
      });
      const stored = await prisma.obligation.findUnique({ where: { id: fixture.obligationId } });
      expect(stored?.expectedAmount).toBe(cents);
      expect(centavosToWireAmount(stored?.expectedAmount ?? 0n)).toBe(wire);
      const raw = await prisma.$queryRaw<Array<{ expected_amount: bigint | string }>>`
        SELECT expected_amount FROM obligations WHERE id = CAST(${fixture.obligationId} AS uuid)
      `;
      expect(centavosToWireAmount(BigInt(raw[0]?.expected_amount ?? 0))).toBe(wire);
      await expect(
        prisma.$executeRaw`
          UPDATE obligations SET expected_amount = 0 WHERE id = CAST(${fixture.obligationId} AS uuid)
        `,
      ).rejects.toThrow(/obligations_expected_amount_positive/);
      await expect(
        prisma.$executeRaw`
          UPDATE obligations SET expected_amount = -1 WHERE id = CAST(${fixture.obligationId} AS uuid)
        `,
      ).rejects.toThrow(/obligations_expected_amount_positive/);
      const paymentId = randomUUID();
      await expect(
        prisma.$executeRaw`
          INSERT INTO payments (
            id, property_id, obligation_id, period_due_date, recorded_by_user_id,
            amount, currency, paid_at, status, idempotency_key, created_at, updated_at
          ) VALUES (
            CAST(${paymentId} AS uuid),
            CAST(${fixture.propertyId} AS uuid),
            CAST(${fixture.obligationId} AS uuid),
            DATE '2026-03-15',
            CAST(${fixture.userId} AS uuid),
            -1,
            'MXN',
            TIMESTAMPTZ '2026-03-03 18:00:00+00',
            'recorded',
            ${paymentId},
            NOW(),
            NOW()
          )
        `,
      ).rejects.toThrow(/payments_amount_positive/);
    } finally {
      await deleteFixture(prisma, fixture);
    }
  });

  it('round-trips overpaid_amount above int32 as BIGINT', async () => {
    const fixture = await createFixture(prisma);
    const wire = '21474836.48';
    const cents = wireAmountToCentavos(wire);
    try {
      expect(cents).toBe(2147483648n);
      expect(cents > 2147483647n).toBe(true);
      await prisma.obligationPeriodOutcome.create({
        data: {
          obligationId: fixture.obligationId,
          propertyId: fixture.propertyId,
          periodDueDate: new Date('2026-03-15T00:00:00.000Z'),
          outcome: 'paid',
          overpaidAmount: cents,
        },
      });
      const stored = await prisma.obligationPeriodOutcome.findFirst({
        where: { obligationId: fixture.obligationId },
      });
      expect(stored?.overpaidAmount).toBe(cents);
      expect(centavosToWireAmount(stored?.overpaidAmount ?? 0n)).toBe(wire);
      const raw = await prisma.$queryRaw<Array<{ overpaid_amount: bigint | string }>>`
        SELECT overpaid_amount FROM obligation_period_outcomes
        WHERE obligation_id = CAST(${fixture.obligationId} AS uuid)
      `;
      expect(centavosToWireAmount(BigInt(raw[0]?.overpaid_amount ?? 0))).toBe(wire);
      await expect(
        prisma.$executeRaw`
          UPDATE obligation_period_outcomes
          SET overpaid_amount = -1
          WHERE obligation_id = CAST(${fixture.obligationId} AS uuid)
        `,
      ).rejects.toThrow(/obligation_period_outcomes_overpaid_nonnegative/);
    } finally {
      await deleteFixture(prisma, fixture);
    }
  });

  it('denies payment deletes, migration writes, and aviso rows that fail the text checks', async () => {
    const who = await prisma.$queryRaw<Array<{ current_user: string }>>`SELECT current_user`;
    expect(who[0]?.current_user).toBe('property_control_app');
    await expectDenied(prisma, 'DELETE FROM payments');
    await expectDenied(prisma, 'UPDATE _prisma_migrations SET checksum = checksum');
    await expectDenied(prisma, 'DELETE FROM _prisma_migrations');

    const version = `aviso-${randomUUID()}`;
    const text = 'Aviso con hash.';
    await expect(
      prisma.avisoVersion.create({
        data: { version, url: 'https://example.com/aviso', text: '', textSha256: textSha256('') },
      }),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      owner.avisoVersion.create({
        data: { version, url: 'https://example.com/aviso', text: '', textSha256: textSha256('') },
      }),
    ).rejects.toThrow(/aviso_versions_text_not_blank/);
    await expect(
      owner.avisoVersion.create({
        data: { version, url: 'https://example.com/aviso', text, textSha256: 'a'.repeat(64) },
      }),
    ).rejects.toThrow(/aviso_versions_text_sha256_matches/);
    await owner.avisoVersion.create({
      data: { version, url: 'https://example.com/aviso', text, textSha256: textSha256(text) },
    });
    const stored = await prisma.avisoVersion.findUnique({ where: { version } });
    expect(stored?.textSha256).toBe(textSha256(text));
    await purgeAppendOnly({ avisoVersion: version });
  });

  it('keeps a payments idempotency key from replaying on another route', async () => {
    const fixture = await createFixture(prisma);
    try {
      const keys = new PrismaIdempotencyKeys(prisma);
      const now = new Date('2026-10-21T12:00:00.000Z');
      const key = '123e4567-e89b-42d3-a456-426614174000';
      const reserved = await keys.reserve({
        userId: fixture.userId,
        key,
        method: 'POST',
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
      const other = await keys.reserve({
        userId: fixture.userId,
        key,
        method: 'POST',
        route: 'POST /v1/properties',
        requestHash: 'hash-a',
        now,
        expiresAt: new Date('2026-10-22T12:00:00.000Z'),
      });
      expect(other.outcome).toBe('reserved');
      const different = await keys.reserve({
        userId: fixture.userId,
        key,
        method: 'POST',
        route: 'POST /v1/obligations',
        requestHash: 'hash-b',
        now,
        expiresAt: new Date('2026-10-22T12:00:00.000Z'),
      });
      expect(different.outcome).toBe('reserved');
    } finally {
      await deleteFixture(prisma, fixture);
    }
  });

  it('stores grace ciphertext and clears it after 31 seconds or a used successor', async () => {
    const fixture = await createFixture(prisma);
    try {
      const tokens = new PrismaRefreshTokens(prisma, TEST_SERVER_SECRET);
      const raw = 'root-refresh-token';
      const next = 'successor-refresh-token';
      const now = new Date('2026-10-21T12:00:00.000Z');
      await tokens.issue({ userId: fixture.userId, rawToken: raw, now });
      const rotated = await tokens.rotate({ rawToken: raw, now, nextRawToken: next });
      expect(rotated.outcome).toBe('rotated');
      const stored = await prisma.$queryRaw<Array<{ grace_refresh_token: string | null }>>`
        SELECT grace_refresh_token FROM refresh_tokens WHERE token_hash = ${hashToken(raw)}
      `;
      expect(stored[0]?.grace_refresh_token?.startsWith('v1.')).toBe(true);
      expect(stored[0]?.grace_refresh_token).not.toContain(next);
      const at29 = await tokens.rotate({
        rawToken: raw,
        now: new Date(now.getTime() + 29_000),
        nextRawToken: 'later-token',
      });
      expect(at29).toMatchObject({ outcome: 'grace', refreshToken: next });
      await tokens.rotate({
        rawToken: next,
        now: new Date(now.getTime() + 30_000),
        nextRawToken: 'used-successor',
      });
      const blocked = await tokens.rotate({
        rawToken: raw,
        now: new Date(now.getTime() + 30_000),
        nextRawToken: 'should-not-return',
      });
      expect(blocked.outcome).toBe('reused');
      const cleared = await prisma.$queryRaw<Array<{ grace_refresh_token: string | null }>>`
        SELECT grace_refresh_token FROM refresh_tokens WHERE token_hash = ${hashToken(raw)}
      `;
      expect(cleared[0]?.grace_refresh_token).toBeNull();
    } finally {
      await deleteFixture(prisma, fixture);
    }
  });

  it('refuses append-only mutations for the app role and for the owner', async () => {
    const who = await prisma.$queryRaw<Array<{ current_user: string }>>`SELECT current_user`;
    expect(who[0]?.current_user).toBe('property_control_app');
    const fixture = await createFixture(prisma);
    const version = `aviso-${randomUUID()}`;
    try {
      await owner.avisoVersion.create({
        data: { version, url: 'https://example.com/aviso', text: 'Texto.', textSha256: textSha256('Texto.') },
      });
      await prisma.consent.create({
        data: {
          userId: fixture.userId,
          avisoVersion: version,
          acceptedAt: new Date('2026-10-21T12:00:00.000Z'),
        },
      });
      await prisma.auditEvent.create({
        data: { actorUserId: fixture.userId, action: 'test', entityType: 'consent' },
      });
      for (const statement of [
        `UPDATE consents SET app_version = 'x'`,
        `DELETE FROM consents`,
        `TRUNCATE TABLE consents`,
        `UPDATE audit_events SET action = 'x'`,
        `DELETE FROM audit_events`,
        `TRUNCATE TABLE audit_events`,
        `UPDATE aviso_versions SET url = 'https://example.com/other'`,
        `DELETE FROM aviso_versions`,
        `TRUNCATE TABLE aviso_versions`,
      ]) {
        await expect(prisma.$executeRawUnsafe(statement), statement).rejects.toThrow(/permission denied/i);
      }
      await expect(
        prisma.$executeRawUnsafe(`ALTER TABLE consents ADD COLUMN trust_blocker_probe text`),
      ).rejects.toThrow(/permission denied|must be owner/i);
      await expect(
        prisma.$executeRawUnsafe(`ALTER TABLE consents DISABLE TRIGGER ALL`),
      ).rejects.toThrow(/permission denied|must be owner/i);
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('session_replication_role', 'replica', true)`;
        }),
      ).rejects.toThrow(/permission denied/i);
      for (const [statement, message] of [
        [`UPDATE consents SET app_version = 'x'`, /consents are append-only/],
        [`DELETE FROM consents`, /consents are append-only/],
        [`TRUNCATE TABLE consents`, /consents are append-only/],
        [`UPDATE audit_events SET action = 'x'`, /audit_events are append-only/],
        [`DELETE FROM audit_events`, /audit_events are append-only/],
        [`TRUNCATE TABLE audit_events`, /audit_events are append-only/],
        [`UPDATE aviso_versions SET url = 'https://example.com/other'`, /aviso_versions are append-only/],
        [`DELETE FROM aviso_versions`, /aviso_versions are append-only/],
        [`TRUNCATE TABLE aviso_versions CASCADE`, /aviso_versions are append-only/],
      ] as const) {
        await expect(owner.$executeRawUnsafe(statement), statement).rejects.toThrow(message);
      }
    } finally {
      await deleteFixture(prisma, fixture, version);
    }
  });

  it('rejects a re-seed that changes aviso text and stores invite email as an HMAC', async () => {
    const fixture = await createFixture(prisma);
    const version = `aviso-${randomUUID()}`;
    const email = 'Invitee@Example.com';
    try {
      await owner.avisoVersion.create({
        data: { version, url: 'https://example.com/old', text: 'old text', textSha256: textSha256('old text') },
      });
      await expect(
        publishAvisoVersion(prisma, { version, url: 'https://example.com/new', text: AVISO_TEXT }),
      ).rejects.toBeInstanceOf(AvisoVersionConflictError);
      const still = await prisma.avisoVersion.findUnique({ where: { version } });
      expect(still?.text).toBe('old text');
      expect(still?.url).toBe('https://example.com/old');
      await expect(
        prisma.consent.count({ where: { avisoVersion: 'missing-aviso-version' } }),
      ).resolves.toBe(0);
      const service = new ConsentService(
        new PrismaConsentRepository(prisma),
        new PrismaConsentAudit(prisma),
        () => ({ avisoVersion: 'missing-aviso-version', avisoUrl: 'https://example.com/missing' }),
        { now: () => new Date() },
      );
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        await service.recordConsent({ userId: fixture.userId, avisoVersion: 'missing-aviso-version' });
        throw new Error('expected aviso_unavailable');
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
          statusCode: 503,
          error: 'aviso_unavailable',
        });
        const alerts = spy.mock.calls.filter((call) => String(call[0]).includes('aviso_unavailable'));
        expect(alerts).toEqual([['alert: aviso_unavailable']]);
        expect(JSON.stringify(alerts)).not.toContain(fixture.userId);
        expect(JSON.stringify(alerts)).not.toContain('@');
      } finally {
        spy.mockRestore();
      }
      expect(await prisma.consent.count({ where: { userId: fixture.userId } })).toBe(0);
      const created = new Date('2026-10-01T00:00:00.000Z');
      const hmac = inviteEmailHmac(email, TEST_SERVER_SECRET);
      await prisma.membershipInvite.create({
        data: {
          propertyId: fixture.propertyId,
          emailHmac: hmac,
          role: 'member',
          tokenHash: randomUUID(),
          invitedByUserId: fixture.userId,
          createdAt: created,
          sentAt: created,
          expiresAt: new Date(created.getTime() + 7 * 24 * 60 * 60 * 1000),
        },
      });
      await expect(
        prisma.membershipInvite.create({
          data: {
            propertyId: fixture.propertyId,
            emailHmac: hmac,
            role: 'viewer',
            tokenHash: randomUUID(),
            invitedByUserId: fixture.userId,
            createdAt: created,
            sentAt: created,
            expiresAt: new Date(created.getTime() + 8 * 24 * 60 * 60 * 1000),
          },
        }),
      ).rejects.toThrow(/membership_invites_expires_within_7_days/);
      const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'membership_invites'
      `;
      const names = columns.map((column) => column.column_name);
      expect(names).toContain('email_hmac');
      expect(names).toContain('superseded_at');
      expect(names).not.toContain('email');
      const stored = await prisma.$queryRaw<Array<{ email_hmac: string }>>`
        SELECT email_hmac FROM membership_invites WHERE property_id = CAST(${fixture.propertyId} AS uuid)
      `;
      expect(stored.map((row) => row.email_hmac)).toEqual([hmac]);
      expect(JSON.stringify(stored)).not.toContain(email.toLowerCase());
    } finally {
      await deleteFixture(prisma, fixture, version);
    }
  });

  it('stores a login code as an hmac and not the code or the email', async () => {
    const code = '654321';
    const email = 'login-secret@example.com';
    const emailHmac = keyedHmac(email, TEST_SERVER_SECRET, 'auth-email');
    const codeHmac = authCodeHmac(code, TEST_SERVER_SECRET);
    const created = await prisma.authCode.create({
      data: {
        emailHmac,
        codeHmac,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    try {
      const row = await prisma.authCode.findUnique({ where: { id: created.id } });
      expect(row?.codeHmac).toBe(codeHmac);
      expect(row?.codeHmac).not.toBe(code);
      expect(Object.values(row ?? {})).not.toContain(code);
      expect(Object.values(row ?? {})).not.toContain(email);
    } finally {
      await prisma.authCode.delete({ where: { id: created.id } });
    }
  });

  it('reserves at most five verify compares when many IPs race the correct code', async () => {
    const email = `race-${randomUUID()}@example.com`;
    const pepper = serverSecret();
    const emailHmac = keyedHmac(email, pepper, 'auth-email');
    const started = new Date();
    const codes = new GatedAuthCodes(prisma);
    const sender = new FakeAuthEmailSender();
    const service = new AuthService(
      new MemorySessionDirectory(),
      sender,
      codes,
      generateAuthJwtKeys('race'),
      () => new Date(),
      { emailSendLimit: 20, ipSendLimit: 100, verifyIpLimit: 100, windowMs: 60 * 60 * 1000 },
      new PrismaAuthUsers(prisma),
      undefined,
      new PrismaAuthAudit(prisma),
      new PrismaRateLimits(prisma, pepper),
    );
    const compare = vi.spyOn(authCodes.authCodeCompare, 'authCodesMatch');
    try {
      await service.requestCode({ email, ip: '198.51.100.200' });
      const correct = sender.sent.at(-1)?.code ?? '';
      expect(correct).toMatch(/^\d{6}$/);
      const firstWave = Array.from({ length: 5 }, (_, index) =>
        service.verifyCode({ email, code: '000000', ip: `203.0.113.${index + 1}` }),
      );
      await vi.waitFor(
        () => {
          expect(codes.waiting).toBe(4);
        },
        { timeout: 15_000, interval: 20 },
      );
      const rest = [
        service.verifyCode({ email, code: correct, ip: '203.0.113.80' }),
        ...Array.from({ length: 15 }, (_, index) =>
          service.verifyCode({ email, code: '111111', ip: `203.0.113.${100 + index}` }),
        ),
      ];
      codes.release();
      const results = await Promise.all([...firstWave, ...rest]);
      expect(results.some((result) => result.status === 200)).toBe(false);
      expect(compare.mock.calls.length).toBeLessThanOrEqual(5);
      const row = await prisma.authCode.findFirst({ where: { emailHmac } });
      expect(row?.attempts ?? 0).toBeLessThanOrEqual(5);
      expect(codes.compares).toBeLessThanOrEqual(5);
    } finally {
      compare.mockRestore();
      codes.release();
      await prisma.authCode.deleteMany({ where: { emailHmac } });
      await prisma.authCodeAttempt.deleteMany({ where: { attemptedAt: { gte: started } } });
      await prisma.rateLimit.deleteMany({ where: { updatedAt: { gte: started } } });
      await ownerClient.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('session_replication_role', 'replica', true)`;
        await tx.auditEvent.deleteMany({
          where: { action: 'auth.login.failed', createdAt: { gte: started } },
        });
      });
    }
  });

  it('claims a code once and keeps the same user id in a new store', async () => {
    const codes = new PrismaAuthCodes(prisma);
    const emailHmac = keyedHmac('stable-login@example.com', 'pepper', 'auth-email');
    const codeHmac = authCodeHmac('424242', 'pepper');
    const now = new Date();
    await codes.insert({
      id: randomUUID(),
      emailHmac,
      codeHmac,
      expiresAt: new Date(now.getTime() + 60_000),
      usedAt: null,
      attempts: 0,
      createdAt: now,
    });
    const users = new PrismaAuthUsers(prisma);
    const sessions = new PrismaAuthSessions(prisma);
    const audit = new PrismaAuthAudit(prisma);
    let userId = '';
    let sid = '';
    try {
      expect(await codes.claimMatching(emailHmac, codeHmac, now)).not.toBeNull();
      expect(await new PrismaAuthCodes(prisma).claimMatching(emailHmac, codeHmac, now)).toBeNull();
      const wrong = await codes.insert({
        id: randomUUID(),
        emailHmac,
        codeHmac: authCodeHmac('111111', 'pepper'),
        expiresAt: new Date(now.getTime() + 60_000),
        usedAt: null,
        attempts: 0,
        createdAt: new Date(now.getTime() + 1),
      });
      void wrong;
      const latest = await codes.findLatest(emailHmac);
      const failed = latest ? await codes.recordFailure(latest.id) : null;
      expect(failed?.attempts).toBe(1);
      userId = (await users.findOrCreate(emailHmac)).id;
      expect((await new PrismaAuthUsers(prisma).findOrCreate(emailHmac)).id).toBe(userId);
      sid = randomUUID();
      await sessions.open(sid, userId);
      expect(await new PrismaAuthSessions(prisma).isRevoked(sid)).toBe(false);
      await sessions.revoke(sid, now);
      expect(await new PrismaAuthSessions(prisma).isRevoked(sid)).toBe(true);
      await audit.append({
        action: 'auth.login.succeeded',
        userId,
        sessionId: sid,
        emailHmac,
        now,
      });
      const row = await prisma.auditEvent.findFirst({ where: { action: 'auth.login.succeeded', entityId: sid } });
      const serialized = JSON.stringify(row);
      expect(serialized).not.toContain('stable-login@example.com');
      expect(serialized).not.toContain('424242');
      expect(serialized).not.toContain('111111');
      expect(row?.metadata).toMatchObject({ emailHmac });
    } finally {
      await purgeAppendOnly({ userId });
      if (sid) {
        await prisma.authSession.deleteMany({ where: { id: sid } });
      }
      await prisma.authCode.deleteMany({ where: { emailHmac } });
      if (userId) {
        await prisma.user.deleteMany({ where: { id: userId } });
      }
    }
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
      expectedAmount: 10000n,
      currency: 'MXN',
    },
  });
  return { userId, propertyId, obligationId };
}

async function deleteFixture(prisma: PrismaClient, fixture: Fixture, avisoVersion?: string): Promise<void> {
  await purgeAppendOnly({
    propertyId: fixture.propertyId,
    userId: fixture.userId,
    avisoVersion,
  });
  await prisma.membershipInvite.deleteMany({ where: { propertyId: fixture.propertyId } });
  await prisma.obligationPeriodOutcome.deleteMany({ where: { propertyId: fixture.propertyId } });
  await ownerClient.payment.deleteMany({ where: { propertyId: fixture.propertyId } });
  await prisma.refreshToken.deleteMany({ where: { userId: fixture.userId } });
  await prisma.idempotencyKey.deleteMany({ where: { userId: fixture.userId } });
  await prisma.obligation.deleteMany({ where: { propertyId: fixture.propertyId } });
  await prisma.propertyMembership.deleteMany({ where: { propertyId: fixture.propertyId } });
  await prisma.property.delete({ where: { id: fixture.propertyId } });
  await prisma.user.delete({ where: { id: fixture.userId } }).catch(() => undefined);
}

async function purgeAppendOnly(scope: {
  propertyId?: string;
  userId?: string;
  avisoVersion?: string;
}): Promise<void> {
  await ownerClient.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('session_replication_role', 'replica', true)`;
    if (scope.propertyId || scope.userId) {
      await tx.auditEvent.deleteMany({
        where: {
          OR: [
            ...(scope.propertyId ? [{ propertyId: scope.propertyId }] : []),
            ...(scope.userId ? [{ actorUserId: scope.userId }] : []),
          ],
        },
      });
    }
    if (scope.userId) {
      await tx.consent.deleteMany({ where: { userId: scope.userId } });
    }
    if (scope.avisoVersion) {
      await tx.avisoVersion.deleteMany({ where: { version: scope.avisoVersion } });
    }
  });
}

function textSha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

async function expectDenied(prisma: PrismaClient, statement: string): Promise<void> {
  await expect(
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(statement);
      throw new Error(`statement was not denied: ${statement}`);
    }),
    statement,
  ).rejects.toThrow(/permission denied/i);
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

class GatedAuthCodes extends PrismaAuthCodes {
  compares = 0;
  waiting = 0;
  release: () => void = () => undefined;
  private readonly open: Promise<void>;

  constructor(prisma: PrismaClient) {
    super(prisma);
    this.open = new Promise((resolve) => {
      this.release = resolve;
    });
  }

  override async reserveAttempt(emailHmac: string, now: Date) {
    const row = await super.reserveAttempt(emailHmac, now);
    if (!row) {
      return null;
    }
    this.compares += 1;
    if (this.compares <= 4) {
      this.waiting += 1;
      await this.open;
    }
    return row;
  }
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
