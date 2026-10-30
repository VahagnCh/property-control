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
import { configureApp } from '../src/configure-app.js';
import { AVISO_TEXT } from '../src/consent/aviso-text.js';
import { redactedTextState } from '../src/ocr/audit-text.js';
import { AvisoVersionConflictError, publishAvisoVersion } from '../src/persistence/seed-data.js';
import { database } from '../src/persistence/database.js';
import { RecordsService } from '../src/writes/records.service.js';

const enabled = Boolean(process.env.DATABASE_URL && process.env.DIRECT_URL);

describe.skipIf(!enabled)('property, obligation, and payment writes', () => {
  const keys = generateAuthJwtKeys('writes-test');
  const sessions = new MemorySessionDirectory();
  const verifier = new Es256AccessTokenVerifier(keys, sessions);
  const userA = randomUUID();
  const userB = randomUUID();
  const avisoVersion = process.env.AVISO_VERSION?.trim() || '2026-10-21';
  const avisoUrl = process.env.AVISO_URL?.trim() || 'https://example.com/aviso';
  const notes = 'Pago de luz en México.\r\nSegunda línea';
  let app: INestApplication;
  let owner: PrismaClient;
  let appDb: PrismaClient;
  const propertyIds: string[] = [];

  beforeAll(async () => {
    minted.set(userA, signAccessToken(keys, { sub: userA, sid: randomUUID(), now: new Date() }));
    minted.set(userB, signAccessToken(keys, { sub: userB, sid: randomUUID(), now: new Date() }));
    owner = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    appDb = new PrismaClient();
    try {
      await publishAvisoVersion(owner, { version: avisoVersion, url: avisoUrl, text: AVISO_TEXT });
    } catch (error) {
      if (!(error instanceof AvisoVersionConflictError)) {
        throw error;
      }
    }
    app = await boot(verifier);
  });

  afterAll(async () => {
    await app?.close();
    if (owner && appDb) {
      await owner.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('session_replication_role', 'replica', true)`;
        await tx.auditEvent.deleteMany({ where: { actorUserId: { in: [userA, userB] } } });
        await tx.consent.deleteMany({ where: { userId: { in: [userA, userB] } } });
        await tx.payment.deleteMany({ where: { recordedByUserId: { in: [userA, userB] } } });
        await tx.idempotencyKey.deleteMany({ where: { userId: { in: [userA, userB] } } });
        await tx.obligation.deleteMany({ where: { propertyId: { in: propertyIds } } });
        await tx.propertyMembership.deleteMany({ where: { userId: { in: [userA, userB] } } });
        if (propertyIds.length > 0) {
          await tx.property.deleteMany({ where: { id: { in: propertyIds } } });
        }
        await tx.user.deleteMany({ where: { id: { in: [userA, userB] } } });
      });
    }
    await owner?.$disconnect();
    await appDb?.$disconnect();
    await database()?.$disconnect();
  });

  it('requires a token, hides other people, and rejects a malformed id', async () => {
    const server = app.getHttpServer();
    const missing = await request(server).get('/v1/properties');
    expect(missing.status, JSON.stringify(missing.body)).toBe(401);
    expect(missing.body.error).toBe('token_missing');

    const malformed = await request(server).get('/v1/properties/not-a-uuid').set(auth(userA));
    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toBe('invalid_path');

    const badJson = await request(server)
      .post('/v1/properties')
      .set('Content-Type', 'application/json')
      .send('{');
    expect(badJson.status).toBe(401);
  });

  it('rejects a write before aviso consent, then saves Casa and a CFE obligation of 850 MXN', async () => {
    const server = app.getHttpServer();
    const denied = await request(server)
      .post('/v1/properties')
      .set(auth(userA))
      .set('Idempotency-Key', 'casa-before-consent')
      .send({ name: 'Casa' });
    expect(denied.status, JSON.stringify(denied.body)).toBe(403);
    expect(denied.body.error).toBe('consent_required');

    await appDb.user.create({ data: { id: userA, trustSub: userA } });
    await appDb.consent.create({
      data: { id: randomUUID(), userId: userA, avisoVersion, acceptedAt: new Date() },
    });

    const created = await request(server)
      .post('/v1/properties')
      .set(auth(userA))
      .set('Idempotency-Key', 'casa-create-1')
      .send({ name: 'Casa' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ name: 'Casa', timezone: 'America/Mexico_City', country: 'MX' });
    const propertyId = created.body.id as string;
    propertyIds.push(propertyId);

    const day = new Date().toISOString().slice(0, 10);
    const obligation = await request(server)
      .post(`/v1/properties/${propertyId}/obligations`)
      .set(auth(userA))
      .set('Idempotency-Key', 'cfe-create-1')
      .send({
        category: 'electricity',
        title: 'CFE',
        providerName: 'Comisión Federal de Electricidad',
        expectedAmount: '850.00',
        dueDay: 15,
        scheduleAnchor: day,
        notes,
      });
    expect(obligation.status, JSON.stringify(obligation.body)).toBe(201);
    expect(obligation.body).toMatchObject({
      title: 'CFE',
      providerName: 'Comisión Federal de Electricidad',
      expectedAmount: '850.00',
      currency: 'MXN',
      notes: 'Pago de luz en México.\nSegunda línea',
    });
    expect(typeof obligation.body.expectedAmount).toBe('string');

    const fresh = new PrismaClient();
    const stored = await fresh.obligation.findUnique({ where: { id: obligation.body.id as string } });
    expect(stored?.expectedAmount).toBe(85000n);
    expect(stored?.title).toBe('CFE');
    const audit = await fresh.auditEvent.findFirst({
      where: { entityId: obligation.body.id as string, action: 'obligation.created' },
    });
    expect(audit?.afterState).toEqual(redactedTextState(notes));
    expect(JSON.stringify(audit)).not.toContain('Segunda');
    expect(JSON.stringify(audit)).not.toContain('México');
    await fresh.$disconnect();

    const again = await boot(verifier);
    const read = await request(again.getHttpServer())
      .get(`/v1/properties/${propertyId}/obligations/${obligation.body.id as string}`)
      .set(auth(userA));
    await again.close();
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body).toMatchObject({ title: 'CFE', expectedAmount: '850.00', currency: 'MXN' });

    const payment = await request(server)
      .post(`/v1/properties/${propertyId}/payments`)
      .set(auth(userA))
      .set('Idempotency-Key', 'cfe-paid-1')
      .send({
        obligationId: obligation.body.id,
        amount: '850.00',
        paidAt: new Date().toISOString(),
        periodDueDate: day,
        notes: 'Pagado',
      });
    expect(payment.status, JSON.stringify(payment.body)).toBe(201);
    expect(payment.body.payment).toMatchObject({ amount: '850.00', currency: 'MXN', status: 'recorded' });
    expect(JSON.stringify(payment.body)).not.toMatch(/transfer|charge|balance|payout/i);
  });

  it('does not store a 401, so the same key creates after the token is refreshed', async () => {
    const server = app.getHttpServer();
    const key = `refresh-${randomUUID()}`;
    const body = { name: `Casa refresh ${randomUUID()}` };
    const expired = signAccessToken(keys, {
      sub: userA,
      sid: randomUUID(),
      now: new Date(Date.now() - 20 * 60 * 1000),
    });
    const rejected = await request(server)
      .post('/v1/properties')
      .set('Authorization', `Bearer ${expired}`)
      .set('Idempotency-Key', key)
      .send(body);
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(401);
    expect(rejected.body.error).toBe('token_expired');
    expect(await appDb.idempotencyKey.count({ where: { key } })).toBe(0);

    const created = await request(server)
      .post('/v1/properties')
      .set(auth(userA))
      .set('Idempotency-Key', key)
      .send(body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    propertyIds.push(created.body.id as string);

    const replay = await request(server)
      .post('/v1/properties')
      .set(auth(userA))
      .set('Idempotency-Key', key)
      .send(body);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(created.body.id);
    expect(await appDb.property.count({ where: { id: created.body.id as string } })).toBe(1);
  });

  it('replays the same key, rejects a different body, and does not cache a 5xx', async () => {
    const server = app.getHttpServer();
    const first = await request(server)
      .post('/v1/properties')
      .set(auth(userA))
      .set('Idempotency-Key', 'replay-casa')
      .send({ name: 'Casa replay' });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    propertyIds.push(first.body.id as string);
    const second = await request(server)
      .post('/v1/properties')
      .set(auth(userA))
      .set('Idempotency-Key', 'replay-casa')
      .send({ name: 'Casa replay' });
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(await appDb.property.count({ where: { id: first.body.id as string } })).toBe(1);

    const reused = await request(server)
      .post('/v1/properties')
      .set(auth(userA))
      .set('Idempotency-Key', 'replay-casa')
      .send({ name: 'Otra casa' });
    expect(reused.status).toBe(409);
    expect(reused.body.error).toBe('idempotency_key_reused');

    const failedName = `Casa fallo ${randomUUID()}`;
    app.get(RecordsService).failNextWrite();
    const failed = await request(server)
      .post('/v1/properties')
      .set(auth(userA))
      .set('Idempotency-Key', 'fail-then-retry')
      .send({ name: failedName });
    expect(failed.status).toBe(500);
    expect(await appDb.property.count({ where: { name: failedName } })).toBe(0);
    const retried = await request(server)
      .post('/v1/properties')
      .set(auth(userA))
      .set('Idempotency-Key', 'fail-then-retry')
      .send({ name: failedName });
    expect(retried.status, JSON.stringify(retried.body)).toBe(201);
    propertyIds.push(retried.body.id as string);
    expect(await appDb.property.count({ where: { name: failedName } })).toBe(1);
  });

  it('creates one row when two requests share a key', async () => {
    const server = app.getHttpServer();
    const body = { name: 'Casa concurrente' };
    const [left, right] = await Promise.all([
      request(server).post('/v1/properties').set(auth(userA)).set('Idempotency-Key', 'concurrent-casa').send(body),
      request(server).post('/v1/properties').set(auth(userA)).set('Idempotency-Key', 'concurrent-casa').send(body),
    ]);
    expect([left.status, right.status].sort()).toEqual([201, 201]);
    expect(left.body.id).toBe(right.body.id);
    propertyIds.push(left.body.id as string);
    expect(await appDb.property.count({ where: { id: left.body.id as string } })).toBe(1);
  });

  it('returns 404 for a non-member and for another user obligation id', async () => {
    const server = app.getHttpServer();
    await appDb.user.create({ data: { id: userB, trustSub: userB } });
    await appDb.consent.create({
      data: { id: randomUUID(), userId: userB, avisoVersion, acceptedAt: new Date() },
    });
    const home = await request(server)
      .post('/v1/properties')
      .set(auth(userB))
      .set('Idempotency-Key', 'user-b-home')
      .send({ name: 'Otra' });
    expect(home.status, JSON.stringify(home.body)).toBe(201);
    const propertyB = home.body.id as string;
    propertyIds.push(propertyB);
    const day = new Date().toISOString().slice(0, 10);
    const obligation = await request(server)
      .post(`/v1/properties/${propertyB}/obligations`)
      .set(auth(userB))
      .set('Idempotency-Key', 'user-b-cfe')
      .send({
        category: 'electricity',
        title: 'CFE B',
        expectedAmount: '10.00',
        dueDay: 15,
        scheduleAnchor: day,
      });
    expect(obligation.status, JSON.stringify(obligation.body)).toBe(201);
    const foreign = await request(server)
      .get(`/v1/properties/${propertyIds[0]}/obligations/${obligation.body.id as string}`)
      .set(auth(userA));
    expect(foreign.status).toBe(404);
    expect(foreign.body.error).toBe('not_found');
    const hidden = await request(server).get(`/v1/properties/${propertyB}`).set(auth(userA));
    expect(hidden.status).toBe(404);
    expect(hidden.body.error).toBe('not_found');
    expect(JSON.stringify(hidden.body)).not.toContain('Otra');
  });

  it('rejects decimal edges and keeps an accented NFC name', async () => {
    const server = app.getHttpServer();
    const propertyId = propertyIds[0];
    if (!propertyId) {
      throw new Error('Casa was not created.');
    }
    const day = new Date().toISOString().slice(0, 10);
    const cases = ['0', '0.00', '-1.00', '1.234', '1234567890123.00', '9999999999999.99'];
    for (const [index, amount] of cases.entries()) {
      const response = await request(server)
        .post(`/v1/properties/${propertyId}/obligations`)
        .set(auth(userA))
        .set('Idempotency-Key', `bad-amount-${index}-key`)
        .send({
          category: 'other',
          title: 'Malo',
          expectedAmount: amount,
          dueDay: 15,
          scheduleAnchor: day,
        });
      expect(response.status, `${amount} ${JSON.stringify(response.body)}`).toBe(422);
      expect(response.body.error).toBe('amount_invalid');
    }
    const numeric = await request(server)
      .post(`/v1/properties/${propertyId}/obligations`)
      .set(auth(userA))
      .set('Idempotency-Key', 'bad-amount-number')
      .send({
        category: 'other',
        title: 'Numero',
        expectedAmount: 850,
        dueDay: 15,
        scheduleAnchor: day,
      });
    expect(numeric.status).toBe(422);
    const tiny = await request(server)
      .post(`/v1/properties/${propertyId}/obligations`)
      .set(auth(userA))
      .set('Idempotency-Key', 'amount-one-cent')
      .send({
        category: 'other',
        title: 'Un centavo',
        expectedAmount: '0.01',
        dueDay: 15,
        scheduleAnchor: day,
      });
    expect(tiny.status, JSON.stringify(tiny.body)).toBe(201);
    expect(tiny.body.expectedAmount).toBe('0.01');

    const renamed = await request(server)
      .patch(`/v1/properties/${propertyId}`)
      .set(auth(userA))
      .set('Idempotency-Key', 'accent-name')
      .send({ name: 'Cafe\u0301' });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(renamed.body.name).toBe('Café');
  });

  it('lets the owner publish an aviso and rejects an insert from the app role', async () => {
    const text = `aviso ${randomUUID()}`;
    const version = `writes-${randomUUID()}`;
    const textSha256 = createHash('sha256').update(text, 'utf8').digest('hex');
    await expect(
      appDb.avisoVersion.create({ data: { version, url: 'https://example.com/aviso', text, textSha256 } }),
    ).rejects.toThrow(/permission denied/i);
    const published = await owner.avisoVersion.create({
      data: { version, url: 'https://example.com/aviso', text, textSha256 },
    });
    expect(published.version).toBe(version);
    await owner.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('session_replication_role', 'replica', true)`;
      await tx.avisoVersion.deleteMany({ where: { version } });
    });
  });
});

function auth(userId: string): { Authorization: string } {
  return { Authorization: `Bearer ${tokenFor(userId)}` };
}

const minted = new Map<string, string>();

function tokenFor(userId: string): string {
  const existing = minted.get(userId);
  if (existing) {
    return existing;
  }
  throw new Error(`No token for ${userId}`);
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
