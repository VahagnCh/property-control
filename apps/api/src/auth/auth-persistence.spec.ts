import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { TEST_SERVER_SECRET } from './server-secret.js';
import { MemoryIdempotencyKeys } from './idempotency-keys.js';
import { MemoryRateLimits, authSubjectHmac } from './rate-limit.js';
import { MemoryRefreshTokens, hashToken } from './refresh-tokens.js';

const USER = '00000000-0000-4000-8000-00000000000a';
const NOW = new Date('2026-10-21T18:00:00.000Z');
const UUID_V4 = '123e4567-e89b-42d3-a456-426614174000';

function idempotencyInput(overrides: Partial<{
  userId: string | null;
  emailHmac: string | null;
  key: string;
  method: string;
  route: string;
  requestHash: string;
}> = {}) {
  return {
    userId: USER,
    key: 'consent-key',
    method: 'POST',
    route: 'POST /v1/me/consent',
    requestHash: 'hash-a',
    now: NOW,
    expiresAt: new Date(NOW.getTime() + 60_000),
    ...overrides,
  };
}

describe('refresh token rotation', () => {
  it('returns the same pair inside 30 seconds and stores only ciphertext', async () => {
    const tokens = new MemoryRefreshTokens(TEST_SERVER_SECRET);
    await tokens.issue({ userId: USER, rawToken: 'root-token', now: NOW });
    const [left, right] = await Promise.all([
      tokens.rotate({ rawToken: 'root-token', now: NOW, nextRawToken: 'next-a' }),
      tokens.rotate({ rawToken: 'root-token', now: NOW, nextRawToken: 'next-b' }),
    ]);
    expect([left.outcome, right.outcome].sort()).toEqual(['grace', 'rotated']);
    if (left.outcome === 'expired' || right.outcome === 'expired') {
      throw new Error('expected a pair');
    }
    if (left.outcome === 'rotated' || left.outcome === 'grace') {
      expect(left.refreshToken).toBe(right.outcome === 'rotated' || right.outcome === 'grace' ? right.refreshToken : '');
    }
    const pair = left.outcome === 'rotated' || left.outcome === 'grace' ? left.refreshToken : '';
    expect(['next-a', 'next-b']).toContain(pair);
    expect(tokens.list()).toHaveLength(2);
    const storedGrace = tokens.list().map((row) => row.graceRefreshToken).find((value) => value !== null);
    expect(storedGrace?.startsWith('v1.')).toBe(true);
    expect(storedGrace).not.toContain(pair);
    expect(JSON.stringify(tokens.list())).not.toContain(pair);

    const again = await tokens.rotate({
      rawToken: 'root-token',
      now: new Date(NOW.getTime() + 1000),
      nextRawToken: 'next-c',
    });
    expect(again).toMatchObject({ outcome: 'grace', refreshToken: pair });

    const at29 = await tokens.rotate({
      rawToken: 'root-token',
      now: new Date(NOW.getTime() + 29_000),
      nextRawToken: 'next-e',
    });
    expect(at29).toMatchObject({ outcome: 'grace', refreshToken: pair });

    const reused = await tokens.rotate({
      rawToken: 'root-token',
      now: new Date(NOW.getTime() + 31_000),
      nextRawToken: 'next-d',
    });
    expect(reused.outcome).toBe('reused');
    expect(tokens.list().every((row) => row.revokedAt)).toBe(true);
    expect(tokens.list().every((row) => row.graceRefreshToken === null)).toBe(true);
  });

  it('does not return a successor that has already been used', async () => {
    const tokens = new MemoryRefreshTokens(TEST_SERVER_SECRET);
    await tokens.issue({ userId: USER, rawToken: 'root-token', now: NOW });
    const rotated = await tokens.rotate({ rawToken: 'root-token', now: NOW, nextRawToken: 'next-a' });
    expect(rotated.outcome).toBe('rotated');
    const usedSuccessor = await tokens.rotate({
      rawToken: 'next-a',
      now: new Date(NOW.getTime() + 1_000),
      nextRawToken: 'next-b',
    });
    expect(usedSuccessor.outcome).toBe('rotated');
    const again = await tokens.rotate({
      rawToken: 'root-token',
      now: new Date(NOW.getTime() + 2_000),
      nextRawToken: 'next-c',
    });
    expect(again.outcome).toBe('reused');
    expect(JSON.stringify(again)).not.toContain('next-a');
    const root = tokens.list().find((row) => row.tokenHash === hashToken('root-token'));
    expect(root?.graceRefreshToken).toBeNull();
  });

  it('reports an expired token without revoking the family', async () => {
    const tokens = new MemoryRefreshTokens(TEST_SERVER_SECRET);
    const issued = await tokens.issue({ userId: USER, rawToken: 'root-token', now: NOW });
    const later = new Date(issued.expiresAt.getTime() + 1000);
    const result = await tokens.rotate({ rawToken: 'root-token', now: later, nextRawToken: 'next' });
    expect(result.outcome).toBe('expired');
    expect(tokens.list().every((row) => row.revokedAt === null)).toBe(true);
  });
});

describe('idempotency keys', () => {
  it('replays the same hash, rejects a different hash, and waits while in progress', async () => {
    const keys = new MemoryIdempotencyKeys();
    const input = idempotencyInput();
    const reserved = await keys.reserve(input);
    expect(reserved.outcome).toBe('reserved');
    expect((await keys.reserve(input)).outcome).toBe('in_progress');
    if (reserved.outcome !== 'reserved') {
      return;
    }
    await keys.complete(reserved.id, 201, { id: 'consent-1' });
    expect(await keys.reserve(input)).toEqual({
      outcome: 'replay',
      responseStatus: 201,
      responseBody: { id: 'consent-1' },
    });
    await expect(keys.reserve({ ...input, requestHash: 'hash-b' })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('accepts a UUID v4 and the length boundaries, and rejects a short or illegal key', async () => {
    const keys = new MemoryIdempotencyKeys();
    expect(UUID_V4).toHaveLength(36);
    expect((await keys.reserve(idempotencyInput({ key: UUID_V4 }))).outcome).toBe('reserved');
    expect((await keys.reserve(idempotencyInput({ key: 'a'.repeat(8), route: 'POST /v1/eight' }))).outcome).toBe(
      'reserved',
    );
    expect((await keys.reserve(idempotencyInput({ key: 'b'.repeat(128), route: 'POST /v1/long' }))).outcome).toBe(
      'reserved',
    );
    for (const key of ['a'.repeat(7), 'a'.repeat(129), 'bad key!', 'has.a.dot', 'slash/key']) {
      await expect(keys.reserve(idempotencyInput({ key }))).rejects.toBeInstanceOf(BadRequestException);
      try {
        await keys.reserve(idempotencyInput({ key }));
      } catch (error) {
        expect((error as BadRequestException).getResponse()).toMatchObject({
          statusCode: 400,
          error: 'idempotency_key_invalid',
        });
      }
    }
  });

  it('treats the same key on another route as a new request', async () => {
    const keys = new MemoryIdempotencyKeys();
    const key = 'route-key-1';
    const payments = await keys.reserve(
      idempotencyInput({ key, route: 'POST /v1/payments', requestHash: 'hash-a' }),
    );
    expect(payments.outcome).toBe('reserved');
    if (payments.outcome !== 'reserved') {
      return;
    }
    await keys.complete(payments.id, 201, { ok: true });
    const sameRoute = await keys.reserve(
      idempotencyInput({ key, route: 'POST /v1/payments', requestHash: 'hash-a' }),
    );
    expect(sameRoute.outcome).toBe('replay');
    const otherRoute = await keys.reserve(
      idempotencyInput({ key, route: 'POST /v1/properties', requestHash: 'hash-a' }),
    );
    expect(otherRoute.outcome).toBe('reserved');
    const otherHash = await keys.reserve(
      idempotencyInput({ key, route: 'POST /v1/obligations', requestHash: 'hash-b' }),
    );
    expect(otherHash.outcome).toBe('reserved');
  });

  it('stores an email HMAC scope without the plain email', async () => {
    const keys = new MemoryIdempotencyKeys();
    const email = 'person@example.com';
    const emailHmac = authSubjectHmac(email, TEST_SERVER_SECRET);
    const reserved = await keys.reserve(
      idempotencyInput({
        userId: null,
        emailHmac,
        key: UUID_V4,
        route: 'POST /v1/auth/code',
      }),
    );
    expect(reserved.outcome).toBe('reserved');
    expect(keys.storedText()).not.toContain(email);
    expect(keys.storedText()).toContain(emailHmac);
  });
});

describe('auth code rate limit', () => {
  it('allows the limit and stores a keyed HMAC instead of the email', async () => {
    const limits = new MemoryRateLimits(TEST_SERVER_SECRET);
    const email = 'person@example.com';
    const base = { subject: email, purpose: 'login', success: false, now: NOW, limit: 3, windowMs: 60_000 };
    expect((await limits.record(base)).allowed).toBe(true);
    expect((await limits.record(base)).allowed).toBe(true);
    expect((await limits.record(base)).allowed).toBe(true);
    const blocked = await limits.record({ ...base, now: new Date(NOW.getTime() + 1000) });
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(59);
    expect(limits.attemptCount()).toBe(4);
    const still = await limits.record({ ...base, now: new Date(NOW.getTime() + 2000) });
    expect(still.allowed).toBe(false);
    expect(still.retryAfterSeconds).toBe(58);
    expect(limits.storedText()).not.toContain(email);
    expect(limits.storedText()).toContain(authSubjectHmac(email, TEST_SERVER_SECRET));
  });
});
