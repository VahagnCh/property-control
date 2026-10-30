import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { MemoryIdempotencyKeys } from '../auth/idempotency-keys.js';
import { runIdempotent } from './run-idempotent.js';

const input = {
  userId: '00000000-0000-4000-8000-00000000000a',
  key: 'same-key-1',
  method: 'POST',
  route: 'POST /v1/properties',
  requestHash: 'hash-a',
  now: new Date('2026-10-29T12:00:00.000Z'),
  expiresAt: new Date('2026-10-30T12:00:00.000Z'),
};

describe('idempotent writes', () => {
  it('runs one write when two callers share a key and replays the stored response', async () => {
    const keys = new MemoryIdempotencyKeys();
    let calls = 0;
    const work = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { status: 201, body: { id: 'casa' } };
    };
    const [left, right] = await Promise.all([
      runIdempotent(keys, input, work),
      runIdempotent(keys, input, work),
    ]);
    expect(calls).toBe(1);
    expect(left).toEqual({ status: 201, body: { id: 'casa' } });
    expect(right).toMatchObject({ status: 201, body: { id: 'casa' }, replayed: true });
  });

  it('does not store a 401, so the same key can succeed after a refresh', async () => {
    const keys = new MemoryIdempotencyKeys();
    const rejected = await runIdempotent(keys, input, async () => ({
      status: 401,
      body: { error: 'token_expired' },
    }));
    expect(rejected.status).toBe(401);
    expect(keys.storedText()).not.toContain('token_expired');
    const created = await runIdempotent(keys, input, async () => ({ status: 201, body: { id: 'casa' } }));
    expect(created).toEqual({ status: 201, body: { id: 'casa' } });
  });

  it('does not store a 5xx, so the same key can succeed on the next attempt', async () => {
    const keys = new MemoryIdempotencyKeys();
    await expect(
      runIdempotent(keys, input, async () => {
        throw new Error('injected');
      }),
    ).rejects.toThrow('injected');
    const replay = await runIdempotent(keys, input, async () => ({ status: 201, body: { id: 'casa' } }));
    expect(replay).toEqual({ status: 201, body: { id: 'casa' } });
    expect(keys.storedText()).toContain('casa');
    expect(keys.storedText()).not.toContain('injected');
  });

  it('returns 409 while a reservation has no stored response and takes over after it expires', async () => {
    const keys = new MemoryIdempotencyKeys();
    const now = input.now;
    const planted = await keys.reserve({ ...input, expiresAt: new Date(now.getTime() + 60_000) });
    expect(planted.outcome).toBe('reserved');
    let calls = 0;
    try {
      await runIdempotent(keys, { ...input, now }, async () => {
        calls += 1;
        return { status: 201, body: { id: 'casa' } };
      });
      throw new Error('expected an in-progress reservation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        statusCode: 409,
        error: 'idempotency_in_progress',
      });
    }
    expect(calls).toBe(0);
    const later = new Date(now.getTime() + 60_001);
    const taken = await runIdempotent(
      keys,
      { ...input, now: later, expiresAt: new Date(later.getTime() + 60_000) },
      async () => {
        calls += 1;
        return { status: 201, body: { id: 'casa' } };
      },
    );
    expect(taken).toEqual({ status: 201, body: { id: 'casa' } });
    expect(calls).toBe(1);
    const replay = await runIdempotent(
      keys,
      { ...input, now: later, expiresAt: new Date(later.getTime() + 60_000) },
      async () => {
        calls += 1;
        return { status: 200, body: { id: 'other' } };
      },
    );
    expect(replay).toMatchObject({ status: 201, body: { id: 'casa' }, replayed: true });
    expect(calls).toBe(1);
  }, 20_000);

  it('EC-15.17 A key whose reservation has no stored response (still in progress, or left by a crash) never replays as 202 or as a stored success. It returns 409 idempotency_in_progress, and an expired reservation may be taken over with the same key and body. The client rule for that 409 is EC-15.2.', async () => {
    const keys = new MemoryIdempotencyKeys();
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    let started = (): void => undefined;
    const startedGate = new Promise<void>((resolve) => {
      started = resolve;
    });
    const first = runIdempotent(keys, input, async () => {
      calls += 1;
      started();
      await gate;
      return { status: 201, body: { id: 'casa' } };
    });
    await startedGate;
    const held = runIdempotent(keys, input, async () => {
      calls += 1;
      return { status: 201, body: { id: 'other' } };
    });
    try {
      await held;
      throw new Error('expected an in-progress reservation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        statusCode: 409,
        error: 'idempotency_in_progress',
      });
    }
    expect(calls).toBe(1);
    expect(keys.storedText()).not.toContain('idempotency_in_progress');
    release();
    await expect(first).resolves.toEqual({ status: 201, body: { id: 'casa' } });
    const replay = await runIdempotent(keys, input, async () => {
      calls += 1;
      return { status: 200, body: { id: 'other' } };
    });
    expect(replay).toMatchObject({ status: 201, body: { id: 'casa' }, replayed: true });
    expect(calls).toBe(1);
  }, 20_000);

  it('rejects the same key with a different hash', async () => {
    const keys = new MemoryIdempotencyKeys();
    await runIdempotent(keys, input, async () => ({ status: 201, body: { id: 'casa' } }));
    await expect(runIdempotent(keys, { ...input, requestHash: 'hash-b' }, async () => ({ status: 201, body: { id: 'other' } }))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
