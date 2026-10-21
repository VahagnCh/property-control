import { BODY_MAX_BYTES, TITLE_MAX_CHARS, validateTextInput } from './textInput';

const INVALID = 'Este texto tiene caracteres no permitidos. Bórralos e inténtalo de nuevo.';
const ACCENTS = '¿El año en Mérida trae la obligación? ¡Revisa el folio: á é í ó ú ñ ü!';

describe('text input', () => {
  it('rejects C1 controls, bidi overrides, and zero-width characters on every field', () => {
    const samples = [
      `México\u0080`,
      `México\u009F`,
      `México\u0085`,
      `año\u0000`,
      `año\u0001`,
      `año\u0008`,
      `año\u000B`,
      `año\u000C`,
      `año\u000E`,
      `año\u001F`,
      `año\u007F`,
      `pago\u202A1`,
      `pago\u202B1`,
      `pago\u202C1`,
      `pago\u202D1`,
      `pago\u202E1`,
      `pago\u20661`,
      `pago\u20671`,
      `pago\u20681`,
      `pago\u20691`,
      `folio\u200B`,
      `folio\u200C`,
      `folio\u200D`,
      `folio\uFEFF`,
      `folio\u2060`,
    ];

    for (const field of ['title', 'body', 'note'] as const) {
      for (const value of samples) {
        const result = validateTextInput(value, field);
        expect(result).toEqual({ ok: false, key: 'form.text.invalidChars', message: INVALID });
        expect(result).not.toHaveProperty('value');
        expect(value).not.toBe(ACCENTS);
      }
    }
  });

  it('rejects every C0 character on a single-line field, including tab, LF, and CR', () => {
    for (const char of ['\t', '\n', '\r', '\u0000', '\u000B', '\u007F']) {
      const value = `año${char}folio`;
      expect(validateTextInput(value, 'title')).toEqual({
        ok: false,
        key: 'form.text.invalidChars',
        message: INVALID,
      });
      expect(value).toContain(char);
    }
  });

  it('stores CR and CRLF as LF on a note, and still rejects tab', () => {
    const note = `${ACCENTS}\nsegunda línea`;
    expect(validateTextInput(note, 'note')).toEqual({ ok: true, value: note });
    expect(validateTextInput(note, 'notes')).toEqual({ ok: true, value: note });
    expect(validateTextInput(note, 'body')).toEqual({ ok: true, value: note });
    expect(validateTextInput('linea 1\r\nlinea 2', 'notes')).toEqual({
      ok: true,
      value: 'linea 1\nlinea 2',
    });
    expect(validateTextInput('linea 1\rlinea 2', 'note')).toEqual({
      ok: true,
      value: 'linea 1\nlinea 2',
    });
    expect(validateTextInput('año\nfolio', 'title').ok).toBe(false);
    expect(validateTextInput('Cafe\r', 'title').ok).toBe(false);

    for (const field of ['note', 'notes', 'body'] as const) {
      expect(validateTextInput('año\tfólio', field)).toEqual({
        ok: false,
        key: 'form.text.invalidChars',
        message: INVALID,
      });
    }
  });

  it('does not strip disallowed characters out of the original string', () => {
    const dirty = 'Predial\u0000 2026\u200B';
    const result = validateTextInput(dirty, 'body');
    expect(result.ok).toBe(false);
    expect(dirty).toBe('Predial\u0000 2026\u200B');
    if (!result.ok) {
      expect(JSON.stringify(result)).not.toContain('Predial 2026');
      expect(result.message).toBe(INVALID);
    }
  });

  it('allows spaces, accents, ñ, ¿, and ¡ on a single-line field', () => {
    expect(validateTextInput(ACCENTS, 'title')).toEqual({ ok: true, value: ACCENTS });
    expect(validateTextInput('hola mundo', 'title')).toEqual({ ok: true, value: 'hola mundo' });
    expect(validateTextInput(`${ACCENTS}\nsegunda línea`, 'note')).toEqual({
      ok: true,
      value: `${ACCENTS}\nsegunda línea`,
    });
  });

  it('mirrors the API limits: title max 300 characters and body max 32 KB', () => {
    const titleOk = 'ñ'.repeat(TITLE_MAX_CHARS);
    const titleOver = 'ñ'.repeat(TITLE_MAX_CHARS + 1);
    expect(validateTextInput(titleOk, 'title')).toEqual({ ok: true, value: titleOk });
    expect(validateTextInput(titleOver, 'title')).toEqual({
      ok: false,
      key: 'form.title.tooLong',
      message: 'El título admite hasta 300 caracteres.',
    });

    const bodyOk = 'a'.repeat(BODY_MAX_BYTES);
    const bodyOver = 'a'.repeat(BODY_MAX_BYTES + 1);
    expect(BODY_MAX_BYTES).toBe(32 * 1024);
    expect(validateTextInput(bodyOk, 'body')).toEqual({ ok: true, value: bodyOk });
    expect(validateTextInput(bodyOver, 'body')).toEqual({
      ok: false,
      key: 'form.body.tooLong',
      message: 'El texto admite hasta 32 KB.',
    });

    const exactMultiByte = 'ñ'.repeat(BODY_MAX_BYTES / 2);
    expect(validateTextInput(exactMultiByte, 'body').ok).toBe(true);
    expect(validateTextInput(`${exactMultiByte}ñ`, 'body').ok).toBe(false);

    const both = `${'x'.repeat(TITLE_MAX_CHARS)}\u0000`;
    expect(validateTextInput(both, 'title')).toEqual({
      ok: false,
      key: 'form.text.invalidChars',
      message: INVALID,
    });
  });
});
