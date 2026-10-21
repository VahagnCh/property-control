import { copyText, type CopyKey } from '../copy/userFacing';

/** Same measure as the API title check: JavaScript string length after NFC. */
export const TITLE_MAX_CHARS = 300;

/** Express JSON limit `32kb` is 32 × 1024 bytes. */
export const BODY_MAX_BYTES = 32 * 1024;

export type TextField = 'title' | 'body';

export type TextInputResult =
  | { ok: true; value: string }
  | { ok: false; key: CopyKey; message: string };

const C0_OTHER_THAN_WHITESPACE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const C1_CONTROLS = /[\u0080-\u009F]/;
const BIDI_OVERRIDES = /[\u202A-\u202E\u2066-\u2069]/;
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u2060]/;

export function hasDisallowedTextChars(value: string): boolean {
  return (
    C0_OTHER_THAN_WHITESPACE.test(value) ||
    C1_CONTROLS.test(value) ||
    BIDI_OVERRIDES.test(value) ||
    ZERO_WIDTH.test(value)
  );
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
 * Title max is 300 characters. Body max is 32 KB.
 */
export function validateTextInput(value: string, field: TextField): TextInputResult {
  if (hasDisallowedTextChars(value)) {
    return reject('form.text.invalidChars');
  }
  if (field === 'title' && value.normalize('NFC').length > TITLE_MAX_CHARS) {
    return reject('form.title.tooLong');
  }
  if (field === 'body' && utf8ByteLength(value) > BODY_MAX_BYTES) {
    return reject('form.body.tooLong');
  }
  return { ok: true, value };
}
