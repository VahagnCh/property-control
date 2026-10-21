import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';

/** Machine-readable `error` values. Clients match these, never the English message. */
export const OCR_ERROR = {
  tokenMissing: 'token_missing',
  tokenInvalid: 'token_invalid',
  tokenExpired: 'token_expired',
  invalidPath: 'invalid_path',
  invalidJson: 'invalid_json',
  payloadTooLarge: 'payload_too_large',
  notFound: 'not_found',
  forbidden: 'forbidden',
  ocrDisabled: 'ocr_disabled',
  ocrCapacity: 'ocr_capacity',
  jobExpired: 'job_expired',
  jobNotConfirmable: 'job_not_confirmable',
  decisionsInvalid: 'decisions_invalid',
  unknownField: 'unknown_field',
  suggestionInvalid: 'suggestion_invalid',
  actionInvalid: 'action_invalid',
  editedValueRequired: 'edited_value_required',
  targetInvalid: 'target_invalid',
  duplicateDecision: 'duplicate_decision',
  missingDecision: 'missing_decision',
  clientPriorValueRejected: 'client_prior_value_rejected',
  bulkAcceptRejected: 'bulk_accept_rejected',
  editedValueInvalid: 'edited_value_invalid',
  boundTargetImmutable: 'bound_target_immutable',
  targetRequired: 'target_required',
  targetVoided: 'target_voided',
  targetStatusUnknown: 'target_status_unknown',
  fieldAlreadySet: 'field_already_set',
  fieldPathUnknown: 'field_path_unknown',
  invalidStorageKey: 'invalid_storage_key',
} as const;

export interface OcrErrorBody {
  statusCode: number;
  error: string;
  message: string;
  suggestionId?: string;
  field?: string;
  module?: 'ocr';
}

export function ocrBody(
  statusCode: number,
  error: string,
  message: string,
  extra?: Record<string, unknown>,
): OcrErrorBody {
  return { statusCode, error, message, ...extra };
}

export function ocrBadRequest(
  error: string,
  message: string,
  extra?: Record<string, unknown>,
): BadRequestException {
  return new BadRequestException(ocrBody(400, error, message, extra));
}

export function ocrUnauthorized(error: string, message: string): UnauthorizedException {
  return new UnauthorizedException(ocrBody(401, error, message));
}

export function ocrForbidden(message: string): ForbiddenException {
  return new ForbiddenException(ocrBody(403, OCR_ERROR.forbidden, message));
}

export function ocrNotFound(message = 'Not found.'): NotFoundException {
  return new NotFoundException(ocrBody(404, OCR_ERROR.notFound, message));
}

export function ocrConflict(
  error: string,
  message: string,
  extra?: Record<string, unknown>,
): ConflictException {
  return new ConflictException(ocrBody(409, error, message, extra));
}

export function ocrGone(message: string): GoneException {
  return new GoneException(ocrBody(410, OCR_ERROR.jobExpired, message));
}

export function ocrUnprocessable(
  error: string,
  message: string,
  extra?: Record<string, unknown>,
): UnprocessableEntityException {
  return new UnprocessableEntityException(ocrBody(422, error, message, extra));
}

export function ocrCapacity(message: string): HttpException {
  return new HttpException(ocrBody(429, OCR_ERROR.ocrCapacity, message), HttpStatus.TOO_MANY_REQUESTS);
}
