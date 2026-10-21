import { copyText, type CopyKey } from '../copy/userFacing';

/** Same measure as the API title check: JavaScript string length after NFC. */
export const TITLE_MAX_CHARS = 300;

/** Express JSON limit `32kb` is 32 × 1024 bytes. */
export const BODY_MAX_BYTES = 32 * 1024;

export type TextField = 'title' | 'body' | 'note';

export type TextInputResult =
  | { ok: true; value: string }
  | { ok: false; key: CopyKey; message: string };

/** Every C0 control, including tab, LF, CR, and DEL. */
const C0_CONTROLS = /[\u0000-\u001F\u007F]/;
/** C0 controls other than LF. Notes may keep a newline and nothing else from C0. */
const C0_OTHER_THAN_LF = /[\u0000-\u0009\u000B-\u001F\u007F]/;
const C1_CONTROLS = /[\u0080-\u009F]/;
const BIDI_OVERRIDES = /[\u202A-\u202E\u2066-\u2069]/;
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u2060]/;

function allowsNewline(field: TextField): boolean {
  return field === 'body' || field === 'note';
}

export function hasDisallowedTextChars(value: string, field: TextField = 'title'): boolean {
  const c0 = allowsNewline(field) ? C0_OTHER_THAN_LF : C0_CONTROLS;
  return c0.test(value) || C1_CONTROLS.test(value) || BIDI_OVERRIDES.test(value) || ZERO_WIDTH.test(value);
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
 * A single-line field rejects every C0 character, including tab, LF, and CR.
 * A multi-line note (`body` or `note`) may contain LF and still rejects tab, CR,
 * and the other C0 characters. C1, bidi overrides, and zero-width characters
 * are rejected on every field. Title max is 300 characters. Body and note max is 32 KB.
 */
export function validateTextInput(value: string, field: TextField): TextInputResult {
  if (hasDisallowedTextChars(value, field)) {
    return reject('form.text.invalidChars');
  }
  if (field === 'title' && value.normalize('NFC').length > TITLE_MAX_CHARS) {
    return reject('form.title.tooLong');
  }
  if ((field === 'body' || field === 'note') && utf8ByteLength(value) > BODY_MAX_BYTES) {
    return reject('form.body.tooLong');
  }
  return { ok: true, value };
}
