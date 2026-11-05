import { SCREEN_STATE_COPY, copyText, type CopyKey } from '../copy/userFacing';
import { API_ERROR_CODES } from './contract';

/**
 * Clients match `error`, never the English `message`, and never a URL.
 * Codes with a UX string use that key. Anything else uses `err.generic`.
 * Every 404 uses the same not-found copy, except an OCR path, which uses `common.unavailable`.
 */
const COPY_BY_CODE: Partial<Record<string, CopyKey>> = {
  edited_value_invalid: 'ocr.edit.invalid',
  field_already_set: 'ocr.conflict',
  saved_value_conflict: 'ocr.conflict',
  bound_target_immutable: 'ocr.target.locked',
  target_required: 'ocr.target.required',
  target_voided: 'ocr.target.voided',
  target_status_unknown: 'ocr.target.unknown',
  bulk_accept_rejected: 'ocr.confirm.failed',
  job_not_confirmable: 'ocr.job.notSuggested',
  job_expired: 'ocr.job.expired',
  next_due_date_out_of_range: 'obligation.nextDueDate.outOfRange',
  not_found: 'err.notFound',
  idempotency_key_reused: 'pay.sync.conflict',
  'auth.email_invalid': 'auth.email.invalid',
  'auth.code_invalid': 'auth.code.wrong',
  'auth.rate_limited': 'auth.code.wait',
  'auth.unavailable': 'common.connecting.failed',
  'auth.refresh_invalid': 'auth.session.expired',
  'auth.refresh_reused': 'auth.session.expired',
  idempotency_in_progress: 'common.connecting.failed',
  payment_voided: 'pay.void.noEdit',
  already_voided: 'pay.void.alreadyVoided',
  conflict: 'err.generic',
  forbidden: 'err.forbidden',
  viewer: 'err.forbidden',
};

const KNOWN_ERROR_CODES = new Set<string>(API_ERROR_CODES);

/** Only codes from the API contract are kept. Anything else is `unknown`. */
export function readErrorCode(body: unknown, status: number): string {
  if (status === 404) {
    return 'not_found';
  }
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === 'string' && KNOWN_ERROR_CODES.has(error)) {
      return error;
    }
  }
  return 'unknown';
}

export function copyKeyForApiError(code: string, status: number, path = ''): CopyKey {
  if ((status === 404 || code === 'not_found') && path.includes('/ocr')) {
    return 'common.unavailable';
  }
  if (status === 404 || code === 'not_found') {
    return 'err.notFound';
  }
  return COPY_BY_CODE[code] ?? 'err.generic';
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly copyKey: CopyKey;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;
  readonly retryLabel: string | null;

  constructor(
    code: string,
    copyKey: CopyKey,
    status: number | null,
    retryAfterSeconds: number | null = null,
  ) {
    super(copyText(copyKey));
    this.name = 'ApiClientError';
    this.code = code;
    this.copyKey = copyKey;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.retryLabel = copyKey === 'common.connecting.failed' ? SCREEN_STATE_COPY.retry : null;
  }
}

/**
 * A definite 2xx or 4xx drops the pending key. 409 `idempotency_in_progress`
 * does not: it is not stored, so the same key and body are sent again.
 * A 5xx does not drop the key either.
 */
export function releasesIdempotencyKey(status: number, code: string): boolean {
  if (code === 'idempotency_in_progress') {
    return false;
  }
  return (status >= 200 && status < 300) || (status >= 400 && status < 500);
}

/** 409 idempotency_key_reused. A later submit mints a new key; this 4xx is definite. */
export class IdempotencyKeyReusedError extends ApiClientError {
  constructor() {
    super('idempotency_key_reused', 'pay.sync.conflict', 409);
    this.name = 'IdempotencyKeyReusedError';
  }
}

export class ConnectingFailedError extends ApiClientError {
  readonly retryLabel = SCREEN_STATE_COPY.retry;
  readonly idempotencyKey: string | null;

  constructor(idempotencyKey: string | null) {
    super('connecting_failed', 'common.connecting.failed', null);
    this.name = 'ConnectingFailedError';
    this.idempotencyKey = idempotencyKey;
  }
}

export class SessionExpiredError extends ApiClientError {
  constructor() {
    super('sign_in_required', 'auth.session.expired', 401);
    this.name = 'SessionExpiredError';
  }
}
