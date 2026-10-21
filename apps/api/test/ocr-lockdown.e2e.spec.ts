import http from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCESS_TOKEN_VERIFIER, type AccessTokenVerifier } from '../src/auth/access-token.verifier.js';
import { PROPERTY_ACCESS, type PropertyAccess } from '../src/auth/property-access.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';
import { CLOCK, ManualClock } from '../src/ocr/clock.js';
import { OCR_EXTRACTOR, type OcrExtractor } from '../src/ocr/ocr-extractor.js';
import { OCR_RUNTIME } from '../src/ocr/ocr-runtime.js';
import { OCR_TARGET_LOOKUP, type OcrTargetLookup } from '../src/ocr/ocr-target-lookup.js';
import { OBJECT_STORAGE, type PrivateObjectStorage } from '../src/ocr/object-storage.js';

const PROPERTY_A = '11111111-1111-4111-8111-111111111111';
const PROPERTY_B = '11111111-1111-4111-8111-222222222222';
const DOCUMENT_A = '22222222-2222-4222-8222-111111111111';
const DOCUMENT_A2 = '22222222-2222-4222-8222-222222222222';
const DOCUMENT_B = '22222222-2222-4222-8222-333333333333';
const OBLIGATION_A = '33333333-3333-4333-8333-111111111111';
const PAYMENT_A = '44444444-4444-4444-8444-111111111111';
const FORGED = '55555555-5555-4555-8555-555555555555';
const EVIDENCE_A = '77777777-7777-4777-8777-777777777777';

const authA = { Authorization: 'Bearer valid-a' };
const authB = { Authorization: 'Bearer valid-b' };
const authViewer = { Authorization: 'Bearer valid-viewer' };

function verifier(): AccessTokenVerifier {
  return {
    verify(token: string) {
      if (token === 'valid-a') return { sub: 'user-a' };
      if (token === 'valid-b') return { sub: 'user-b' };
      if (token === 'valid-viewer') return { sub: 'user-viewer' };
      if (token === 'expired') return 'expired';
      return 'invalid';
    },
  };
}

function access(): PropertyAccess {
  return {
    resolve({ userId, propertyId }) {
      if (userId === 'user-a' && propertyId === PROPERTY_A) return { role: 'owner', userId };
      if (userId === 'user-b' && propertyId === PROPERTY_B) return { role: 'owner', userId };
      if (userId === 'user-viewer' && propertyId === PROPERTY_A) return { role: 'viewer', userId };
      return null;
    },
    documentBelongsToProperty(propertyId, documentId) {
      if (propertyId === PROPERTY_A) return documentId === DOCUMENT_A || documentId === DOCUMENT_A2;
      if (propertyId === PROPERTY_B) return documentId === DOCUMENT_B;
      return false;
    },
  };
}

function targetLookup(): OcrTargetLookup {
  return {
    belongsToProperty({ propertyId, entityType, entityId }) {
      if (propertyId !== PROPERTY_A) return false;
      if (entityType === 'obligation') return entityId === OBLIGATION_A;
      if (entityType === 'payment') return entityId === PAYMENT_A;
      if (entityType === 'document_meta') return entityId === DOCUMENT_A || entityId === DOCUMENT_A2;
      return false;
    },
  };
}

interface BootOptions {
  enabled?: boolean;
  corsOrigins?: string[];
  jobsMax?: number;
  jobTtlMs?: number;
  clock?: ManualClock;
  verifier?: AccessTokenVerifier;
  access?: PropertyAccess;
  lookup?: OcrTargetLookup;
  extractor?: OcrExtractor;
}

async function boot(options: BootOptions = {}): Promise<{
  app: INestApplication;
  storage: PrivateObjectStorage;
}> {
  let builder: TestingModuleBuilder = Test.createTestingModule({ imports: [AppModule] });
  builder = builder.overrideProvider(OCR_RUNTIME).useValue({
    enabled: options.enabled ?? false,
    jobsMax: options.jobsMax ?? 50,
    jobTtlMs: options.jobTtlMs ?? 900_000,
  });
  if (options.verifier) builder = builder.overrideProvider(ACCESS_TOKEN_VERIFIER).useValue(options.verifier);
  if (options.access) builder = builder.overrideProvider(PROPERTY_ACCESS).useValue(options.access);
  if (options.lookup) builder = builder.overrideProvider(OCR_TARGET_LOOKUP).useValue(options.lookup);
  if (options.clock) builder = builder.overrideProvider(CLOCK).useValue(options.clock);
  if (options.extractor) builder = builder.overrideProvider(OCR_EXTRACTOR).useValue(options.extractor);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
  configureApp(app, options.corsOrigins ? { corsOrigins: options.corsOrigins } : undefined);
  await app.init();
  return { app, storage: app.get(OBJECT_STORAGE) };
}

function findStorageLeaks(value: unknown, path = '$'): string[] {
  const hits: string[] = [];
  if (typeof value === 'string') {
    if (/storage[_-]?key/i.test(value) || /properties\/[0-9a-f-]{8,}\/(?:documents|evidence)\//i.test(value)) {
      hits.push(path);
    }
    return hits;
  }
  if (!value || typeof value !== 'object') return hits;
  if (Array.isArray(value)) {
    value.forEach((item, index) => hits.push(...findStorageLeaks(item, `${path}[${index}]`)));
    return hits;
  }
  for (const [key, child] of Object.entries(value)) {
    if (/storage[_-]?key/i.test(key)) hits.push(`${path}.${key}`);
    hits.push(...findStorageLeaks(child, `${path}.${key}`));
  }
  return hits;
}

function expectNoLeak(body: unknown): void {
  expect(findStorageLeaks(body)).toEqual([]);
}

interface SuggestionRow {
  id: string;
  fieldPath: string;
  targetEntityType: string;
  applyStatus: string;
  lowConfidence?: boolean;
  userEditedValue?: unknown;
}

function rejectAll(suggestions: SuggestionRow[]) {
  return { decisions: suggestions.map((row) => ({ suggestionId: row.id, action: 'reject' })) };
}

describe('OCR lockdown HTTP', () => {
  describe('flag off', () => {
    let app: INestApplication;
    let storage: PrivateObjectStorage;

    beforeAll(async () => {
      ({ app, storage } = await boot({ enabled: false }));
    });
    afterAll(async () => {
      await app.close();
    });

    it('returns 501 for malicious OCR input before a job exists', async () => {
      const server = app.getHttpServer();
      const calls = [
        () =>
          request(server)
            .post('/v1/properties/property-1/documents/document-1/ocr-jobs')
            .send({ storageKey: 'properties/x/documents/y' }),
        () =>
          request(server)
            .post('/v1/properties/%2e%2e%2f/documents/%252e%252e%252f/ocr-jobs')
            .set('Content-Type', 'application/json')
            .send('{'),
        () =>
          request(server)
            .post(`/v1/properties/${PROPERTY_A}/documents/${DOCUMENT_A}/ocr-jobs`)
            .set('Content-Type', 'application/json')
            .send(`{"pad":"${'x'.repeat(40_000)}"}`),
      ];
      for (const call of calls) {
        const response = await call().expect(501);
        expect(response.body.module).toBe('ocr');
        expect(response.body.error).toBe('ocr_disabled');
        expectNoLeak(response.body);
      }
      expect(storage.calls).toEqual([]);
    });
  });

  describe('flag on, fail closed', () => {
    let app: INestApplication;

    beforeAll(async () => {
      ({ app } = await boot({ enabled: true }));
    });
    afterAll(async () => {
      await app.close();
    });

    it('returns 401 for a missing, bad, or any token while the verifier fails closed', async () => {
      const server = app.getHttpServer();
      const path = `/v1/properties/${PROPERTY_A}/documents/${DOCUMENT_A}/ocr-jobs`;
      const cases: Array<[string | undefined, string]> = [
        [undefined, 'token_missing'],
        ['Bearer nope', 'token_invalid'],
        ['Bearer expired', 'token_invalid'],
        ['Bearer valid-a', 'token_invalid'],
      ];
      for (const [header, code] of cases) {
        const call = request(server).post(path);
        const response = header ? await call.set('Authorization', header).expect(401) : await call.expect(401);
        expect(response.body.error).toBe(code);
        expectNoLeak(response.body);
      }
    });

    it('returns 401 before a bad path or an oversized body', async () => {
      const server = app.getHttpServer();
      const malformed = await request(server)
        .post('/v1/properties/property-1/documents/document-1/ocr-jobs')
        .expect(401);
      const oversized = await request(server)
        .post(`/v1/properties/${PROPERTY_A}/documents/${DOCUMENT_A}/ocr-jobs`)
        .set('Content-Type', 'application/json')
        .send(`{"pad":"${'x'.repeat(40_000)}"}`);
      expect(oversized.status).toBe(401);
      expectNoLeak(malformed.body);
      expectNoLeak(oversized.body);
    });
  });

  describe('flag on with stubbed auth', () => {
    let app: INestApplication;
    let storage: PrivateObjectStorage;

    beforeAll(async () => {
      ({ app, storage } = await boot({
        enabled: true,
        verifier: verifier(),
        access: access(),
        lookup: targetLookup(),
      }));
    });
    afterAll(async () => {
      await app.close();
    });

    it('returns 401 for no token, a bad token, or an expired token', async () => {
      const server = app.getHttpServer();
      const path = `/v1/properties/${PROPERTY_A}/documents/${DOCUMENT_A}/ocr-jobs`;
      const missing = await request(server).post(path).expect(401);
      const invalid = await request(server).post(path).set('Authorization', 'Bearer nope').expect(401);
      const expired = await request(server).post(path).set('Authorization', 'Bearer expired').expect(401);
      expect(missing.body.error).toBe('token_missing');
      expect(invalid.body.error).toBe('token_invalid');
      expect(expired.body.error).toBe('token_expired');
    });

    it('returns 400 and 413 after a valid token', async () => {
      const server = app.getHttpServer();
      const badPath = await request(server)
        .post('/v1/properties/property-1/documents/document-1/ocr-jobs')
        .set(authA)
        .expect(400);
      expect(badPath.body.error).toBe('invalid_path');
      const malformed = await request(server)
        .post(`/v1/properties/${PROPERTY_A}/documents/${DOCUMENT_A}/ocr-jobs`)
        .set(authA)
        .set('Content-Type', 'application/json')
        .send('{');
      expect(malformed.status).toBe(400);
      expect(malformed.body.error).toBe('invalid_json');
      const oversized = await request(server)
        .post(`/v1/properties/${PROPERTY_A}/documents/${DOCUMENT_A}/ocr-jobs`)
        .set(authA)
        .set('Content-Type', 'application/json')
        .send(`{"pad":"${'x'.repeat(40_000)}"}`);
      expect(oversized.status).toBe(413);
      expect(oversized.body.error).toBe('payload_too_large');
      expectNoLeak(oversized.body);
    });

    it('returns 404 for an unknown property, document, or other account, and never 403', async () => {
      const server = app.getHttpServer();
      const unknownProperty = '88888888-8888-4888-8888-888888888888';
      const responses = await Promise.all([
        request(server).post(`/v1/properties/${unknownProperty}/documents/${DOCUMENT_A}/ocr-jobs`).set(authA),
        request(server).post(`/v1/properties/${PROPERTY_A}/documents/${FORGED}/ocr-jobs`).set(authA),
        request(server).post(`/v1/properties/${PROPERTY_A}/documents/${DOCUMENT_A}/ocr-jobs`).set(authB),
        request(server).get(`/v1/properties/${PROPERTY_A}/documents/${DOCUMENT_A}/ocr-jobs`).set(authB),
        request(server).get(`/v1/properties/${PROPERTY_A}/ocr-jobs/${FORGED}`).set(authB),
        request(server).post(`/v1/properties/${PROPERTY_A}/ocr-jobs/${FORGED}/confirm`).set(authB).send({ decisions: [] }),
      ]);
      for (const response of responses) {
        expect(response.status).toBe(404);
        expect(response.status).not.toBe(403);
        expect(response.body.error).toBe('not_found');
        expect(response.body.message).toBe('Not found.');
        expectNoLeak(response.body);
      }
      expect(storage.calls).toEqual([]);
    });

    it('OCR confirm is the only path that accepts suggestions', async () => {
      const server = app.getHttpServer();
      const created = await request(server)
        .post(`/v1/properties/${PROPERTY_A}/documents/${DOCUMENT_A}/ocr-jobs`)
        .set(authA)
        .expect(201);
      expect(created.body.status).toBe('suggested');
      expect(created.body.vendor).toBe('stub');
      expect(created.body).not.toHaveProperty('storageKey');
      expectNoLeak(created.body);

      const replay = await request(server)
        .post(`/v1/properties/${PROPERTY_A}/documents/${DOCUMENT_A}/ocr-jobs`)
        .set(authA)
        .expect(200);
      expect(replay.body.id).toBe(created.body.id);
      expectNoLeak(replay.body);

      const fetched = await request(server)
        .get(`/v1/properties/${PROPERTY_A}/ocr-jobs/${created.body.id as string}`)
        .set(authA)
        .expect(200);
      const suggestions = fetched.body.suggestions as SuggestionRow[];
      expect(suggestions.every((row) => row.applyStatus === 'pending')).toBe(true);
      expectNoLeak(fetched.body);

      const confirmed = await request(server)
        .post(`/v1/properties/${PROPERTY_A}/ocr-jobs/${created.body.id as string}/confirm`)
        .set(authA)
        .send({
          decisions: suggestions.map((row) =>
            row.fieldPath === 'providerName'
              ? {
                  suggestionId: row.id,
                  action: 'edit',
                  editedValue: 'Servicio de Agua Potable – Muñoz',
                  targetEntityId: OBLIGATION_A,
                }
              : row.targetEntityType === 'document_meta'
                ? { suggestionId: row.id, action: 'accept' }
                : { suggestionId: row.id, action: 'accept', targetEntityId: OBLIGATION_A },
          ),
        })
        .expect(200);
      expect(confirmed.body.persisted).toBe(false);
      expect(confirmed.body.job.status).toBe('confirmed');
      expect(confirmed.body.job).not.toHaveProperty('storageKey');
      expectNoLeak(confirmed.body);
      const edited = (confirmed.body.suggestions as SuggestionRow[]).find((row) => row.fieldPath === 'providerName');
      expect(edited?.userEditedValue).toBe('Servicio de Agua Potable – Muñoz');

      const again = await request(server)
        .post(`/v1/properties/${PROPERTY_A}/ocr-jobs/${created.body.id as string}/confirm`)
        .set(authA)
        .send({
          decisions: suggestions.map((row) => ({ suggestionId: row.id, action: 'reject' })),
        })
        .expect(409);
      expect(again.body.error).toBe('job_not_confirmable');
      expectNoLeak(again.body);
    });

    it('a viewer can read and cannot confirm', async () => {
      const server = app.getHttpServer();
      const created = await request(server)
        .post(`/v1/properties/${PROPERTY_A}/documents/${DOCUMENT_A2}/ocr-jobs`)
        .set(authA)
        .expect(201);
      const jobId = created.body.id as string;
      const read = await request(server).get(`/v1/properties/${PROPERTY_A}/ocr-jobs/${jobId}`).set(authViewer).expect(200);
      const denied = await request(server)
        .post(`/v1/properties/${PROPERTY_A}/ocr-jobs/${jobId}/confirm`)
        .set(authViewer)
        .send(rejectAll(read.body.suggestions as SuggestionRow[]))
        .expect(403);
      expect(denied.body.error).toBe('forbidden');
      expect(denied.status).not.toBe(404);
      const after = await request(server).get(`/v1/properties/${PROPERTY_A}/ocr-jobs/${jobId}`).set(authA).expect(200);
      expect((after.body.suggestions as SuggestionRow[]).every((row) => row.applyStatus === 'pending')).toBe(true);
      const viewerEnqueue = await request(server)
        .post(`/v1/properties/${PROPERTY_A}/documents/${DOCUMENT_A2}/ocr-jobs`)
        .set(authViewer)
        .expect(403);
      expect(viewerEnqueue.body.error).toBe('forbidden');
    });

    it('rejects non-UUID ids, bad targets, retargets, and bad edited values', async () => {
      const server = app.getHttpServer();
      const badId = await request(server)
        .post('/v1/properties/property-1/documents/document-1/ocr-jobs')
        .set(authA)
        .expect(400);
      expect(badId.body.error).toBe('invalid_path');
      const created = await request(server)
        .post(`/v1/properties/${PROPERTY_A}/documents/${DOCUMENT_A2}/ocr-jobs`)
        .set(authA)
        .expect(200);
      const jobId = created.body.id as string;
      const fetched = await request(server).get(`/v1/properties/${PROPERTY_A}/ocr-jobs/${jobId}`).set(authA).expect(200);
      const suggestions = fetched.body.suggestions as SuggestionRow[];
      const amount = suggestions.find((row) => row.fieldPath === 'expectedAmount');
      const title = suggestions.find((row) => row.targetEntityType === 'document_meta');
      expect(amount).toBeDefined();
      expect(title).toBeDefined();

      const send = (decisions: unknown[]) =>
        request(server).post(`/v1/properties/${PROPERTY_A}/ocr-jobs/${jobId}/confirm`).set(authA).send({ decisions });

      expect((await send([{ suggestionId: amount?.id, action: 'accept', targetEntityId: 'obligation-9' }])).body.error).toBe(
        'target_invalid',
      );
      expect((await send([{ suggestionId: amount?.id, action: 'accept', targetEntityId: 42 }])).body.error).toBe(
        'target_invalid',
      );
      expect((await send([{ suggestionId: amount?.id, action: 'accept', targetEntityId: null }])).body.error).toBe(
        'target_invalid',
      );
      expect((await send([{ suggestionId: amount?.id, action: 'accept', targetEntityId: [OBLIGATION_A] }])).body.error).toBe(
        'target_invalid',
      );
      expect(
        (
          await send([
            { suggestionId: amount?.id, action: 'accept', targetEntityId: OBLIGATION_A, fieldPath: 'expectedAmount' },
          ])
        ).body.error,
      ).toBe('unknown_field');
      await send(
        suggestions.map((row) =>
          row.id === amount?.id
            ? { suggestionId: row.id, action: 'accept', targetEntityId: FORGED }
            : { suggestionId: row.id, action: 'reject' },
        ),
      ).expect(404);
      expect(
        (
          await send(
            suggestions.map((row) =>
              row.id === amount?.id
                ? { suggestionId: row.id, action: 'accept', targetEntityId: PAYMENT_A }
                : { suggestionId: row.id, action: 'reject' },
            ),
          )
        ).body.error,
      ).toBe('not_found');
      expect(
        (
          await send(
            suggestions.map((row) =>
              row.id === title?.id
                ? { suggestionId: row.id, action: 'accept', targetEntityId: DOCUMENT_B }
                : { suggestionId: row.id, action: 'reject' },
            ),
          )
        ).body.error,
      ).toBe('not_found');
      const retarget = await send(
        suggestions.map((row) =>
          row.id === title?.id
            ? { suggestionId: row.id, action: 'accept', targetEntityId: DOCUMENT_A }
            : { suggestionId: row.id, action: 'reject' },
        ),
      );
      expect(retarget.status).toBe(422);
      expect(retarget.body.error).toBe('bound_target_immutable');
      const badEdit = await send(
        suggestions.map((row) =>
          row.id === amount?.id
            ? { suggestionId: row.id, action: 'edit', editedValue: '0.00', targetEntityId: OBLIGATION_A }
            : { suggestionId: row.id, action: 'reject' },
        ),
      ).expect(422);
      expect(badEdit.body).toMatchObject({
        error: 'edited_value_invalid',
        suggestionId: amount?.id,
        field: 'expectedAmount',
      });
      const empty = await request(server)
        .post(`/v1/properties/${PROPERTY_A}/ocr-jobs/${jobId}/confirm`)
        .set(authA)
        .send({})
        .expect(400);
      expect(empty.body.error).toBe('decisions_invalid');
      const still = await request(server).get(`/v1/properties/${PROPERTY_A}/ocr-jobs/${jobId}`).set(authA).expect(200);
      expect((still.body.suggestions as SuggestionRow[]).every((row) => row.applyStatus === 'pending')).toBe(true);
      expectNoLeak(still.body);
    });

    it('rejects traversal in path params and does not call storage', async () => {
      const server = app.getHttpServer();
      const before = storage.calls.length;
      const samples = ['..%2F', '%2e%2e%2f', '%252e%252e%252f', '..%5C', '%2e%2e%5c', encodeURIComponent('．．／'), '%00'];
      for (const sample of samples) {
        const response = await request(server).get(`/v1/properties/${sample}/payments`);
        expect(response.status, sample).toBe(400);
        expectNoLeak(response.body);
      }
      const ocr = await request(server)
        .post(`/v1/properties/..%2F/documents/${DOCUMENT_A}/ocr-jobs`)
        .set(authA);
      expect(ocr.status).toBe(400);
      expect(ocr.body.error).toBe('invalid_path');
      expect(storage.calls).toHaveLength(before);
    });

    it('lets exactly one concurrent confirm win', async () => {
      const server = app.getHttpServer();
      const created = await request(server)
        .post(`/v1/properties/${PROPERTY_B}/documents/${DOCUMENT_B}/ocr-jobs`)
        .set(authB)
        .expect(201);
      const jobId = created.body.id as string;
      const fetched = await request(server).get(`/v1/properties/${PROPERTY_B}/ocr-jobs/${jobId}`).set(authB).expect(200);
      const payload = rejectAll(fetched.body.suggestions as SuggestionRow[]);
      const [first, second] = await Promise.all([
        request(server).post(`/v1/properties/${PROPERTY_B}/ocr-jobs/${jobId}/confirm`).set(authB).send(payload),
        request(server).post(`/v1/properties/${PROPERTY_B}/ocr-jobs/${jobId}/confirm`).set(authB).send(payload),
      ]);
      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const loser = first.status === 409 ? first : second;
      expect(loser.body.error).toBe('job_not_confirmable');
      const after = await request(server).get(`/v1/properties/${PROPERTY_B}/ocr-jobs/${jobId}`).set(authB).expect(200);
      expect(after.body.job.status).toBe('rejected');
      expect((after.body.suggestions as SuggestionRow[]).every((row) => row.applyStatus === 'rejected')).toBe(true);
      expectNoLeak(first.body);
      expectNoLeak(second.body);
    });

    it('returns 409 when confirming a rejected job again', async () => {
      const server = app.getHttpServer();
      const created = await request(server)
        .get(`/v1/properties/${PROPERTY_B}/documents/${DOCUMENT_B}/ocr-jobs`)
        .set(authB)
        .expect(200);
      const jobId = (created.body.items as Array<{ id: string }>)[0]?.id;
      expect(jobId).toBeDefined();
      const response = await request(server)
        .post(`/v1/properties/${PROPERTY_B}/ocr-jobs/${jobId}/confirm`)
        .set(authB)
        .send({ decisions: [{ suggestionId: FORGED, action: 'reject' }] })
        .expect(409);
      expect(response.body.error).toBe('job_not_confirmable');
      expectNoLeak(response.body);
    });

    it('rejects an oversized confirm body and an evidence read has no storage key', async () => {
      const server = app.getHttpServer();
      const oversized = await request(server)
        .post(`/v1/properties/${PROPERTY_A}/ocr-jobs/${FORGED}/confirm`)
        .set(authA)
        .set('Content-Type', 'application/json')
        .send(`{"decisions":"${'x'.repeat(40_000)}"}`);
      expect(oversized.status).toBe(413);
      expect(oversized.body.error).toBe('payload_too_large');
      expectNoLeak(oversized.body);
      const evidence = await request(server).get(`/v1/properties/${PROPERTY_A}/evidence`).expect(200);
      expectNoLeak(evidence.body);
      const content = await request(server)
        .get(`/v1/properties/${PROPERTY_A}/evidence/${EVIDENCE_A}/content-url`)
        .expect(501);
      expectNoLeak(content.body);
      expect(JSON.stringify(content.body)).not.toMatch(/https?:\/\//);
    });

    it('document upload stays unimplemented and does not create an OCR job', async () => {
      const server = app.getHttpServer();
      await request(server)
        .post(`/v1/properties/${PROPERTY_A}/documents`)
        .set(authA)
        .send({ contentType: 'image/jpeg', byteSize: 0 })
        .expect(501);
      const listed = await request(server)
        .get(`/v1/properties/${PROPERTY_A}/documents/${FORGED}/ocr-jobs`)
        .set(authA)
        .expect(404);
      expect(listed.body.error).toBe('not_found');
      expectNoLeak(listed.body);
    });
  });

  describe('jobs cap and ttl', () => {
    let app: INestApplication;
    let clock: ManualClock;

    beforeAll(async () => {
      clock = new ManualClock(5_000);
      ({ app } = await boot({
        enabled: true,
        jobsMax: 1,
        jobTtlMs: 1_000,
        clock,
        verifier: verifier(),
        access: access(),
        lookup: targetLookup(),
      }));
    });
    afterAll(async () => {
      await app.close();
    });

    it('returns 429 without evicting a suggested job, then 410 after the ttl', async () => {
      const server = app.getHttpServer();
      const created = await request(server)
        .post(`/v1/properties/${PROPERTY_A}/documents/${DOCUMENT_A}/ocr-jobs`)
        .set(authA)
        .expect(201);
      const jobId = created.body.id as string;
      const blocked = await request(server)
        .post(`/v1/properties/${PROPERTY_A}/documents/${DOCUMENT_A2}/ocr-jobs`)
        .set(authA)
        .expect(429);
      expect(blocked.body.error).toBe('ocr_capacity');
      expectNoLeak(blocked.body);
      const still = await request(server).get(`/v1/properties/${PROPERTY_A}/ocr-jobs/${jobId}`).set(authA).expect(200);
      expect(still.body.job.status).toBe('suggested');
      const other = await request(server)
        .post(`/v1/properties/${PROPERTY_B}/documents/${DOCUMENT_B}/ocr-jobs`)
        .set(authB)
        .expect(201);
      expect(other.body.status).toBe('suggested');
      clock.nowMs += 1_000;
      const expired = await request(server)
        .post(`/v1/properties/${PROPERTY_A}/ocr-jobs/${jobId}/confirm`)
        .set(authA)
        .send({ decisions: [{ suggestionId: FORGED, action: 'reject' }] })
        .expect(410);
      expect(expired.body.error).toBe('job_expired');
      expectNoLeak(expired.body);
    });
  });

  describe('extract outcomes', () => {
    it('keeps an empty or low-confidence extraction as a suggestion and fails closed on extract failure', async () => {
      const empty = await boot({
        enabled: true,
        verifier: verifier(),
        access: access(),
        extractor: { extract: () => ({ outcome: 'suggested', suggestions: [] }) },
      });
      const created = await request(empty.app.getHttpServer())
        .post(`/v1/properties/${PROPERTY_A}/documents/${DOCUMENT_A}/ocr-jobs`)
        .set(authA)
        .expect(201);
      expect(created.body.status).toBe('suggested');
      const read = await request(empty.app.getHttpServer())
        .get(`/v1/properties/${PROPERTY_A}/ocr-jobs/${created.body.id as string}`)
        .set(authA)
        .expect(200);
      expect(read.body.suggestions).toEqual([]);
      expect(read.body.job.status).not.toBe('confirmed');
      await empty.app.close();

      const low = await boot({
        enabled: true,
        verifier: verifier(),
        access: access(),
        extractor: {
          extract: () => ({
            outcome: 'suggested',
            suggestions: [
              {
                targetEntityType: 'obligation',
                fieldPath: 'providerName',
                suggestedValue: 'Predial Coyoacán',
                confidence: 0.2,
              },
            ],
          }),
        },
      });
      const lowJob = await request(low.app.getHttpServer())
        .post(`/v1/properties/${PROPERTY_A}/documents/${DOCUMENT_A}/ocr-jobs`)
        .set(authA)
        .expect(201);
      const lowRead = await request(low.app.getHttpServer())
        .get(`/v1/properties/${PROPERTY_A}/ocr-jobs/${lowJob.body.id as string}`)
        .set(authA)
        .expect(200);
      expect(lowRead.body.job.status).toBe('suggested');
      expect(lowRead.body.suggestions[0].lowConfidence).toBe(true);
      expect(lowRead.body.suggestions[0].applyStatus).toBe('pending');
      await low.app.close();

      const failed = await boot({
        enabled: true,
        verifier: verifier(),
        access: access(),
        extractor: {
          extract: () => ({
            outcome: 'failed',
            error: 'corrupt',
            suggestions: [
              { targetEntityType: 'obligation', fieldPath: 'providerName', suggestedValue: 'partial' },
            ],
          }),
        },
      });
      const failedJob = await request(failed.app.getHttpServer())
        .post(`/v1/properties/${PROPERTY_A}/documents/${DOCUMENT_A}/ocr-jobs`)
        .set(authA)
        .expect(201);
      expect(failedJob.body.status).toBe('failed');
      const failedRead = await request(failed.app.getHttpServer())
        .get(`/v1/properties/${PROPERTY_A}/ocr-jobs/${failedJob.body.id as string}`)
        .set(authA)
        .expect(200);
      expect(failedRead.body.suggestions).toEqual([]);
      const failedConfirm = await request(failed.app.getHttpServer())
        .post(`/v1/properties/${PROPERTY_A}/ocr-jobs/${failedJob.body.id as string}/confirm`)
        .set(authA)
        .send({ decisions: [] })
        .expect(409);
      expect(failedConfirm.body.error).toBe('job_not_confirmable');
      await failed.app.close();
    });
  });

  describe('CORS allow-list', () => {
    it('does not reflect an origin unless it is on the allow-list, and never reflects *', async () => {
      const closed = await boot({});
      const hidden = await request(closed.app.getHttpServer()).get('/health').set('Origin', 'https://evil.example');
      expect(hidden.headers['access-control-allow-origin']).toBeUndefined();
      await closed.app.close();

      const open = await boot({ corsOrigins: ['https://app.example'] });
      const denied = await request(open.app.getHttpServer()).get('/health').set('Origin', 'https://evil.example');
      const allowed = await request(open.app.getHttpServer()).get('/health').set('Origin', 'https://app.example');
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
      expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example');
      await open.app.close();

      const star = await boot({ corsOrigins: ['*'] });
      const starred = await request(star.app.getHttpServer()).get('/health').set('Origin', 'https://evil.example');
      expect(starred.headers['access-control-allow-origin']).toBeUndefined();
      expect(starred.headers['access-control-allow-origin']).not.toBe('*');
      await star.app.close();
    });
  });

  describe('literal traversal', () => {
    let app: INestApplication;
    let storage: PrivateObjectStorage;

    beforeAll(async () => {
      ({ app, storage } = await boot({ enabled: true, verifier: verifier(), access: access() }));
      await app.listen(0);
    });
    afterAll(async () => {
      await app.close();
    });

    it('returns 400 for a raw ../ path and does not call storage', async () => {
      const server = app.getHttpServer() as http.Server;
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('HTTP server did not bind a port.');
      }
      const before = storage.calls.length;
      const raw = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request(
          { hostname: '127.0.0.1', port: address.port, path: '/v1/properties/../payments', method: 'GET' },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
              resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
            });
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(raw.status).toBe(400);
      expect(JSON.parse(raw.body).error).toBe('invalid_path');
      expect(storage.calls).toHaveLength(before);
    });
  });
});
