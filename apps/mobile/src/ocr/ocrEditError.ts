import { SCREEN_STATE_COPY, copyText } from '../copy/userFacing';

export type OcrMappedError = {
  key: 'ocr.edit.invalid' | 'ocr.field.alreadySet' | 'ocr.clientPriorValue' | 'error.generic';
  message: string;
  refresh: boolean;
  /** HTTP status from the PR #3 body. Mapping ignores a mismatched status. */
  status: 409 | 422;
  suggestionId?: string;
  field?: string;
};

/**
 * PR #3 at 743ea24. `field_already_set` is the only confirm conflict that
 * carries a domain `error` code. The two 422s below have no domain code;
 * the message is the identifier the server actually returns.
 */
export const FIELD_ALREADY_SET_CODE = 'field_already_set';
export const FIELD_ALREADY_SET_MESSAGE = 'The field already has a saved value.';
export const CLIENT_PRIOR_VALUE_MESSAGE = 'clientPriorValue is not accepted.';
export const MISSING_DECISION_MESSAGE =
  'Every suggestion needs an explicit accept, replace, reject, or edit.';
export const EDITED_VALUE_MESSAGE = 'editedValue does not match fieldPath.';
export const BOUND_TARGET_MESSAGE = 'A bound target cannot be changed.';

const HTTP_ERROR_NAMES = new Set(['Unprocessable Entity', 'Conflict', 'Bad Request']);

export type OcrConfirmErrorInput = {
  status?: number;
  statusCode?: number;
  code?: string | null;
  error?: string | null;
  message?: string | null;
  suggestionId?: string;
  field?: string;
};

/**
 * Maps a confirm failure from the PR #3 response body.
 * `field_already_set` is 409 and asks for a refresh.
 * `clientPriorValue` is 422 and is identified by its message.
 * A missing decision is 422, names `suggestionId`, and is logged as a client bug.
 * A bad editedValue is 422 with `editedValue does not match fieldPath.`
 */
export function mapOcrConfirmError(input: OcrConfirmErrorInput): OcrMappedError | null {
  const status = httpStatus(input);
  const code = domainCode(input.code ?? input.error);
  if (status === 409 && code === FIELD_ALREADY_SET_CODE) {
    return {
      key: 'ocr.field.alreadySet',
      message: copyText('ocr.field.alreadySet'),
      refresh: true,
      status: 409,
      suggestionId: input.suggestionId,
      field: input.field,
    };
  }
  if (status !== 422) {
    return null;
  }
  if (input.message === CLIENT_PRIOR_VALUE_MESSAGE) {
    return {
      key: 'ocr.clientPriorValue',
      message: SCREEN_STATE_COPY.error,
      refresh: false,
      status: 422,
    };
  }
  if (input.message === MISSING_DECISION_MESSAGE) {
    console.error('OCR confirm is missing a decision.', input.suggestionId ?? null);
    return {
      key: 'error.generic',
      message: SCREEN_STATE_COPY.error,
      refresh: false,
      status: 422,
      suggestionId: input.suggestionId,
    };
  }
  if (input.message === EDITED_VALUE_MESSAGE || input.message === BOUND_TARGET_MESSAGE) {
    return {
      key: 'ocr.edit.invalid',
      message: copyText('ocr.edit.invalid'),
      refresh: false,
      status: 422,
      suggestionId: input.suggestionId,
      field: input.field,
    };
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
