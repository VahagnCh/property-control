import { copyText, type CopyKey } from '../copy/userFacing';

/**
 * Clients match `error`, never the English `message`, and never a URL.
 * Codes with a UX string use that key. Anything else uses `common.error`.
 * A 404 is not-found copy for a non-member and for an unknown resource.
 */
const COPY_BY_CODE: Partial<Record<string, CopyKey>> = {
  edited_value_invalid: 'ocr.edit.invalid',
  field_already_set: 'ocr.conflict',
  saved_value_conflict: 'ocr.conflict',
  bound_target_immutable: 'ocr.target.locked',
  target_required: 'ocr.target.required',
  target_voided: 'ocr.target.voided',
  target_status_unknown: 'ocr.target.unchecked',
  bulk_accept_rejected: 'ocr.bulk.refused',
  job_not_confirmable: 'ocr.job.notSuggested',
  job_expired: 'ocr.job.expired',
  next_due_date_out_of_range: 'obligation.nextDueDate.invalid',
  not_found: 'common.notFound',
  idempotency_key_reused: 'idempotency.keyReused',
};

const HTTP_REASON = new Set([
  'Bad Request',
  'Unauthorized',
  'Forbidden',
  'Not Found',
  'Conflict',
  'Gone',
  'Unprocessable Entity',
  'Too Many Requests',
  'Internal Server Error',
]);

export function readErrorCode(body: unknown, status: number): string {
  if (status === 404) {
    return 'not_found';
  }
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === 'string' && error !== '' && !HTTP_REASON.has(error)) {
      return error;
    }
  }
  return 'unknown';
}

export function copyKeyForApiError(code: string, status: number): CopyKey {
  if (status === 404 || code === 'not_found') {
    return 'common.notFound';
  }
  return COPY_BY_CODE[code] ?? 'common.error';
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly copyKey: CopyKey;
  readonly status: number | null;

  constructor(code: string, copyKey: CopyKey, status: number | null) {
    super(copyText(copyKey));
    this.name = 'ApiClientError';
    this.code = code;
    this.copyKey = copyKey;
    this.status = status;
  }
}

/** 409 idempotency_key_reused. Reenviar mints a new key; this does not. */
export class IdempotencyKeyReusedError extends ApiClientError {
  constructor() {
    super('idempotency_key_reused', 'idempotency.keyReused', 409);
    this.name = 'IdempotencyKeyReusedError';
  }
}

export class ConnectingFailedError extends ApiClientError {
  constructor() {
    super('connecting_failed', 'common.connecting.failed', null);
    this.name = 'ConnectingFailedError';
  }
}

export class SessionExpiredError extends ApiClientError {
  constructor() {
    super('sign_in_required', 'common.error', 401);
    this.name = 'SessionExpiredError';
  }
}
