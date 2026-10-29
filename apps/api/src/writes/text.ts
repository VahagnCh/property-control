import { UnprocessableEntityException } from '@nestjs/common';
import { canonicalizeMxText } from '../ocr/ocr-locale.js';

const REJECTED_TEXT =
  /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uD800-\uDFFF\uFEFF]/u;
const MULTILINE_REJECTED_TEXT =
  /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uD800-\uDFFF\uFEFF]/u;
const WHITESPACE_ONLY = /^[\s\u00A0]*$/u;

/** Single-line person text. NFC, no controls, length is UTF-16 code units. */
export function assertSingleLine(value: unknown, maxLength: number, error = 'text_invalid'): string {
  return normalize(value, maxLength, false, error);
}

/** Notes. CR and CRLF become LF. The stored string is what the audit hash covers. */
export function assertNotes(value: unknown): string {
  return normalize(value, 2000, true, 'text_invalid');
}

function normalize(value: unknown, maxLength: number, multiline: boolean, error: string): string {
  if (typeof value !== 'string') {
    throw invalid(error);
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
    throw invalid(error);
  }
  return normalized;
}

function invalid(error: string): UnprocessableEntityException {
  return new UnprocessableEntityException({
    statusCode: 422,
    error,
    message: 'Text is empty, too long, or contains a character that is not allowed.',
  });
}
