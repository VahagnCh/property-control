import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import {
  NEXT_DUE_DATE_MAX_YEAR,
  NEXT_DUE_DATE_MIN_YEAR,
  assertNextDueDateInRange,
} from '../obligations/next-due-date.js';
import type { OcrTargetEntityType } from './ocr.types.js';
import { canonicalizeMxText } from './ocr-locale.js';

const MAX_CENTAVOS = 2_147_483_647;
/**
 * C0 (including DEL), C1, bidi overrides, and zero-width characters.
 * These are rejected, not stripped.
 */
const REJECTED_TEXT =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u;
/** Same as REJECTED_TEXT, except U+000A is allowed after CR and CRLF become LF. */
const MULTILINE_REJECTED_TEXT =
  /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u;
const WHITESPACE_ONLY = /^[\s\u00A0]*$/u;

export interface FieldValueContext {
  now: Date;
  timeZone: string;
}

interface FieldRule {
  kind: 'amount' | 'date' | 'text';
  entities: readonly OcrTargetEntityType[];
  maxLength?: number;
  /** Notes only. Other text fields are single-line and reject every C0 character. */
  multiline?: boolean;
}

const FIELDS = new Map<string, FieldRule>([
  ['expectedAmount', { kind: 'amount', entities: ['obligation', 'payment'] }],
  ['nextDueDate', { kind: 'date', entities: ['obligation'] }],
  ['providerName', { kind: 'text', entities: ['obligation'], maxLength: 200 }],
  ['title', { kind: 'text', entities: ['document_meta', 'property'], maxLength: 300 }],
  ['notes', { kind: 'text', entities: ['obligation', 'payment'], maxLength: 2000, multiline: true }],
]);

const FORBIDDEN_PATHS = new Set(['__proto__', 'constructor', 'prototype']);

export type ConfidenceBandName = 'alta' | 'media' | 'revisa';

export interface ConfidenceBandThresholds {
  alta: number;
  media: number;
}

/**
 * Band from the configured thresholds. A low-confidence flag, a missing score,
 * a non-numeric score, or a score outside 0..1 is always revisa.
 */
export function confidenceBand(
  confidence: number | null,
  lowConfidence: boolean,
  bands: ConfidenceBandThresholds,
): ConfidenceBandName {
  if (
    lowConfidence ||
    confidence === null ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    return 'revisa';
  }
  if (confidence >= bands.alta) {
    return 'alta';
  }
  if (confidence >= bands.media) {
    return 'media';
  }
  return 'revisa';
}

export function canonicalizeFieldValue(
  fieldPath: string,
  entityType: OcrTargetEntityType,
  value: unknown,
  context?: FieldValueContext,
): unknown {
  if (FORBIDDEN_PATHS.has(fieldPath) || !FIELDS.has(fieldPath)) {
    throw new BadRequestException('Unknown fieldPath.');
  }
  const field = FIELDS.get(fieldPath);
  if (!field || !field.entities.includes(entityType)) {
    throw new BadRequestException('Unknown fieldPath.');
  }
  if (field.kind === 'amount') {
    return assertCanonicalAmount(value);
  }
  if (field.kind === 'date') {
    return assertCanonicalDate(value, context);
  }
  return assertCanonicalText(value, field.maxLength ?? 200, field.multiline === true);
}

function assertCanonicalAmount(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{2})?$/.test(value)) {
    throw badValue();
  }
  const centavos = toCentavos(value);
  if (centavos <= 0 || centavos > MAX_CENTAVOS) {
    throw badValue();
  }
  return value;
}

function toCentavos(value: string): number {
  const [whole, frac = ''] = value.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
}

function assertCanonicalDate(value: unknown, context?: FieldValueContext): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw badValue();
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw badValue();
  }
  if (year < NEXT_DUE_DATE_MIN_YEAR || year > NEXT_DUE_DATE_MAX_YEAR) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      message: 'nextDueDate is outside the allowed range.',
      error: 'next_due_date_out_of_range',
    });
  }
  if (context) {
    assertNextDueDateInRange(value, context.now, context.timeZone);
  }
  return value;
}

function assertCanonicalText(value: unknown, maxLength: number, multiline: boolean): string {
  if (typeof value !== 'string') {
    throw badValue();
  }
  let normalized = canonicalizeMxText(value);
  if (multiline) {
    normalized = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }
  const rejected = multiline ? MULTILINE_REJECTED_TEXT : REJECTED_TEXT;
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    WHITESPACE_ONLY.test(normalized) ||
    rejected.test(normalized)
  ) {
    throw badValue();
  }
  return normalized;
}

function badValue(): UnprocessableEntityException {
  return new UnprocessableEntityException('editedValue does not match fieldPath.');
}
