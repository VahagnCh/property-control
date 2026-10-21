import { NOTES_MAX_CHARS, validateTextInput } from '../forms/textInput';
import {
  CLIENT_PRIOR_VALUE_MESSAGE,
  FIELD_ALREADY_SET_MESSAGE,
  MISSING_DECISION_MESSAGE,
  mapOcrConfirmError,
} from './ocrEditError';
import {
  confirmOcrSuggestion,
  confirmOnRegistrar,
  editOcrField,
  readOcrConfirmResult,
  replaceField,
  serializeConfirmPayload,
  serializeOcrDecision,
  stripClientPriorValue,
  suggestOcrField,
} from './applyOcrSuggestion';
import { OCR_REPLACE_BUTTON_LABEL } from '../copy/userFacing';

const ALREADY_SET = 'Este campo ya estaba guardado. Usa Reemplazar si quieres cambiarlo.';
const SAVED = 'BBVA ya capturado';
const TARGET = '11111111-1111-4111-8111-111111111111';

function keysDeep(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) {
      keysDeep(entry, found);
    }
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      found.push(key);
      keysDeep(entry, found);
    }
  }
  return found;
}

describe('PR #3 confirm contract at 743ea24', () => {
  it('only replace overwrites a saved field; accept or edit is not sent and Reemplazar is offered', () => {
    // Mirrors ocr.service.ts: saved.present && action !== 'replace' throws 409 error field_already_set.
    // The saved-field test in ocr.service.spec.ts expects that body and persisted true only after replace.
    const form = { providerName: '', notes: '' };
    const suggestion = confirmOcrSuggestion(
      suggestOcrField('providerName', 'BBVA Hipoteca', 0.95, {
        suggestionId: 'sug-provider',
        targetEntityId: TARGET,
        savedValue: SAVED,
      }),
    );

    const accepted = replaceField(form, suggestion, 'providerName');
    expect(accepted.form).toBe(form);
    expect(accepted.decision).toBeNull();
    expect(accepted.offerReplace?.prompt).toBe(`Reemplazar «${SAVED}» por «BBVA Hipoteca»`);
    expect(accepted.offerReplace?.actions.map((action) => action.label)).toContain(OCR_REPLACE_BUTTON_LABEL);

    const edited = editOcrField(form, suggestion, 'providerName', 'Otro banco');
    expect(edited.decision?.ui).toBe('replaced');
    expect(JSON.parse(serializeOcrDecision(edited.decision!))).toEqual({
      suggestionId: 'sug-provider',
      action: 'replace',
      editedValue: 'Otro banco',
      targetEntityId: TARGET,
    });
    expect(serializeOcrDecision(edited.decision!)).not.toContain('"edit"');

    const blocked = confirmOnRegistrar(form, [suggestion], [
      {
        suggestionId: 'sug-provider',
        field: 'providerName',
        ui: 'accepted',
      },
    ]);
    expect(blocked.request).toBeNull();
    expect(blocked.blockedSaved.map((item) => item.suggestionId)).toEqual(['sug-provider']);
    expect(blocked.payload).toEqual([]);

    expect(
      mapOcrConfirmError({
        statusCode: 409,
        message: FIELD_ALREADY_SET_MESSAGE,
        error: 'field_already_set',
        suggestionId: 'sug-provider',
        field: 'providerName',
      }),
    ).toEqual({
      key: 'ocr.field.alreadySet',
      message: ALREADY_SET,
      refresh: true,
      status: 409,
      suggestionId: 'sug-provider',
      field: 'providerName',
    });

    const replaced = readOcrConfirmResult({
      persisted: true,
      applied: [{ suggestionId: 'sug-provider', fieldPath: 'providerName' }],
      audits: [
        {
          suggestionId: 'sug-provider',
          field: 'providerName',
          action: 'replace',
          previousValue: SAVED,
          newValue: 'Otro banco',
        },
      ],
    });
    const unsaved = readOcrConfirmResult({
      persisted: false,
      applied: [],
      audits: [{ suggestionId: 'sug-provider', field: 'providerName', decision: 'replaced' }],
    });
    expect(replaced).toEqual({ persisted: true });
    expect(unsaved).toEqual({ persisted: false });
    expect(readOcrConfirmResult({ applied: [], audits: [] })).toBeNull();
  });

  it('never serializes clientPriorValue at any level and maps its 422 by the server message', () => {
    // Mirrors ocr-decisions.ts: the key on the body or on a decision is 422
    // "clientPriorValue is not accepted." There is no domain error code.
    const poisoned = {
      clientPriorValue: 'typed in the form',
      decisions: [
        {
          suggestionId: 'sug-1',
          action: 'replace',
          editedValue: 'Otro',
          clientPriorValue: 'typed in the form',
          nested: { clientPriorValue: 'typed in the form', kept: true },
        },
      ],
    };
    const stripped = stripClientPriorValue(poisoned);
    expect(keysDeep(stripped)).not.toContain('clientPriorValue');
    expect(JSON.stringify(stripped)).not.toContain('clientPriorValue');
    expect(stripped).toEqual({
      decisions: [
        {
          suggestionId: 'sug-1',
          action: 'replace',
          editedValue: 'Otro',
          nested: { kept: true },
        },
      ],
    });

    const wire = serializeConfirmPayload([
      {
        suggestionId: 'sug-1',
        action: 'reject',
        ...({ clientPriorValue: 'typed in the form' } as object),
      },
    ]);
    expect(keysDeep(JSON.parse(wire))).not.toContain('clientPriorValue');
    expect(wire).not.toContain('clientPriorValue');

    expect(
      mapOcrConfirmError({
        statusCode: 422,
        message: CLIENT_PRIOR_VALUE_MESSAGE,
        error: 'Unprocessable Entity',
      }),
    ).toMatchObject({ key: 'ocr.clientPriorValue', status: 422, refresh: false });
    expect(mapOcrConfirmError({ statusCode: 422, error: 'Unprocessable Entity' })).toBeNull();
  });

  it('covers every suggestion once, and a missing-decision 422 is logged as the generic error', () => {
    // Mirrors ocr.service.ts: a suggestion left out of decisions is 422 and names suggestionId.
    // The body has statusCode, message, and suggestionId. It has no domain error code.
    const form = { providerName: '', notes: 'nota' };
    const suggestions = [
      confirmOcrSuggestion(
        suggestOcrField('providerName', 'BBVA', 0.9, {
          suggestionId: 'sug-a',
          targetEntityId: TARGET,
        }),
      ),
      suggestOcrField('notes', 'otra', 0.5, { suggestionId: 'sug-b' }),
      suggestOcrField('notes', 'dup', 0.5, { suggestionId: 'sug-a' }),
    ];
    const reviewed = replaceField(form, suggestions[0]!, 'providerName').decision;
    expect(reviewed?.ui).toBe('accepted');
    const saved = confirmOnRegistrar(form, suggestions, reviewed ? [reviewed, reviewed] : []);
    expect(saved.form).toBe(form);
    expect(saved.request?.decisions.map((row) => row.suggestionId)).toEqual(['sug-a', 'sug-b']);
    expect(new Set(saved.request?.decisions.map((row) => row.suggestionId)).size).toBe(2);
    expect(saved.request?.decisions.map((row) => row.action)).toEqual(['accept', 'reject']);
    expect(saved.payload).toEqual(saved.request?.decisions);

    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(
      mapOcrConfirmError({
        statusCode: 422,
        message: MISSING_DECISION_MESSAGE,
        suggestionId: 'sug-b',
      }),
    ).toMatchObject({
      key: 'error.generic',
      status: 422,
      suggestionId: 'sug-b',
      refresh: false,
    });
    expect(error).toHaveBeenCalledWith('OCR confirm is missing a decision.', 'sug-b');
    error.mockRestore();
  });

  it('matches PR #3 text rules: single-line rejects every C0, notes store CR as LF', () => {
    // Mirrors ocr-fields.ts REJECTED_TEXT / MULTILINE_REJECTED_TEXT and the spec
    // "rejects C0 on single-line text and normalizes newlines on notes".
    for (const sample of ['Cafe\t', 'Cafe\r', 'Cafe\n', 'Cafe\u0000', 'Cafe\u0085', 'Cafe\u202E', 'Cafe\u200B']) {
      expect(validateTextInput(sample, 'title')).toMatchObject({
        ok: false,
        key: 'form.text.invalidChars',
      });
    }
    expect(validateTextInput('linea\t2', 'notes')).toMatchObject({ ok: false, key: 'form.text.invalidChars' });
    expect(validateTextInput('linea 1\r\nlinea 2', 'notes')).toEqual({
      ok: true,
      value: 'linea 1\nlinea 2',
    });
    expect(validateTextInput('linea 1\rlinea 2', 'notes')).toEqual({
      ok: true,
      value: 'linea 1\nlinea 2',
    });
    expect(validateTextInput(`${'n'.repeat(NOTES_MAX_CHARS)}`, 'notes').ok).toBe(true);
    expect(validateTextInput(`${'n'.repeat(NOTES_MAX_CHARS + 1)}`, 'notes')).toMatchObject({
      ok: false,
      key: 'ocr.edit.invalid',
    });
    expect(validateTextInput('   ', 'notes')).toMatchObject({ ok: false, key: 'ocr.edit.invalid' });
  });
});
