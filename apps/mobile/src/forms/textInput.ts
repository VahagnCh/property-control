import { copyText, type CopyKey } from '../copy/userFacing';

/** Same measure as the API title check: JavaScript string length after NFC. */
export const TITLE_MAX_CHARS = 300;

/** Express JSON limit `32kb` is 32 × 1024 bytes. */
export const BODY_MAX_BYTES = 32 * 1024;

export type TextField = 'title' | 'body' | 'note' | 'notes';

export type TextInputResult =
  | { ok: true; value: string }
  | { ok: false; key: CopyKey; message: string };

/**
 * PR #3 `REJECTED_TEXT` in apps/api/src/ocr/ocr-fields.ts at 743ea24.
 * C0 (including tab, LF, CR, and DEL), C1, bidi overrides, and zero-width.
 */
const REJECTED_TEXT =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u;

/**
 * PR #3 `MULTILINE_REJECTED_TEXT`. Same set, except U+000A is allowed
 * after CR and CRLF have been stored as LF.
 */
const MULTILINE_REJECTED_TEXT =
  /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u;

/** PR #3 notes field maxLength. */
export const NOTES_MAX_CHARS = 2000;

const WHITESPACE_ONLY = /^[\s\u00A0]*$/u;

function allowsNewline(field: TextField): boolean {
  return field === 'body' || field === 'note' || field === 'notes';
}

/** PR #3 stores CR and CRLF as LF on notes before the character check. */
export function normalizeMultilineNote(value: string): string {
  return value.normalize('NFC').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function hasDisallowedTextChars(value: string, field: TextField = 'title'): boolean {
  if (allowsNewline(field)) {
    return MULTILINE_REJECTED_TEXT.test(normalizeMultilineNote(value));
  }
  return REJECTED_TEXT.test(value.normalize('NFC'));
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code <= 0xffff) {
      bytes += 3;
    } else {
      bytes += 4;
    }
  }
  return bytes;
}

function reject(key: CopyKey): TextInputResult {
  return { ok: false, key, message: copyText(key) };
}

/**
 * Rejects disallowed characters. It does not strip them.
 * A single-line field rejects every C0 character, including tab, LF, and CR,
 * plus C1, bidi overrides, and zero-width characters (PR #3 REJECTED_TEXT).
 * A multi-line note stores CR and CRLF as LF, then rejects the same set except LF.
 * Title max is 300 characters. Body max is 32 KB. OCR notes max is 2000 characters.
 * A single-line field that is empty or whitespace uses `form.text.required`.
 * A blank note stays `ocr.edit.invalid`.
 */
export function validateTextInput(value: string, field: TextField): TextInputResult {
  const normalized = allowsNewline(field) ? normalizeMultilineNote(value) : value.normalize('NFC');
  if (hasDisallowedTextChars(value, field)) {
    return reject('form.text.invalidChars');
  }
  if (!allowsNewline(field) && WHITESPACE_ONLY.test(normalized)) {
    return reject('form.text.required');
  }
  if ((field === 'note' || field === 'notes') && (normalized.length > NOTES_MAX_CHARS || WHITESPACE_ONLY.test(normalized))) {
    return reject('ocr.edit.invalid');
  }
  if (field === 'title' && normalized.length > TITLE_MAX_CHARS) {
    return reject('form.title.tooLong');
  }
  if (field === 'body' && utf8ByteLength(normalized) > BODY_MAX_BYTES) {
    return reject('form.body.tooLong');
  }
  return { ok: true, value: normalized };
}
