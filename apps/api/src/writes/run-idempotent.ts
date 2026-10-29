import { ConflictException, HttpException } from '@nestjs/common';
import type { IdempotencyInput, IdempotencyStore, ReserveResult } from '../auth/idempotency-keys.js';
import { isReplayableStatus } from '../auth/idempotency-keys.js';

export interface IdempotentResult {
  status: number;
  body: unknown;
}

const WAIT_MS = 5_000;
const WAIT_STEP_MS = 15;

/**
 * One write per user, route, and key. A stored 2xx or 4xx is replayed.
 * A 5xx releases the reservation so the same key can run again.
 * A second caller with the same hash waits for that result instead of inserting twice.
 */
export async function runIdempotent(
  store: IdempotencyStore,
  input: IdempotencyInput,
  work: () => Promise<IdempotentResult>,
): Promise<IdempotentResult> {
  const claimed = await claim(store, input);
  if (claimed.outcome === 'replay') {
    return { status: claimed.responseStatus, body: claimed.responseBody };
  }
  if (claimed.outcome !== 'reserved') {
    throw new ConflictException({
      statusCode: 409,
      error: 'idempotency_in_progress',
      message: 'This idempotency key is still in progress.',
    });
  }
  try {
    const result = await work();
    if (!isReplayableStatus(result.status)) {
      await store.release(claimed.id);
      return result;
    }
    await store.complete(claimed.id, result.status, result.body);
    return result;
  } catch (error) {
    const http = httpFailure(error);
    if (http && isReplayableStatus(http.status)) {
      await store.complete(claimed.id, http.status, http.body);
    } else {
      await store.release(claimed.id);
    }
    throw error;
  }
}

async function claim(store: IdempotencyStore, input: IdempotencyInput): Promise<ReserveResult> {
  const deadline = Date.now() + WAIT_MS;
  let result = await store.reserve(input);
  while (result.outcome === 'in_progress' && Date.now() < deadline) {
    await delay(WAIT_STEP_MS);
    result = await store.reserve(input);
  }
  return result;
}

function httpFailure(error: unknown): { status: number; body: unknown } | null {
  if (!(error instanceof HttpException)) {
    return null;
  }
  const status = error.getStatus();
  const response = error.getResponse();
  const body = typeof response === 'string' ? { statusCode: status, message: response } : response;
  return { status, body };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
