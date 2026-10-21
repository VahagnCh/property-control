import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { isUuid } from '../common/path-safety.js';
import type { OcrDecision } from './ocr.types.js';

const DECISION_KEYS = new Set(['suggestionId', 'action', 'editedValue', 'targetEntityId']);
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function parseDecisions(input: unknown): OcrDecision[] {
  assertNoDangerousKeys(input);
  const raw = Array.isArray(input) ? input : decisionsFromBody(input);
  if (raw.length === 0 || raw.length > 50) {
    throw new BadRequestException('decisions must be a non-empty array.');
  }
  return raw.map((entry) => parseDecision(entry));
}

function decisionsFromBody(body: unknown): unknown[] {
  if (!isPlainObject(body)) {
    throw new BadRequestException('Body must be an object.');
  }
  if (isAcceptAll(body)) {
    throw bulkAcceptAll();
  }
  for (const key of Object.keys(body)) {
    if (key !== 'decisions') {
      throw new BadRequestException('Unknown field.');
    }
  }
  if (!Array.isArray(body.decisions)) {
    throw new BadRequestException('decisions must be a non-empty array.');
  }
  return body.decisions;
}

function parseDecision(value: unknown): OcrDecision {
  if (!isPlainObject(value)) {
    throw new BadRequestException('Each decision needs a suggestionId.');
  }
  if ('clientPriorValue' in value) {
    throw new UnprocessableEntityException('clientPriorValue is not accepted.');
  }
  if (isAcceptAll(value)) {
    throw bulkAcceptAll();
  }
  for (const key of Object.keys(value)) {
    if (!DECISION_KEYS.has(key)) {
      throw new BadRequestException('Unknown field.');
    }
  }
  const suggestionId = value.suggestionId;
  if (typeof suggestionId !== 'string' || !isUuid(suggestionId)) {
    throw new BadRequestException('Each decision needs a suggestionId.');
  }
  const action = value.action;
  if (action !== 'accept' && action !== 'reject' && action !== 'edit' && action !== 'replace') {
    throw new BadRequestException('action must be accept, reject, edit, or replace.');
  }
  let targetEntityId: string | undefined;
  if ('targetEntityId' in value && value.targetEntityId !== undefined) {
    if (typeof value.targetEntityId !== 'string' || !isUuid(value.targetEntityId)) {
      throw new BadRequestException('targetEntityId must be a UUID.');
    }
    targetEntityId = value.targetEntityId;
  }
  if (action === 'edit' && (!('editedValue' in value) || value.editedValue === undefined)) {
    throw new BadRequestException('Edit needs editedValue.');
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

function bulkAcceptAll(): UnprocessableEntityException {
  return new UnprocessableEntityException('Bulk accept-all is not accepted.');
}

function assertNoDangerousKeys(value: unknown, depth = 0): void {
  if (depth > 20) {
    throw new BadRequestException('Invalid payload.');
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
      throw new BadRequestException('Unknown field.');
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
