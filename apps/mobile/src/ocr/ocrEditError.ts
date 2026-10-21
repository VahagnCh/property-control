import { SCREEN_STATE_COPY, copyText } from '../copy/userFacing';

export type OcrMappedError = {
  key:
    | 'ocr.edit.invalid'
    | 'ocr.conflict'
    | 'ocr.clientPriorValue'
    | 'ocr.target.locked'
    | 'ocr.target.required'
    | 'ocr.target.voided'
    | 'ocr.target.unchecked'
    | 'ocr.bulk.refused'
    | 'ocr.job.notSuggested'
    | 'ocr.job.expired'
    | 'obligation.nextDueDate.invalid'
    | 'error.generic';
  message: string;
  refresh: boolean;
  /** HTTP status from the response. A mismatched status is not mapped. */
  status: 409 | 410 | 422;
  suggestionId?: string;
  field?: string;
};

/**
 * Confirm failures the server identifies today.
 * `field_already_set` and `next_due_date_out_of_range` are domain codes.
 * The other branches match status plus the message the server returns.
 * TODO: when Backend ships an error-codes PR, match the remaining cases on
 * `error` instead of the English message.
 */
export const FIELD_ALREADY_SET_CODE = 'field_already_set';
export const FIELD_ALREADY_SET_MESSAGE = 'The field already has a saved value.';
export const CLIENT_PRIOR_VALUE_MESSAGE = 'clientPriorValue is not accepted.';
export const MISSING_DECISION_MESSAGE =
  'Every suggestion needs an explicit accept, replace, reject, or edit.';
export const EDITED_VALUE_MESSAGE = 'editedValue does not match fieldPath.';
export const BOUND_TARGET_MESSAGE = 'A bound target cannot be changed.';
export const MISSING_TARGET_MESSAGE = 'A suggestion needs targetEntityId before it can be accepted.';
export const VOIDED_PAYMENT_MESSAGE = 'A voided payment cannot be a confirm target.';
export const UNCHECKED_PAYMENT_MESSAGE = 'A payment target must be checked before confirm.';
export const BULK_ACCEPT_MESSAGE = 'Bulk accept-all is not accepted.';
export const NEXT_DUE_DATE_MESSAGE = 'nextDueDate is outside the allowed range.';
export const NEXT_DUE_DATE_CODE = 'next_due_date_out_of_range';
export const JOB_NOT_SUGGESTED_MESSAGE = 'Only a job in status suggested can be confirmed.';
export const JOB_EXPIRED_MESSAGE = 'OCR job has expired.';

const HTTP_ERROR_NAMES = new Set(['Unprocessable Entity', 'Conflict', 'Bad Request', 'Gone']);

export type OcrConfirmErrorInput = {
  status?: number;
  statusCode?: number;
  code?: string | null;
  error?: string | null;
  message?: string | null;
  suggestionId?: string;
  field?: string;
};

type MappedKey = Exclude<OcrMappedError['key'], 'ocr.clientPriorValue' | 'error.generic'>;

function failure(
  key: OcrMappedError['key'],
  status: OcrMappedError['status'],
  refresh: boolean,
  input: OcrConfirmErrorInput,
): OcrMappedError {
  const message =
    key === 'error.generic' || key === 'ocr.clientPriorValue' ? SCREEN_STATE_COPY.error : copyText(key as MappedKey);
  const mapped: OcrMappedError = { key, message, refresh, status };
  if (input.suggestionId) {
    mapped.suggestionId = input.suggestionId;
  }
  if (input.field) {
    mapped.field = input.field;
  }
  return mapped;
}

/**
 * Maps a confirm failure.
 * 409 `field_already_set` is `ocr.conflict` and asks the screen to refresh the rows.
 * 409 `Only a job in status suggested can be confirmed.` is a different conflict.
 * A bound target is `ocr.target.locked`, not the invalid-value copy.
 */
export function mapOcrConfirmError(input: OcrConfirmErrorInput): OcrMappedError | null {
  const status = httpStatus(input);
  const code = domainCode(input.code ?? input.error);
  if (status === 409 && code === FIELD_ALREADY_SET_CODE) {
    return failure('ocr.conflict', 409, true, input);
  }
  if (status === 409 && input.message === JOB_NOT_SUGGESTED_MESSAGE) {
    return failure('ocr.job.notSuggested', 409, true, input);
  }
  if (status === 410 && input.message === JOB_EXPIRED_MESSAGE) {
    return failure('ocr.job.expired', 410, false, input);
  }
  if (status !== 422) {
    return null;
  }
  if (input.message === CLIENT_PRIOR_VALUE_MESSAGE) {
    return failure('ocr.clientPriorValue', 422, false, input);
  }
  if (input.message === MISSING_DECISION_MESSAGE) {
    console.error('OCR confirm is missing a decision.', input.suggestionId ?? null);
    return failure('error.generic', 422, false, input);
  }
  if (input.message === BOUND_TARGET_MESSAGE) {
    return failure('ocr.target.locked', 422, false, input);
  }
  if (input.message === EDITED_VALUE_MESSAGE) {
    return failure('ocr.edit.invalid', 422, false, input);
  }
  if (input.message === MISSING_TARGET_MESSAGE) {
    return failure('ocr.target.required', 422, false, input);
  }
  if (input.message === VOIDED_PAYMENT_MESSAGE) {
    return failure('ocr.target.voided', 422, false, input);
  }
  if (input.message === UNCHECKED_PAYMENT_MESSAGE) {
    return failure('ocr.target.unchecked', 422, false, input);
  }
  if (input.message === BULK_ACCEPT_MESSAGE) {
    return failure('ocr.bulk.refused', 422, false, input);
  }
  if (input.message === NEXT_DUE_DATE_MESSAGE || code === NEXT_DUE_DATE_CODE) {
    return failure('obligation.nextDueDate.invalid', 422, false, input);
  }
  return null;
}

function httpStatus(input: OcrConfirmErrorInput): number | null {
  if (typeof input.statusCode === 'number') {
    return input.statusCode;
  }
  if (typeof input.status === 'number') {
    return input.status;
  }
  return null;
}

function domainCode(code: string | null | undefined): string | null {
  if (!code || HTTP_ERROR_NAMES.has(code)) {
    return null;
  }
  return code;
}
