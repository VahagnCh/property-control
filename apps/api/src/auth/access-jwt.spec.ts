import { createHmac, createSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_AUD,
  ACCESS_TOKEN_ISS,
  ACCESS_TOKEN_TTL_SECONDS,
  assertAuthJwtConfig,
  generateAuthJwtKeys,
  signAccessToken,
  verifyAccessToken,
} from './access-jwt.js';

const NOW = new Date('2026-10-29T15:00:00.000Z');
const keys = generateAuthJwtKeys('kid-1');

function rawToken(header: Record<string, unknown>, payload: Record<string, unknown>, signature: string): string {
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const iat = Math.floor(NOW.getTime() / 1000);
  return {
    sub: 'user-1',
    sid: 'session-1',
    iat,
    exp: iat + ACCESS_TOKEN_TTL_SECONDS,
    iss: ACCESS_TOKEN_ISS,
    aud: ACCESS_TOKEN_AUD,
    ...overrides,
  };
}

describe('ES256 access tokens', () => {
  it('signs a 15-minute token with iss, aud, sub, and sid, and no email', () => {
    const token = signAccessToken(keys, { sub: 'user-1', sid: 'session-1', now: NOW });
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      sub: 'user-1',
      sid: 'session-1',
      iss: ACCESS_TOKEN_ISS,
      aud: ACCESS_TOKEN_AUD,
    });
    expect(payload.exp).toBe((payload.iat as number) + ACCESS_TOKEN_TTL_SECONDS);
    expect(payload).not.toHaveProperty('email');
    expect(verifyAccessToken(keys, token, NOW)).toMatchObject({ ok: true });
  });

  it('accepts 60 seconds of clock skew and rejects a token past that', () => {
    const token = signAccessToken(keys, { sub: 'user-1', sid: 'session-1', now: NOW });
    const almost = new Date(NOW.getTime() + (ACCESS_TOKEN_TTL_SECONDS + 30) * 1000);
    const past = new Date(NOW.getTime() + (ACCESS_TOKEN_TTL_SECONDS + 61) * 1000);
    expect(verifyAccessToken(keys, token, almost).ok).toBe(true);
    expect(verifyAccessToken(keys, token, past)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a future iat, the wrong iss, and the wrong aud', () => {
    const future = rawSigned({ ...claims(), iat: Math.floor(NOW.getTime() / 1000) + 120 });
    expect(verifyAccessToken(keys, future, NOW)).toEqual({ ok: false, reason: 'invalid' });
    expect(verifyAccessToken(keys, rawSigned(claims({ iss: 'evil.example' })), NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(verifyAccessToken(keys, rawSigned(claims({ aud: 'other-app' })), NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects alg=none and HS256 signed with the public key', () => {
    const none = rawToken({ alg: 'none', typ: 'JWT', kid: keys.kid }, claims(), 'x');
    expect(verifyAccessToken(keys, none, NOW)).toEqual({ ok: false, reason: 'invalid' });

    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: keys.kid })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims())).toString('base64url');
    const signature = createHmac('sha256', keys.publicKeyPem).update(`${header}.${payload}`).digest('base64url');
    expect(verifyAccessToken(keys, `${header}.${payload}.${signature}`, NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects a short signature without throwing', () => {
    const token = signAccessToken(keys, { sub: 'user-1', sid: 'session-1', now: NOW });
    const [header, payload] = token.split('.');
    const short = Buffer.alloc(8).toString('base64url');
    expect(verifyAccessToken(keys, `${header}.${payload}.${short}`, NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('accepts a token signed by the previous public key', () => {
    const current = generateAuthJwtKeys('current');
    const previous = generateAuthJwtKeys('previous');
    const oldToken = signAccessToken(previous, { sub: 'user-1', sid: 'session-1', now: NOW });
    const fresh = signAccessToken(current, { sub: 'user-1', sid: 'session-1', now: NOW });
    const keysForVerify = [
      { kid: current.kid, publicKeyPem: current.publicKeyPem },
      { kid: previous.kid, publicKeyPem: previous.publicKeyPem },
    ];
    expect(verifyAccessToken(keysForVerify, oldToken, NOW).ok).toBe(true);
    expect(verifyAccessToken(keysForVerify, fresh, NOW).ok).toBe(true);
  });

  it('rejects a key pair that does not match', () => {
    const left = generateAuthJwtKeys('left');
    const right = generateAuthJwtKeys('right');
    expect(() =>
      assertAuthJwtConfig({
        AUTH_JWT_PRIVATE_KEY: left.privateKeyPem,
        AUTH_JWT_PUBLIC_KEY: right.publicKeyPem,
        AUTH_JWT_KID: 'left',
      }),
    ).toThrow(/does not match/);
  });

  it('rejects a tampered ES256 signature', () => {
    const token = signAccessToken(keys, { sub: 'user-1', sid: 'session-1', now: NOW });
    const parts = token.split('.');
    const raw = Buffer.from(parts[2] ?? '', 'base64url');
    raw[0] = (raw[0] ?? 0) ^ 0xff;
    expect(verifyAccessToken(keys, `${parts[0]}.${parts[1]}.${raw.toString('base64url')}`, NOW)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
});

function rawSigned(payload: Record<string, unknown>): string {
  const header = { alg: 'ES256', typ: 'JWT', kid: keys.kid };
  const signingInput = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
  const signature = createSign('SHA256')
    .update(signingInput)
    .sign({ key: keys.privateKeyPem, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${signature.toString('base64url')}`;
}
