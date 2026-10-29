import { beforeAll, describe, expect, it, vi } from 'vitest';
import { generateAuthJwtKeys } from './access-jwt.js';
import { MemoryAuthAudit } from './auth-audit.js';
import * as authCodes from './auth-codes.js';
import { MemoryAuthCodes } from './auth-codes.js';
import { FakeAuthEmailSender } from './auth-email.js';
import { AuthService } from './auth.service.js';
import { AUTH_CODE_EMAIL_BODY_KEY, AUTH_CODE_EMAIL_SUBJECT, AUTH_CODE_EMAIL_SUBJECT_KEY, authCodeEmailBody } from './login-email.js';
import { ResendAuthEmailSender, UnconfiguredAuthEmailSender } from './resend-auth-email.js';
import { MemorySessionDirectory, type AuthLimits } from './session-directory.js';

const SECRET = Buffer.alloc(32, 3).toString('base64');

beforeAll(() => {
  process.env.SERVER_SECRET = SECRET;
});

function harness(options?: {
  limits?: AuthLimits;
  jwt?: ReturnType<typeof generateAuthJwtKeys> | null;
  sender?: FakeAuthEmailSender | UnconfiguredAuthEmailSender;
}) {
  const codes = new MemoryAuthCodes();
  const sender = options?.sender ?? new FakeAuthEmailSender();
  const audit = new MemoryAuthAudit();
  const clock = { current: new Date('2026-04-01T00:00:00.000Z') };
  const service = new AuthService(
    new MemorySessionDirectory(),
    sender,
    codes,
    options?.jwt === undefined ? generateAuthJwtKeys() : options.jwt,
    () => clock.current,
    options?.limits ?? { emailSendLimit: 5, ipSendLimit: 1, verifyIpLimit: 1, windowMs: 60 * 60 * 1000 },
    undefined,
    undefined,
    audit,
    undefined,
  );
  return { service, codes, sender: sender as FakeAuthEmailSender, audit, clock };
}

describe('auth send limits', () => {
  it('does not consume another email quota when the IP is already blocked', async () => {
    const { service, sender, clock } = harness();
    await service.requestCode({ email: 'a@example.com', ip: '198.51.100.1' });
    const blocked = await service.requestCode({ email: 'b@example.com', ip: '198.51.100.1' });
    expect(blocked.status).toBe(429);
    for (let index = 0; index < 5; index += 1) {
      clock.current = new Date(clock.current.getTime() + 61_000);
      const sent = await service.requestCode({ email: 'b@example.com', ip: `198.51.100.${index + 2}` });
      expect(sent.status).toBe(202);
    }
    clock.current = new Date(clock.current.getTime() + 61_000);
    const over = await service.requestCode({ email: 'b@example.com', ip: '198.51.100.20' });
    expect(over.status).toBe(429);
    expect(sender.sent.filter((message) => message.to === 'b@example.com')).toHaveLength(5);
  });

  it('checks the verify IP bucket before comparing the code', async () => {
    const { service, sender, clock } = harness();
    await service.requestCode({ email: 'c@example.com', ip: '198.51.100.30' });
    const code = sender.sent[0]?.code ?? '';
    const first = await service.verifyCode({ email: 'c@example.com', code: '000000', ip: '198.51.100.31' });
    expect(first.status).toBe(401);
    const blocked = await service.verifyCode({ email: 'c@example.com', code, ip: '198.51.100.31' });
    expect(blocked.status).toBe(429);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    clock.current = new Date(clock.current.getTime() + 1000);
    const later = await service.verifyCode({ email: 'c@example.com', code, ip: '198.51.100.32' });
    expect(later.status).toBe(200);
  });

  it('returns 503 for a correct code and a wrong code when signing keys are missing', async () => {
    const { service, sender, codes } = harness({ jwt: null });
    await service.requestCode({ email: 'd@example.com', ip: '198.51.100.40' });
    const code = sender.sent[0]?.code ?? '';
    const correct = await service.verifyCode({ email: 'd@example.com', code, ip: '198.51.100.41' });
    const wrong = await service.verifyCode({ email: 'd@example.com', code: '000000', ip: '198.51.100.42' });
    expect(correct).toMatchObject({ status: 503, body: { error: 'auth.unavailable' } });
    expect(wrong).toMatchObject({ status: 503, body: { error: 'auth.unavailable' } });
    expect(JSON.stringify(correct.body)).not.toContain(code);
    const withKeys = new AuthService(
      new MemorySessionDirectory(),
      sender,
      codes,
      generateAuthJwtKeys(),
      () => new Date('2026-04-01T00:00:00.000Z'),
    );
    const ok = await withKeys.verifyCode({ email: 'd@example.com', code, ip: '198.51.100.43' });
    expect(ok.status).toBe(200);
  });
});

describe('login email', () => {
  it('uses the approved copy keys and does not put the code in the subject', async () => {
    expect(AUTH_CODE_EMAIL_SUBJECT_KEY).toBe('auth.codeEmail.subject');
    expect(AUTH_CODE_EMAIL_BODY_KEY).toBe('auth.codeEmail.body');
    expect(AUTH_CODE_EMAIL_SUBJECT).toBe('Tu código para entrar a DueRecord');
    expect(AUTH_CODE_EMAIL_SUBJECT).not.toContain('123456');
    const body = authCodeEmailBody('123456');
    expect(body).toContain('Tu código es: 123456.');
    expect(body).not.toContain('http');
    expect(body).not.toContain('@');
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const sender = new ResendAuthEmailSender({
      apiKey: 're_test',
      from: 'DueRecord <onboarding@resend.dev>',
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response('{}', { status: 200 });
      }) as typeof fetch,
    });
    await sender.sendLoginCode({ to: 'person@example.com', code: '123456' });
    const payload = JSON.parse(String(calls[0]?.init.body)) as {
      subject: string;
      text: string;
      html?: string;
      from: string;
    };
    expect(payload.subject).toBe(AUTH_CODE_EMAIL_SUBJECT);
    expect(payload.subject).not.toContain('123456');
    expect(payload.text).toBe(authCodeEmailBody('123456'));
    expect(payload.text).not.toContain('person@example.com');
    expect(payload.html).toBeUndefined();
    expect(payload.from).toBe('DueRecord <onboarding@resend.dev>');
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: 'Bearer re_test' });
  });

  it('fails closed in production when Resend is not configured', async () => {
    const { service } = harness({ sender: new UnconfiguredAuthEmailSender() });
    const result = await service.requestCode({ email: 'e@example.com', ip: '198.51.100.50' });
    expect(result).toMatchObject({ status: 503, body: { error: 'auth.unavailable' } });
  });

  it('compares a presented code with authCodesMatch', async () => {
    const spy = vi.spyOn(authCodes.authCodeCompare, 'authCodesMatch');
    const { service, sender } = harness({
      limits: { emailSendLimit: 5, ipSendLimit: 20, verifyIpLimit: 20, windowMs: 60 * 60 * 1000 },
    });
    await service.requestCode({ email: 'match@example.com', ip: '198.51.100.80' });
    const code = sender.sent[0]?.code ?? '';
    const wrong = await service.verifyCode({ email: 'match@example.com', code: '000000', ip: '198.51.100.81' });
    expect(wrong.status).toBe(401);
    expect(spy).toHaveBeenCalled();
    spy.mockClear();
    const ok = await service.verifyCode({ email: 'match@example.com', code, ip: '198.51.100.82' });
    expect(ok.status).toBe(200);
    expect(spy).toHaveBeenCalled();
    const skipped = await service.verifyCode({ email: 'match@example.com', code: '12', ip: '198.51.100.83' });
    expect(skipped.status).toBe(401);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('stops one IP after three wrong verifies without locking the email', async () => {
    const { service, sender } = harness({
      limits: { emailSendLimit: 5, ipSendLimit: 20, verifyIpLimit: 20, windowMs: 60 * 60 * 1000 },
    });
    await service.requestCode({ email: 'lock@example.com', ip: '203.0.113.1' });
    const code = sender.sent[0]?.code ?? '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const wrong = await service.verifyCode({
        email: 'lock@example.com',
        code: '000000',
        ip: '203.0.113.9',
      });
      expect(wrong.status).toBe(401);
    }
    const blocked = await service.verifyCode({ email: 'lock@example.com', code, ip: '203.0.113.9' });
    expect(blocked.status).toBe(429);
    const other = await service.verifyCode({ email: 'lock@example.com', code, ip: '203.0.113.10' });
    expect(other.status).toBe(200);
  });

  it('retries a code after Resend returns 500 without starting the cooldown', async () => {
    let calls = 0;
    const sender = new ResendAuthEmailSender({
      apiKey: 're_test',
      from: 'DueRecord <verified@example.com>',
      fetchImpl: (async () => {
        calls += 1;
        if (calls === 1) {
          return new Response('no', { status: 500 });
        }
        return new Response('{}', { status: 200 });
      }) as typeof fetch,
    });
    const { service, clock } = harness({
      sender: sender as unknown as FakeAuthEmailSender,
      limits: { emailSendLimit: 5, ipSendLimit: 20, verifyIpLimit: 20, windowMs: 60 * 60 * 1000 },
    });
    const first = await service.requestCode({ email: 'retry@example.com', ip: '198.51.100.70' });
    expect(first.status).toBe(503);
    const second = await service.requestCode({ email: 'retry@example.com', ip: '198.51.100.71' });
    expect(second.status).toBe(202);
    expect(calls).toBe(2);
    for (let index = 0; index < 4; index += 1) {
      clock.current = new Date(clock.current.getTime() + 61_000);
      const sent = await service.requestCode({
        email: 'retry@example.com',
        ip: `198.51.100.${72 + index}`,
      });
      expect(sent.status).toBe(202);
    }
    expect(calls).toBe(6);
  });

  it('lets a delivered code clear an email that already hit the verify cap', async () => {
    const { service, sender, clock } = harness({
      limits: { emailSendLimit: 5, ipSendLimit: 20, verifyIpLimit: 20, windowMs: 60 * 60 * 1000 },
    });
    await service.requestCode({ email: 'reset@example.com', ip: '203.0.113.1' });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const wrong = await service.verifyCode({
        email: 'reset@example.com',
        code: '000000',
        ip: `203.0.113.${attempt + 2}`,
      });
      expect(wrong.status).toBe(401);
    }
    const blocked = await service.verifyCode({
      email: 'reset@example.com',
      code: '000000',
      ip: '203.0.113.20',
    });
    expect(blocked.status).toBe(429);
    clock.current = new Date(clock.current.getTime() + 61_000);
    const resent = await service.requestCode({ email: 'reset@example.com', ip: '203.0.113.21' });
    expect(resent.status).toBe(202);
    const code = sender.sent.at(-1)?.code ?? '';
    const ok = await service.verifyCode({ email: 'reset@example.com', code, ip: '203.0.113.22' });
    expect(ok.status).toBe(200);
  });
});
