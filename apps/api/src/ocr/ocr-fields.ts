import { BadRequestException } from '@nestjs/common';
import type { OcrTargetEntityType } from './ocr.types.js';
import { canonicalizeMxText } from './ocr-locale.js';

const MAX_CENTAVOS = 2_147_483_647;
const MIN_YEAR = 1990;
const MAX_YEAR = 2100;
const CONTROL = /[\u0000-\u001F\u007F]/;
const WHITESPACE_ONLY = /^[\s\u00A0\uFEFF]*$/u;

interface FieldRule {
  kind: 'amount' | 'date' | 'text';
  entities: readonly OcrTargetEntityType[];
  maxLength?: number;
}

const FIELDS = new Map<string, FieldRule>([
  ['expectedAmount', { kind: 'amount', entities: ['obligation', 'payment'] }],
  ['nextDueDate', { kind: 'date', entities: ['obligation'] }],
  ['providerName', { kind: 'text', entities: ['obligation'], maxLength: 200 }],
  ['title', { kind: 'text', entities: ['document_meta', 'property'], maxLength: 300 }],
]);

const FORBIDDEN_PATHS = new Set(['__proto__', 'constructor', 'prototype']);

export const LOW_CONFIDENCE_THRESHOLD = 0.5;

export function canonicalizeFieldValue(
  fieldPath: string,
  entityType: OcrTargetEntityType,
  value: unknown,
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
    return assertCanonicalDate(value);
  }
  return assertCanonicalText(value, field.maxLength ?? 200);
}

function assertCanonicalAmount(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{2})?$/.test(value)) {
    throw new BadRequestException('editedValue does not match fieldPath.');
  }
  const centavos = toCentavos(value);
  if (centavos <= 0 || centavos > MAX_CENTAVOS) {
    throw new BadRequestException('editedValue does not match fieldPath.');
  }
  return value;
}

function toCentavos(value: string): number {
  const [whole, frac = ''] = value.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
}

function assertCanonicalDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException('editedValue does not match fieldPath.');
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw new BadRequestException('editedValue does not match fieldPath.');
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new BadRequestException('editedValue does not match fieldPath.');
  }
  return value;
}

function assertCanonicalText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('editedValue does not match fieldPath.');
  }
  const normalized = canonicalizeMxText(value);
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    WHITESPACE_ONLY.test(normalized) ||
    CONTROL.test(normalized)
  ) {
    throw new BadRequestException('editedValue does not match fieldPath.');
  }
  return normalized;
}
