import type { INestApplication } from '@nestjs/common';
import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessTokenGuard } from '../src/auth/access-token.guard.js';
import { ACCESS_TOKEN_VERIFIER } from '../src/auth/access-token.verifier.js';
import { generateAuthJwtKeys, signAccessToken } from '../src/auth/access-jwt.js';
import { AUTH_EMAIL, FakeAuthEmailSender } from '../src/auth/auth-email.js';
import { AUTH_ACCEPTED_BODY, AUTH_CODE_STORE, MemoryAuthCodes } from '../src/auth/auth-codes.js';
import { AuthModule } from '../src/auth/auth.module.js';
import { Es256AccessTokenVerifier } from '../src/auth/es256-access-token.verifier.js';
import { PropertyMembershipGuard } from '../src/auth/property-membership.guard.js';
import { AUTH_CLOCK, AUTH_JWT, SESSION_DIRECTORY, MemorySessionDirectory } from '../src/auth/session-directory.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/configure-app.js';

const SECRET = Buffer.alloc(32, 9).toString('base64');
const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';

@Controller('properties/:propertyId/probe')
@UseGuards(AccessTokenGuard, PropertyMembershipGuard)
class PropertyProbeController {
  @Get()
  get(): { ok: true } {
    return { ok: true };
  }
}

@Module({
  imports: [AuthModule],
  controllers: [PropertyProbeController],
})
class PropertyProbeModule {}

describe('email code auth', () => {
  const keys = generateAuthJwtKeys('test-kid');
  const sessions = new MemorySessionDirectory();
  const sender = new FakeAuthEmailSender();
  const clock = { current: new Date('2026-10-29T15:00:00.000Z') };
  const verifier = new Es256AccessTokenVerifier(keys, sessions, () => clock.current);
  let app: INestApplication;
  let previousSecret: string | undefined;

  beforeAll(async () => {
    previousSecret = process.env.SERVER_SECRET;
    process.env.SERVER_SECRET = SECRET;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AUTH_EMAIL)
      .useValue(sender)
      .overrideProvider(AUTH_JWT)
      .useValue(keys)
      .overrideProvider(AUTH_CLOCK)
      .useValue(() => clock.current)
      .overrideProvider(SESSION_DIRECTORY)
      .useValue(sessions)
      .overrideProvider(ACCESS_TOKEN_VERIFIER)
      .useValue(verifier)
      .compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (previousSecret === undefined) {
      delete process.env.SERVER_SECRET;
    } else {
      process.env.SERVER_SECRET = previousSecret;
    }
  });

  function at(iso: string): void {
    clock.current = new Date(iso);
  }

  it('returns the same 202 for an unknown email and does not echo the code', async () => {
    at('2026-10-29T15:00:00.000Z');
    const server = app.getHttpServer();
    const first = await request(server)
      .post('/v1/auth/code')
      .set('X-Forwarded-For', '203.0.113.10')
      .send({ email: ' Unknown@Example.com ' })
      .expect(202);
    const second = await request(server)
      .post('/v1/auth/code')
      .set('X-Forwarded-For', '203.0.113.11')
      .send({ email: 'other@example.com' })
      .expect(202);
    expect(first.body).toEqual(AUTH_ACCEPTED_BODY);
    expect(second.body).toEqual(first.body);
    expect(JSON.stringify(first.body)).not.toContain('Unknown');
    const codes = app.get<MemoryAuthCodes>(AUTH_CODE_STORE);
    const stored = codes.storedText();
    expect(stored).not.toContain('unknown@example.com');
    expect(stored).not.toContain(sender.sent[0]?.code ?? 'missing-code');
    expect(sender.sent.map((message) => message.to)).toEqual(['unknown@example.com', 'other@example.com']);
    expect(sender.sent[0]?.code).toMatch(/^\d{6}$/);
  });

  it('replays the same Idempotency-Key without a second email', async () => {
    at('2026-10-29T16:00:00.000Z');
    const before = sender.sent.length;
    const server = app.getHttpServer();
    await request(server)
      .post('/v1/auth/code')
      .set('X-Forwarded-For', '203.0.113.20')
      .set('Idempotency-Key', 'idem-key-1')
      .send({ email: 'idem@example.com' })
      .expect(202);
    await request(server)
      .post('/v1/auth/code')
      .set('X-Forwarded-For', '203.0.113.21')
      .set('Idempotency-Key', 'idem-key-1')
      .send({ email: 'idem@example.com' })
      .expect(202);
    expect(sender.sent.length).toBe(before + 1);
  });

  it('treats the same key with a different email as a new 202', async () => {
    at('2026-10-29T17:00:00.000Z');
    const before = sender.sent.length;
    const server = app.getHttpServer();
    await request(server)
      .post('/v1/auth/code')
      .set('X-Forwarded-For', '203.0.113.22')
      .set('Idempotency-Key', 'shared-key')
      .send({ email: 'one@example.com' })
      .expect(202);
    await request(server)
      .post('/v1/auth/code')
      .set('X-Forwarded-For', '203.0.113.23')
      .set('Idempotency-Key', 'shared-key')
      .send({ email: 'two@example.com' })
      .expect(202);
    expect(sender.sent.length).toBe(before + 2);
  });

  it('returns 401 auth.code_invalid for a wrong, expired, or reused code, then 429', async () => {
    at('2026-10-29T18:00:00.000Z');
    const server = app.getHttpServer();
    await request(server)
      .post('/v1/auth/code')
      .set('X-Forwarded-For', '203.0.113.30')
      .send({ email: 'verify@example.com' })
      .expect(202);
    const code = sender.sent.at(-1)?.code ?? '';
    const wrong = await request(server)
      .post('/v1/auth/verify')
      .set('X-Forwarded-For', '203.0.113.30')
      .send({ email: 'verify@example.com', code: '000000' })
      .expect(401);
    expect(wrong.body.error).toBe('auth.code_invalid');
    expect(JSON.stringify(wrong.body)).not.toContain(code);

    const unknown = await request(server)
      .post('/v1/auth/verify')
      .set('X-Forwarded-For', '203.0.113.31')
      .send({ email: 'nobody@example.com', code: '123456' })
      .expect(401);
    expect(unknown.body).toEqual(wrong.body);

    at('2026-10-29T18:11:00.000Z');
    const expired = await request(server)
      .post('/v1/auth/verify')
      .set('X-Forwarded-For', '203.0.113.32')
      .send({ email: 'verify@example.com', code })
      .expect(401);
    expect(expired.body.error).toBe('auth.code_invalid');

    at('2026-10-29T19:00:00.000Z');
    await request(server)
      .post('/v1/auth/code')
      .set('X-Forwarded-For', '203.0.113.33')
      .send({ email: 'again@example.com' })
      .expect(202);
    const fresh = sender.sent.at(-1)?.code ?? '';
    const ok = await request(server)
      .post('/v1/auth/verify')
      .set('X-Forwarded-For', '203.0.113.33')
      .send({ email: 'again@example.com', code: fresh })
      .expect(200);
    expect(ok.body.tokenType).toBe('Bearer');
    expect(typeof ok.body.accessToken).toBe('string');
    expect(String(ok.body.refreshToken)).toMatch(/^rt_/);
    const reused = await request(server)
      .post('/v1/auth/verify')
      .set('X-Forwarded-For', '203.0.113.34')
      .send({ email: 'again@example.com', code: fresh })
      .expect(401);
    expect(reused.body.error).toBe('auth.code_invalid');

    at('2026-10-29T20:00:00.000Z');
    await request(server)
      .post('/v1/auth/code')
      .set('X-Forwarded-For', '203.0.113.40')
      .send({ email: 'limit@example.com' })
      .expect(202);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await request(server)
        .post('/v1/auth/verify')
        .set('X-Forwarded-For', `203.0.113.${40 + attempt}`)
        .send({ email: 'limit@example.com', code: '111111' })
        .expect(401);
    }
    const limited = await request(server)
      .post('/v1/auth/verify')
      .set('X-Forwarded-For', '203.0.113.49')
      .send({ email: 'limit@example.com', code: '111111' })
      .expect(429);
    expect(limited.body.error).toBe('auth.rate_limited');
    expect(limited.headers['retry-after']).toMatch(/^\d+$/);
    expect(JSON.stringify(limited.body)).not.toContain('limit@example.com');
  });

  it('returns 429 Retry-After after five code sends in an hour', async () => {
    const server = app.getHttpServer();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      at(new Date(Date.UTC(2026, 9, 29, 21, attempt, 30)).toISOString());
      await request(server)
        .post('/v1/auth/code')
        .set('X-Forwarded-For', `198.51.100.${attempt + 1}`)
        .send({ email: 'flood@example.com' })
        .expect(202);
    }
    at('2026-10-29T21:06:00.000Z');
    const limited = await request(server)
      .post('/v1/auth/code')
      .set('X-Forwarded-For', '198.51.100.9')
      .send({ email: 'flood@example.com' })
      .expect(429);
    expect(limited.headers['retry-after']).toMatch(/^\d+$/);
  });

  it('rotates a refresh token and revokes the family when the old token is reused', async () => {
    at('2026-10-29T22:00:00.000Z');
    const server = app.getHttpServer();
    await request(server)
      .post('/v1/auth/code')
      .set('X-Forwarded-For', '203.0.113.60')
      .send({ email: 'refresh@example.com' })
      .expect(202);
    const code = sender.sent.at(-1)?.code ?? '';
    const verified = await request(server)
      .post('/v1/auth/verify')
      .set('X-Forwarded-For', '203.0.113.60')
      .send({ email: 'refresh@example.com', code })
      .expect(200);
    const firstRefresh = verified.body.refreshToken as string;
    const rotated = await request(server)
      .post('/v1/auth/refresh')
      .send({ refreshToken: firstRefresh })
      .expect(200);
    expect(rotated.body.refreshToken).not.toBe(firstRefresh);
    const session = await request(server)
      .get('/v1/auth/session')
      .set('Authorization', `Bearer ${rotated.body.accessToken as string}`)
      .expect(200);
    expect(session.body.sub).toEqual(expect.any(String));
    expect(JSON.stringify(session.body)).not.toContain('refresh@example.com');

    at('2026-10-29T22:00:31.000Z');
    const reused = await request(server)
      .post('/v1/auth/refresh')
      .send({ refreshToken: firstRefresh })
      .expect(401);
    expect(reused.body.error).toBe('auth.refresh_reused');
    await request(server)
      .get('/v1/auth/session')
      .set('Authorization', `Bearer ${rotated.body.accessToken as string}`)
      .expect(401);
  });

  it('requires a valid access token on the session route and logs out the session', async () => {
    at('2026-10-29T23:00:00.000Z');
    const server = app.getHttpServer();
    await request(server).get('/v1/auth/session').expect(401);
    await request(server).get('/v1/auth/session').set('Authorization', 'Bearer not-a-jwt').expect(401);
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from('{}').toString('base64url')}.`;
    await request(server).get('/v1/auth/session').set('Authorization', `Bearer ${none}`).expect(401);

    await request(server)
      .post('/v1/auth/code')
      .set('X-Forwarded-For', '203.0.113.70')
      .send({ email: 'session@example.com' })
      .expect(202);
    const code = sender.sent.at(-1)?.code ?? '';
    const verified = await request(server)
      .post('/v1/auth/verify')
      .send({ email: 'session@example.com', code })
      .expect(200);
    const accessToken = verified.body.accessToken as string;
    await request(server).post('/v1/auth/logout').set('Authorization', `Bearer ${accessToken}`).expect(204);
    await request(server).get('/v1/auth/session').set('Authorization', `Bearer ${accessToken}`).expect(401);

    const expired = signAccessToken(keys, {
      sub: 'user',
      sid: 'sid',
      now: new Date(clock.current.getTime() - 17 * 60 * 1000),
    });
    await request(server).get('/v1/auth/session').set('Authorization', `Bearer ${expired}`).expect(401);
  });

  it('rejects a missing or malformed Authorization header and a tampered signature', async () => {
    at('2026-10-30T00:00:00.000Z');
    const server = app.getHttpServer();
    await request(server).get('/v1/auth/session').expect(401);
    await request(server).get('/v1/auth/session').set('Authorization', 'Bearer').expect(401);
    await request(server).get('/v1/auth/session').set('Authorization', 'Bearer ').expect(401);
    await request(server).get('/v1/auth/session').set('Authorization', 'Token abc').expect(401);
    const minted = signAccessToken(keys, { sub: 'user-1', sid: 'sid-1', now: clock.current });
    const parts = minted.split('.');
    const raw = Buffer.from(parts[2] ?? '', 'base64url');
    raw[0] = (raw[0] ?? 0) ^ 0xff;
    const tampered = await request(server)
      .get('/v1/auth/session')
      .set('Authorization', `Bearer ${parts[0]}.${parts[1]}.${raw.toString('base64url')}`)
      .expect(401);
    expect(tampered.body.error).toMatch(/token_/);
    expect(JSON.stringify(tampered.body)).not.toContain(minted);
  });

  it('returns the same refresh token inside the 30 second grace', async () => {
    at('2026-10-30T01:00:00.000Z');
    const server = app.getHttpServer();
    await request(server)
      .post('/v1/auth/code')
      .set('X-Forwarded-For', '203.0.113.80')
      .send({ email: 'grace@example.com' })
      .expect(202);
    const code = sender.sent.at(-1)?.code ?? '';
    const verified = await request(server)
      .post('/v1/auth/verify')
      .send({ email: 'grace@example.com', code })
      .expect(200);
    const original = verified.body.refreshToken as string;
    const rotated = await request(server).post('/v1/auth/refresh').send({ refreshToken: original }).expect(200);
    at('2026-10-30T01:00:10.000Z');
    const grace = await request(server).post('/v1/auth/refresh').send({ refreshToken: original }).expect(200);
    expect(grace.body.refreshToken).toBe(rotated.body.refreshToken);
    expect(JSON.stringify(grace.body)).not.toContain(code);
    await request(server)
      .get('/v1/auth/session')
      .set('Authorization', `Bearer ${grace.body.accessToken as string}`)
      .expect(200);
  });

  it('expires a refresh token after 30 idle days without revoking the family', async () => {
    at('2026-10-30T02:00:00.000Z');
    const server = app.getHttpServer();
    await request(server)
      .post('/v1/auth/code')
      .set('X-Forwarded-For', '203.0.113.90')
      .send({ email: 'idle@example.com' })
      .expect(202);
    const code = sender.sent.at(-1)?.code ?? '';
    const verified = await request(server)
      .post('/v1/auth/verify')
      .send({ email: 'idle@example.com', code })
      .expect(200);
    const refreshToken = verified.body.refreshToken as string;
    at(new Date(clock.current.getTime() + 30 * 24 * 60 * 60 * 1000 + 1000).toISOString());
    const expired = await request(server).post('/v1/auth/refresh').send({ refreshToken }).expect(401);
    expect(expired.body.error).toBe('auth.refresh_invalid');
    expect(JSON.stringify(expired.body)).not.toContain(refreshToken);
    expect(JSON.stringify(expired.body)).not.toContain(code);
    const again = await request(server).post('/v1/auth/refresh').send({ refreshToken }).expect(401);
    expect(again.body.error).toBe('auth.refresh_invalid');
  });

  it('stops a refresh at the 90 day absolute cap', async () => {
    const start = new Date('2026-11-01T00:00:00.000Z');
    at(start.toISOString());
    const server = app.getHttpServer();
    await request(server)
      .post('/v1/auth/code')
      .set('X-Forwarded-For', '203.0.113.91')
      .send({ email: 'absolute@example.com' })
      .expect(202);
    const code = sender.sent.at(-1)?.code ?? '';
    const verified = await request(server)
      .post('/v1/auth/verify')
      .send({ email: 'absolute@example.com', code })
      .expect(200);
    let refreshToken = verified.body.refreshToken as string;
    for (const day of [29, 58, 87]) {
      at(new Date(start.getTime() + day * 24 * 60 * 60 * 1000).toISOString());
      const rotated = await request(server).post('/v1/auth/refresh').send({ refreshToken }).expect(200);
      refreshToken = rotated.body.refreshToken as string;
    }
    at(new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000 + 1000).toISOString());
    const capped = await request(server).post('/v1/auth/refresh').send({ refreshToken }).expect(401);
    expect(capped.body.error).toBe('auth.refresh_invalid');
    expect(JSON.stringify(capped.body)).not.toContain(refreshToken);
    expect(JSON.stringify(capped.body)).not.toContain(code);
  });

  it('does not write the code or refresh token to logs or error bodies', async () => {
    at('2026-12-01T00:00:00.000Z');
    const server = app.getHttpServer();
    await request(server)
      .post('/v1/auth/code')
      .set('X-Forwarded-For', '203.0.113.95')
      .send({ email: 'quiet@example.com' })
      .expect(202);
    const code = sender.sent.at(-1)?.code ?? '';
    const verified = await request(server)
      .post('/v1/auth/verify')
      .send({ email: 'quiet@example.com', code })
      .expect(200);
    const refreshToken = verified.body.refreshToken as string;
    const captured: string[] = [];
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const originals = methods.map((method) => console[method]);
    for (const method of methods) {
      console[method] = (...args: unknown[]) => {
        captured.push(args.map((arg) => String(arg)).join(' '));
      };
    }
    try {
      const wrong = await request(server)
        .post('/v1/auth/verify')
        .send({ email: 'quiet@example.com', code: '000000' })
        .expect(401);
      const reused = await request(server).post('/v1/auth/refresh').send({ refreshToken: 'rt_not-a-real-token' }).expect(401);
      const text = `${JSON.stringify(wrong.body)} ${JSON.stringify(reused.body)} ${captured.join('\n')}`;
      expect(text).not.toContain(code);
      expect(text).not.toContain(refreshToken);
      expect(text).not.toContain('quiet@example.com');
    } finally {
      methods.forEach((method, index) => {
        console[method] = originals[index] as (typeof console)[typeof method];
      });
    }
  });
});

describe('short JWT signature on an OCR route', () => {
  it('returns 401 instead of 500', async () => {
    const keys = generateAuthJwtKeys('ocr-kid');
    const previousOcr = process.env.OCR_STUB_ENABLED;
    const previousPrivate = process.env.AUTH_JWT_PRIVATE_KEY;
    const previousPublic = process.env.AUTH_JWT_PUBLIC_KEY;
    const previousKid = process.env.AUTH_JWT_KID;
    process.env.OCR_STUB_ENABLED = '1';
    process.env.AUTH_JWT_PRIVATE_KEY = keys.privateKeyPem;
    process.env.AUTH_JWT_PUBLIC_KEY = keys.publicKeyPem;
    process.env.AUTH_JWT_KID = keys.kid;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    try {
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: keys.kid })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          sub: 'user-1',
          sid: '11111111-1111-4111-8111-111111111111',
          iat: now,
          exp: now + 900,
          iss: 'api.duerecord.mx',
          aud: 'duerecord-app',
        }),
      ).toString('base64url');
      const signature = Buffer.alloc(8).toString('base64url');
      const response = await request(app.getHttpServer())
        .post('/v1/properties/11111111-1111-4111-8111-111111111111/documents/22222222-2222-4222-8222-222222222222/ocr-jobs')
        .set('Authorization', `Bearer ${header}.${payload}.${signature}`)
        .expect(401);
      expect(response.body.error).toBe('token_invalid');
    } finally {
      await app.close();
      restore('OCR_STUB_ENABLED', previousOcr);
      restore('AUTH_JWT_PRIVATE_KEY', previousPrivate);
      restore('AUTH_JWT_PUBLIC_KEY', previousPublic);
      restore('AUTH_JWT_KID', previousKid);
    }
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe('unknown property', () => {
  it('returns 404, not 403, for a valid access token with no membership', async () => {
    const keys = generateAuthJwtKeys('probe-kid');
    const sessions = new MemorySessionDirectory();
    const now = new Date('2026-10-29T12:00:00.000Z');
    const verifier = new Es256AccessTokenVerifier(keys, sessions, () => now);
    const moduleRef = await Test.createTestingModule({
      imports: [PropertyProbeModule],
    })
      .overrideProvider(AUTH_JWT)
      .useValue(keys)
      .overrideProvider(SESSION_DIRECTORY)
      .useValue(sessions)
      .overrideProvider(ACCESS_TOKEN_VERIFIER)
      .useValue(verifier)
      .compile();
    const app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    try {
      const token = signAccessToken(keys, { sub: 'user-1', sid: 'sid-1', now });
      const response = await request(app.getHttpServer())
        .get(`/v1/properties/${PROPERTY_ID}/probe`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      expect(response.body.error).toBe('not_found');
      expect(response.status).not.toBe(403);
      await request(app.getHttpServer()).get(`/v1/properties/${PROPERTY_ID}/probe`).expect(401);
    } finally {
      await app.close();
    }
  });
});
