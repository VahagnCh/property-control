import { copyText, type CopyKey } from '../copy/userFacing';
import { validateNextDueDate } from '../dates/nextDueDate';
import { hasDisallowedTextChars, validateTextInput, type TextInputResult } from '../forms/textInput';
import { formatWireAmount, parseMxnToCentavos } from '../payments/money';
import { validatePaidDate } from '../payments/paidDate';

/** PR #3 `providerName` maxLength in apps/api/src/ocr/ocr-fields.ts. */
export const PROVIDER_NAME_MAX_CHARS = 200;

const WHITESPACE_ONLY = /^[\s\u00A0]*$/u;

export type OcrEditContext = {
  now?: Date;
  timeZone?: string;
};

function reject(key: CopyKey): TextInputResult {
  return { ok: false, key, message: copyText(key) };
}

/**
 * Per-field OCR edit check. Disallowed characters are rejected before the
 * field rule, so a NUL in an amount is `form.text.invalidChars`.
 * Amounts use the record-payment money parser and are canonicalized to two
 * decimals. Zero and negative amounts are rejected, matching the server
 * centavos check. Thousands separators are not.
 * `paidDate` / `paidAt` use the paid-date window. `nextDueDate` uses its window.
 * A date edit without `now` is not sent.
 */
export function validateOcrEditValue(
  field: string,
  editedValue: string,
  context: OcrEditContext = {},
): TextInputResult {
  const multiline = field === 'note' || field === 'notes' || field === 'body';
  if (hasDisallowedTextChars(editedValue, multiline ? 'notes' : 'title')) {
    return reject('form.text.invalidChars');
  }
  if (field === 'note' || field === 'notes') {
    return validateTextInput(editedValue, field);
  }
  if (field === 'body') {
    return validateTextInput(editedValue, 'body');
  }
  if (field === 'title') {
    return validateTextInput(editedValue, 'title');
  }
  if (field === 'providerName') {
    const normalized = editedValue.normalize('NFC');
    if (WHITESPACE_ONLY.test(normalized)) {
      return reject('form.text.required');
    }
    if (normalized.length > PROVIDER_NAME_MAX_CHARS) {
      return reject('ocr.edit.invalid');
    }
    return { ok: true, value: normalized };
  }
  if (field === 'amount' || field === 'expectedAmount') {
    try {
      const centavos = parseMxnToCentavos(editedValue);
      if (centavos <= 0) {
        return reject('ocr.edit.invalid');
      }
      return { ok: true, value: formatWireAmount(centavos) };
    } catch {
      return reject('ocr.edit.invalid');
    }
  }
  if (field === 'paidDate' || field === 'paidAt' || field === 'nextDueDate') {
    if (!context.now) {
      return reject('ocr.edit.invalid');
    }
    if (field === 'nextDueDate') {
      const dated = validateNextDueDate(editedValue.normalize('NFC'), context.now, context.timeZone);
      return dated.ok ? { ok: true, value: dated.nextDueDate } : reject('ocr.edit.invalid');
    }
    const dated = validatePaidDate(editedValue.normalize('NFC'), context.now, context.timeZone);
    return dated.ok ? { ok: true, value: dated.paidDate } : reject('ocr.edit.invalid');
  }
  return reject('ocr.edit.invalid');
}
