import { ApiClientError, ConnectingFailedError } from '../api/errors';

/** True when two write bodies canonicalize to the same JSON. */
export function sameWriteBody(left: unknown, right: unknown): boolean {
  return canonical(left) === canonical(right);
}

function canonical(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonical(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

/** Connection failure and 409 idempotency_in_progress keep the form and the key. */
export function isHeldWrite(error: unknown): boolean {
  if (error instanceof ConnectingFailedError) {
    return true;
  }
  return (
    error instanceof ApiClientError &&
    (error.code === 'idempotency_in_progress' || error.copyKey === 'common.connecting.failed')
  );
}
