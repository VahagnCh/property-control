import { isUuid } from '../common/path-safety.js';
import { OCR_ERROR, ocrBadRequest, ocrUnprocessable } from './ocr-errors.js';
import type { OcrDecision } from './ocr.types.js';

const DECISION_KEYS = new Set(['suggestionId', 'action', 'editedValue', 'targetEntityId']);
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function parseDecisions(input: unknown): OcrDecision[] {
  assertNoDangerousKeys(input);
  const raw = Array.isArray(input) ? input : decisionsFromBody(input);
  if (raw.length === 0 || raw.length > 50) {
    throw ocrBadRequest(OCR_ERROR.decisionsInvalid, 'decisions must be a non-empty array.');
  }
  return raw.map((entry) => parseDecision(entry));
}

function decisionsFromBody(body: unknown): unknown[] {
  if (!isPlainObject(body)) {
    throw ocrBadRequest(OCR_ERROR.decisionsInvalid, 'Body must be an object.');
  }
  if (isAcceptAll(body)) {
    throw bulkAcceptAll();
  }
  if ('clientPriorValue' in body) {
    throw ocrUnprocessable(OCR_ERROR.clientPriorValueRejected, 'clientPriorValue is not accepted.');
  }
  for (const key of Object.keys(body)) {
    if (key !== 'decisions') {
      throw ocrBadRequest(OCR_ERROR.unknownField, 'Unknown field.');
    }
  }
  if (!Array.isArray(body.decisions)) {
    throw ocrBadRequest(OCR_ERROR.decisionsInvalid, 'decisions must be a non-empty array.');
  }
  return body.decisions;
}

function parseDecision(value: unknown): OcrDecision {
  if (!isPlainObject(value)) {
    throw ocrBadRequest(OCR_ERROR.suggestionInvalid, 'Each decision needs a suggestionId.');
  }
  if ('clientPriorValue' in value) {
    throw ocrUnprocessable(OCR_ERROR.clientPriorValueRejected, 'clientPriorValue is not accepted.');
  }
  if (isAcceptAll(value)) {
    throw bulkAcceptAll();
  }
  for (const key of Object.keys(value)) {
    if (!DECISION_KEYS.has(key)) {
      throw ocrBadRequest(OCR_ERROR.unknownField, 'Unknown field.');
    }
  }
  const suggestionId = value.suggestionId;
  if (typeof suggestionId !== 'string' || !isUuid(suggestionId)) {
    throw ocrBadRequest(OCR_ERROR.suggestionInvalid, 'Each decision needs a suggestionId.');
  }
  const action = value.action;
  if (action !== 'accept' && action !== 'reject' && action !== 'edit' && action !== 'replace') {
    throw ocrBadRequest(OCR_ERROR.actionInvalid, 'action must be accept, reject, edit, or replace.');
  }
  let targetEntityId: string | undefined;
  if ('targetEntityId' in value && value.targetEntityId !== undefined) {
    if (typeof value.targetEntityId !== 'string' || !isUuid(value.targetEntityId)) {
      throw ocrBadRequest(OCR_ERROR.targetInvalid, 'targetEntityId must be a UUID.');
    }
    targetEntityId = value.targetEntityId;
  }
  if (action === 'edit' && (!('editedValue' in value) || value.editedValue === undefined)) {
    throw ocrBadRequest(OCR_ERROR.editedValueRequired, 'Edit needs editedValue.');
  }
  return {
    suggestionId,
    action,
    editedValue: value.editedValue,
    targetEntityId,
  };
}

function isAcceptAll(value: Record<string, unknown>): boolean {
  return (
    value.acceptAll === true ||
    value.accept_all === true ||
    value.action === 'accept-all' ||
    value.action === 'accept_all'
  );
}

function bulkAcceptAll() {
  return ocrUnprocessable(OCR_ERROR.bulkAcceptRejected, 'Bulk accept-all is not accepted.');
}

function assertNoDangerousKeys(value: unknown, depth = 0): void {
  if (depth > 20) {
    throw ocrBadRequest(OCR_ERROR.decisionsInvalid, 'Invalid payload.');
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      assertNoDangerousKeys(entry, depth + 1);
    }
    return;
  }
  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) {
      throw ocrBadRequest(OCR_ERROR.unknownField, 'Unknown field.');
    }
    assertNoDangerousKeys((value as Record<string, unknown>)[key], depth + 1);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
