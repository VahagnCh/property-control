import { confirmOcrSuggestion, editOcrField, suggestOcrField } from './applyOcrSuggestion';
import { PROVIDER_NAME_MAX_CHARS } from './ocrEditValue';
import { NOTES_MAX_CHARS, TITLE_MAX_CHARS } from '../forms/textInput';

const NOW = new Date('2026-10-21T18:00:00.000Z');
const TARGET = '11111111-1111-4111-8111-111111111111';
const INVALID = 'Este valor no es válido. Revisa el formato e inténtalo de nuevo.';
const REQUIRED = 'Este campo no puede quedar vacío.';
const CHARS = 'Este texto tiene caracteres no permitidos. Bórralos e inténtalo de nuevo.';

const fields = {
  providerName: 'previo',
  title: 'previo',
  amount: 'previo',
  expectedAmount: 'previo',
  paidDate: 'previo',
  paidAt: 'previo',
  nextDueDate: 'previo',
  notes: 'previo',
  note: 'previo',
  lender: 'previo',
};

function edit(field: keyof typeof fields, value: string, now?: Date) {
  const suggestion = confirmOcrSuggestion(
    suggestOcrField(field, 'sugerido', 0.9, { suggestionId: 'sug-edit', targetEntityId: TARGET }),
  );
  return editOcrField(fields, suggestion, field, value, now ? { now } : undefined);
}

describe('per-field OCR edits', () => {
  it('uses the provider and title limits, and requires single-line text', () => {
    const name = 'á'.repeat(PROVIDER_NAME_MAX_CHARS);
    const accepted = edit('providerName', name);
    expect(accepted.error).toBeNull();
    expect(accepted.decision?.ui).toBe('edited');
    expect(accepted.form.providerName).toBe(name);
    expect(fields.providerName).toBe('previo');

    const tooLong = edit('providerName', 'á'.repeat(PROVIDER_NAME_MAX_CHARS + 1));
    expect(tooLong.decision).toBeNull();
    expect(tooLong.form).toBe(fields);
    expect(tooLong.error).toEqual({ key: 'ocr.edit.invalid', message: INVALID });

    expect(edit('providerName', '').error).toEqual({ key: 'form.text.required', message: REQUIRED });
    expect(edit('providerName', '   ').error).toEqual({ key: 'form.text.required', message: REQUIRED });
    expect(edit('providerName', '\u00A0').error).toEqual({ key: 'form.text.required', message: REQUIRED });
    expect(edit('providerName', 'Cafe\u0000').error).toEqual({ key: 'form.text.invalidChars', message: CHARS });

    const title = 'ñ'.repeat(TITLE_MAX_CHARS);
    expect(edit('title', title).error).toBeNull();
    expect(edit('title', title).form.title).toBe(title);
    expect(edit('title', 'ñ'.repeat(TITLE_MAX_CHARS + 1)).error?.key).toBe('form.title.tooLong');
    expect(edit('title', '  ').decision).toBeNull();
    expect(edit('title', '  ').error?.key).toBe('form.text.required');
  });

  it('canonicalizes money and rejects separators, and checks characters first', () => {
    const edited = edit('amount', '10.5');
    expect(edited.error).toBeNull();
    expect(edited.form.amount).toBe('10.50');
    expect(edited.decision && JSON.parse(JSON.stringify(edited.decision)).editedValue).toBe('10.50');

    expect(edit('expectedAmount', '0').form.expectedAmount).toBe('0.00');
    expect(edit('amount', '0.00').error).toBeNull();
    expect(edit('amount', '0.00').form.amount).toBe('0.00');

    const commas = edit('amount', '1,234.50');
    expect(commas.decision).toBeNull();
    expect(commas.form).toBe(fields);
    expect(commas.error).toEqual({ key: 'ocr.edit.invalid', message: INVALID });

    expect(edit('amount', '-1.00').error?.key).toBe('ocr.edit.invalid');
    expect(edit('amount', '1.234').error?.key).toBe('ocr.edit.invalid');
    expect(edit('amount', '21474836.47').form.amount).toBe('21474836.47');
    expect(edit('amount', '21474836.48').decision).toBeNull();

    const nul = edit('amount', '1250\u0000.50');
    expect(nul.decision).toBeNull();
    expect(nul.form).toBe(fields);
    expect(nul.error).toEqual({ key: 'form.text.invalidChars', message: CHARS });
    expect('1250\u0000.50').toContain('\u0000');
  });

  it('applies the paid-date and nextDueDate windows, and does not send a date without now', () => {
    expect(edit('paidDate', '2026-10-21', NOW).error).toBeNull();
    expect(edit('paidDate', '2026-10-21', NOW).form.paidDate).toBe('2026-10-21');
    expect(edit('paidDate', '2025-10-21', NOW).error).toBeNull();
    expect(edit('paidDate', '2025-10-20', NOW).decision).toBeNull();
    expect(edit('paidDate', '2025-10-20', NOW).error?.key).toBe('ocr.edit.invalid');
    expect(edit('paidDate', '2026-10-22', NOW).error?.key).toBe('ocr.edit.invalid');
    expect(edit('paidDate', '2026-10-21').decision).toBeNull();
    expect(edit('paidDate', '2026-10-21').error?.key).toBe('ocr.edit.invalid');
    expect(edit('paidDate', '2026-10-21\u0000', NOW).error?.key).toBe('form.text.invalidChars');

    expect(edit('paidAt', '2026-10-21', NOW).form.paidAt).toBe('2026-10-21');
    expect(edit('paidAt', '2026-10-22', NOW).decision).toBeNull();

    expect(edit('nextDueDate', '2025-10-21', NOW).error).toBeNull();
    expect(edit('nextDueDate', '2031-10-21', NOW).form.nextDueDate).toBe('2031-10-21');
    expect(edit('nextDueDate', '2025-10-20', NOW).error?.key).toBe('ocr.edit.invalid');
    expect(edit('nextDueDate', '2031-10-22', NOW).decision).toBeNull();
    expect(edit('nextDueDate', '2031-10-21').decision).toBeNull();
    expect(edit('nextDueDate', 'no-es-fecha', NOW).form).toBe(fields);
  });

  it('keeps note rules and refuses an unknown field', () => {
    const note = edit('notes', `${'n'.repeat(NOTES_MAX_CHARS)}`);
    expect(note.error).toBeNull();
    expect(note.form.notes).toHaveLength(NOTES_MAX_CHARS);
    expect(edit('notes', 'n'.repeat(NOTES_MAX_CHARS + 1)).error?.key).toBe('ocr.edit.invalid');
    expect(edit('notes', '   ').error?.key).toBe('ocr.edit.invalid');
    expect(edit('note', 'línea\runo').form.note).toBe('línea\nuno');

    const unknown = edit('lender', 'Folio 12');
    expect(unknown.decision).toBeNull();
    expect(unknown.form).toBe(fields);
    expect(unknown.error?.key).toBe('ocr.edit.invalid');
  });
});
