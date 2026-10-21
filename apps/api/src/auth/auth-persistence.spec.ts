import { UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { MemoryIdempotencyKeys } from './idempotency-keys.js';
import { MemoryRateLimits } from './rate-limit.js';
import { MemoryRefreshTokens, REFRESH_GRACE_MS } from './refresh-tokens.js';

const USER = '00000000-0000-4000-8000-00000000000a';
const NOW = new Date('2026-10-21T18:00:00.000Z');

describe('refresh token rotation', () => {
  it('lets one refresh win and returns that same pair inside the grace window', async () => {
    const tokens = new MemoryRefreshTokens();
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

    const again = await tokens.rotate({
      rawToken: 'root-token',
      now: new Date(NOW.getTime() + 1000),
      nextRawToken: 'next-c',
    });
    expect(again).toMatchObject({ outcome: 'grace', refreshToken: pair });
    expect(tokens.list()).toHaveLength(2);

    const reused = await tokens.rotate({
      rawToken: 'root-token',
      now: new Date(NOW.getTime() + REFRESH_GRACE_MS + 1),
      nextRawToken: 'next-d',
    });
    expect(reused.outcome).toBe('reused');
    expect(tokens.list().every((row) => row.revokedAt)).toBe(true);
    expect(tokens.list()).toHaveLength(2);
  });

  it('reports an expired token without revoking the family', async () => {
    const tokens = new MemoryRefreshTokens();
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
    const input = {
      userId: USER,
      key: 'key-1',
      route: 'POST /v1/me/consent',
      requestHash: 'hash-a',
      now: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000),
    };
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
});

describe('auth code rate limit', () => {
  it('allows the limit and then returns Retry-After seconds', async () => {
    const limits = new MemoryRateLimits();
    const base = { subject: 'person@example.com', purpose: 'login', success: false, now: NOW, limit: 3, windowMs: 60_000 };
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
  });
});
