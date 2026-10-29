export type IdempotentWrite = {
  key: string;
  attempts: number;
};

export type SubmitGate = {
  key: string | null;
  inFlight: boolean;
};

/**
 * Guarded UUID. This does not use Math.random, and it does not import
 * expo-crypto while globalThis.crypto.randomUUID is present.
 */
export function createIdempotencyKey(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID !== 'function') {
    throw new Error('crypto.randomUUID is not available');
  }
  return randomUUID.call(globalThis.crypto);
}

/**
 * First call mints a key. A retry of the same write passes the previous
 * attempt and reuses that key. A new write passes null and gets a new key.
 */
export function beginIdempotentWrite(
  previous: IdempotentWrite | null,
  random: () => string = createIdempotencyKey,
): IdempotentWrite {
  if (previous) {
    return { key: previous.key, attempts: previous.attempts + 1 };
  }
  return { key: random(), attempts: 1 };
}

/**
 * The first tap mints one key and marks the submit in flight.
 * A second tap while in flight is ignored and does not mint another key.
 * After releaseSubmitForRetry, the next tap reuses the same key.
 */
export function pressRecordSubmit(
  gate: SubmitGate,
  random: () => string = createIdempotencyKey,
): { gate: SubmitGate; accepted: boolean } {
  if (gate.inFlight) {
    return { gate, accepted: false };
  }
  const key = gate.key ?? random();
  return { gate: { key, inFlight: true }, accepted: true };
}

export function releaseSubmitForRetry(gate: SubmitGate): SubmitGate {
  return { key: gate.key, inFlight: false };
}
