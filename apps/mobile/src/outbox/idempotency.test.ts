import { COPY } from '../copy/userFacing';
import {
  beginIdempotentWrite,
  createIdempotencyKey,
  pressRecordSubmit,
  releaseSubmitForRetry,
  SubmitGate,
} from './idempotency';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('idempotency keys', () => {
  it('reuses the same key on retry and mints a new key for a new write', () => {
    let calls = 0;
    const random = () => {
      calls += 1;
      return `key-${calls}`;
    };
    const first = beginIdempotentWrite(null, random);
    const retry = beginIdempotentWrite(first, random);
    const third = beginIdempotentWrite(retry, random);
    const another = beginIdempotentWrite(null, random);

    expect(first).toEqual({ key: 'key-1', attempts: 1 });
    expect(retry).toEqual({ key: 'key-1', attempts: 2 });
    expect(third).toEqual({ key: 'key-1', attempts: 3 });
    expect(another).toEqual({ key: 'key-2', attempts: 1 });
    expect(calls).toBe(2);
  });

  it('mints one key for a double tap and reuses it after the submit is released', () => {
    let calls = 0;
    const random = () => {
      calls += 1;
      return `submit-${calls}`;
    };
    const idle: SubmitGate = { key: null, inFlight: false };
    const first = pressRecordSubmit(idle, random);
    const second = pressRecordSubmit(first.gate, random);
    expect(first.accepted).toBe(true);
    expect(first.gate).toEqual({ key: 'submit-1', inFlight: true });
    expect(second.accepted).toBe(false);
    expect(second.gate).toBe(first.gate);
    expect(calls).toBe(1);

    const released = releaseSubmitForRetry(first.gate);
    const retried = pressRecordSubmit(released, random);
    expect(retried.accepted).toBe(true);
    expect(retried.gate.key).toBe('submit-1');
    expect(calls).toBe(1);
  });

  it('maps a value that is not a UUID to catalog copy', () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { randomUUID: () => 'not-a-uuid' },
    });
    try {
      const error = (() => {
        try {
          createIdempotencyKey();
          return undefined;
        } catch (caught) {
          return caught;
        }
      })();
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(COPY['common.error']);
      expect((error as Error).message).not.toMatch(/uuid|crypto/i);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: original });
    }
  });

  it('creates a uuid when no random function is injected', () => {
    const key = createIdempotencyKey();
    expect(key).toMatch(UUID);
    const write = beginIdempotentWrite(null);
    expect(write.key).toMatch(UUID);
    expect(beginIdempotentWrite(write).key).toBe(write.key);
  });
});
