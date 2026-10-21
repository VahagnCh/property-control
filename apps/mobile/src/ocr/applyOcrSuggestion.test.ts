import {
  applyOcrSuggestion,
  applyOcrSuggestions,
  confirmOcrSuggestion,
  confirmOnRegistrar,
  discardUnreviewedSuggestions,
  editOcrField,
  keepTypedField,
  ocrDecisionForServer,
  rejectOcrField,
  replaceField,
  replaceSuggestionRow,
  serializeConfirmPayload,
  serializeOcrDecision,
  suggestOcrField,
  tapReemplazar,
  type OcrClientDecision,
} from './applyOcrSuggestion';
import { OCR_REPLACE_TOAST, OCR_UNREVIEWED_DISCARD_COPY } from '../copy/userFacing';

const emptyForm = { amount: '', paidDate: '', note: '' };
const TYPED = 'UNSAVED-TYPED-9f3c';

describe('applyOcrSuggestion', () => {
  it('does not fill anything until an explicit confirm, at any confidence', () => {
    for (const confidence of [null, 0, 0.55, 0.97, 0.99, 1]) {
      const suggestion = suggestOcrField('amount', '1250.00', confidence);
      expect(suggestion.confirmed).toBe(false);
      const next = applyOcrSuggestion(emptyForm, suggestion);
      expect(next).toBe(emptyForm);
      expect(next.amount).toBe('');
    }
  });

  it('fills only an existing empty field after confirm', () => {
    const suggestion = confirmOcrSuggestion(suggestOcrField('amount', '1250.00', 0.99));
    const next = applyOcrSuggestion(emptyForm, suggestion);
    expect(next).not.toBe(emptyForm);
    expect(next).toEqual({ amount: '1250.00', paidDate: '', note: '' });
    expect(emptyForm.amount).toBe('');
  });

  it('does not overwrite a value the person already entered', () => {
    const form = { amount: '1200.00', paidDate: '2026-10-21', note: 'efectivo' };
    const suggestion = confirmOcrSuggestion(suggestOcrField('amount', '1250.00', 0.99));
    expect(applyOcrSuggestion(form, suggestion)).toBe(form);
    expect(form.amount).toBe('1200.00');
  });

  it('does not add fields that are not already on the form', () => {
    const suggestion = confirmOcrSuggestion(suggestOcrField('lender', 'Folio 123', 0.99));
    const next = applyOcrSuggestion(emptyForm, suggestion);
    expect(next).toBe(emptyForm);
    expect(Object.keys(next)).toEqual(['amount', 'paidDate', 'note']);
    expect(Object.prototype.hasOwnProperty.call(next, 'lender')).toBe(false);

    const polluted = confirmOcrSuggestion(suggestOcrField('__proto__', 'x', 1));
    expect(applyOcrSuggestion(emptyForm, polluted)).toBe(emptyForm);
    expect(applyOcrSuggestion(emptyForm, confirmOcrSuggestion(suggestOcrField('constructor', 'x')))).toBe(
      emptyForm,
    );
  });

  it('treats a blank field as empty and refuses a blank suggestion', () => {
    const blanks = { amount: '   ', paidDate: '', note: '' };
    const filled = applyOcrSuggestion(blanks, confirmOcrSuggestion(suggestOcrField('amount', '10.00')));
    expect(filled.amount).toBe('10.00');
    expect(applyOcrSuggestion(emptyForm, confirmOcrSuggestion(suggestOcrField('note', '   ')))).toBe(emptyForm);
  });

  it('keeps a suggest then confirm sequence and refuses accept-all', () => {
    const suggested = [
      suggestOcrField('amount', '1250.00', 0.95),
      suggestOcrField('paidDate', '2026-10-20', 0.91),
      suggestOcrField('lender', 'alguien', 0.99),
    ];
    expect(applyOcrSuggestions(emptyForm, suggested)).toBe(emptyForm);

    const confirmed = suggested.map(confirmOcrSuggestion);
    const manual = { ...emptyForm, amount: '1200.00' };
    const applied = applyOcrSuggestions(manual, confirmed);
    expect(applied.amount).toBe('1200.00');
    expect(applied.paidDate).toBe('2026-10-20');
    expect(Object.keys(applied)).toEqual(['amount', 'paidDate', 'note']);

    const blocked = applyOcrSuggestions(emptyForm, confirmed, { acceptAll: true });
    expect(blocked).toBe(emptyForm);
    expect(blocked.amount).toBe('');
    expect(blocked.paidDate).toBe('');
  });
});

describe('AC-OCR-11 replaceField', () => {
  const suggestion = confirmOcrSuggestion(
    suggestOcrField('amount', '1250.00', 0.99, { suggestionId: 'sug-9', band: 'alta' }),
  );

  it('overwrites one typed field only after confirm and returns the previous value locally', () => {
    const form = { amount: TYPED, paidDate: '2026-10-21', note: 'efectivo' };
    const pending = replaceField(form, { ...suggestion, confirmed: false }, 'amount');
    expect(pending.form).toBe(form);
    expect(pending.decision).toBeNull();
    expect(pending.toast).toBeNull();
    expect(pending.previousValue).toBe(TYPED);
    expect(form.amount).toBe(TYPED);

    const offered = replaceField(form, suggestion, 'amount');
    expect(offered.form).toBe(form);
    expect(offered.decision).toBeNull();
    expect(offered.toast).toBeNull();
    expect(offered.form.amount).toBe(TYPED);
    expect(offered.offerReplace?.actions.map((action) => action.label)).toEqual([
      'Mantener lo que escribí',
      'Reemplazar',
    ]);
    expect(offered.offerReplace?.actions.map((action) => action.label)).not.toContain('Aceptar');
    expect(offered.offerReplace?.actions.map((action) => action.label)).not.toContain('Editar');
    expect(offered.offerReplace?.actions.every((action) => action.decision === 'kept' || action.decision === 'replaced')).toBe(
      true,
    );

    const replaced = tapReemplazar(form, suggestion, 'amount');
    expect(replaced.form).not.toBe(form);
    expect(replaced.form.amount).toBe('1250.00');
    expect(replaced.form.paidDate).toBe('2026-10-21');
    expect(replaced.form.note).toBe('efectivo');
    expect(replaced.previousValue).toBe(TYPED);
    expect(replaced.toast).toBe(OCR_REPLACE_TOAST);
    expect(replaced.toast).toBe('Valor reemplazado. Puedes editarlo antes de registrar.');
    expect(form.amount).toBe(TYPED);
    expect(replaced.decision).toEqual({
      suggestionId: 'sug-9',
      field: 'amount',
      ui: 'replaced',
      suggestedValue: '1250.00',
    });
    const wire = JSON.parse(serializeOcrDecision(replaced.decision!)) as Record<string, unknown>;
    expect(wire).toEqual({ suggestionId: 'sug-9', action: 'replace' });
    expect(wire).not.toHaveProperty('decision');
    expect(wire).not.toHaveProperty('field');
    expect(wire).not.toHaveProperty('suggestedValue');
    expect(wire).not.toHaveProperty('editedValue');
  });

  it('fills an empty field only after confirm', () => {
    const unconfirmed = replaceField(emptyForm, { ...suggestion, confirmed: false }, 'amount');
    expect(unconfirmed.form).toBe(emptyForm);
    expect(unconfirmed.decision).toBeNull();

    const filled = replaceField(emptyForm, suggestion, 'amount');
    expect(filled.form.amount).toBe('1250.00');
    expect(filled.previousValue).toBe('');
    expect(filled.decision?.ui).toBe('accepted');
    expect(JSON.parse(serializeOcrDecision(filled.decision!))).toEqual({
      suggestionId: 'sug-9',
      action: 'accept',
    });
  });

  it('keeps the typed value on Rechazar, on Mantener, and when nothing is chosen', () => {
    const form = { amount: TYPED, paidDate: '', note: '' };
    const idle = form;
    expect(idle.amount).toBe(TYPED);

    const kept = keepTypedField(form, suggestion, 'amount');
    expect(kept.form).toBe(form);
    expect(kept.form.amount).toBe(TYPED);
    expect(kept.decision).toEqual({
      suggestionId: 'sug-9',
      field: 'amount',
      ui: 'kept',
      suggestedValue: '1250.00',
    });
    expect(JSON.parse(serializeOcrDecision(kept.decision!))).toEqual({
      suggestionId: 'sug-9',
      action: 'reject',
    });

    const rejected = rejectOcrField(form, suggestion, 'amount');
    expect(rejected.form).toBe(form);
    expect(rejected.form.amount).toBe(TYPED);
    expect(rejected.decision).toEqual({
      suggestionId: 'sug-9',
      field: 'amount',
      ui: 'rejected',
      suggestedValue: '1250.00',
    });
    expect(JSON.parse(serializeOcrDecision(rejected.decision!))).toEqual({
      suggestionId: 'sug-9',
      action: 'reject',
    });
  });

  it('sends edit and editedValue when the person corrects the suggestion, after the same text rules', () => {
    const form = { amount: TYPED, paidDate: '', note: 'nota' };
    const dirty = '1250\u0000.50';
    const invalid = editOcrField(form, suggestion, 'amount', dirty);
    expect(invalid.form).toBe(form);
    expect(invalid.decision).toBeNull();
    expect(invalid.error).toEqual({
      key: 'form.text.invalidChars',
      message: 'Este texto tiene caracteres no permitidos. Bórralos e inténtalo de nuevo.',
    });
    expect(dirty).toBe('1250\u0000.50');

    const lineBreak = editOcrField(form, suggestion, 'amount', '1250\n50');
    expect(lineBreak.decision).toBeNull();
    expect(lineBreak.form).toBe(form);

    const edited = editOcrField(form, suggestion, 'amount', '1250.50');
    expect(edited.error).toBeNull();
    expect(edited.form).not.toBe(form);
    expect(edited.form.amount).toBe('1250.50');
    expect(edited.previousValue).toBe(TYPED);
    expect(form.amount).toBe(TYPED);
    expect(edited.decision?.ui).toBe('edited');
    expect(JSON.parse(serializeOcrDecision(edited.decision!))).toEqual({
      suggestionId: 'sug-9',
      action: 'edit',
      editedValue: '1250.50',
    });
    expect(serializeOcrDecision(edited.decision!)).not.toContain(TYPED);

    const note = confirmOcrSuggestion(suggestOcrField('note', 'folio', 0.9, { suggestionId: 'sug-note' }));
    const withNewline = editOcrField(form, note, 'note', 'línea uno\nlínea dos');
    expect(withNewline.error).toBeNull();
    expect(JSON.parse(serializeOcrDecision(withNewline.decision!))).toEqual({
      suggestionId: 'sug-note',
      action: 'edit',
      editedValue: 'línea uno\nlínea dos',
    });
    expect(editOcrField(form, note, 'note', 'línea\tuno').decision).toBeNull();
    const carriageReturn = editOcrField(form, note, 'note', 'línea\runo');
    expect(JSON.parse(serializeOcrDecision(carriageReturn.decision!))).toEqual({
      suggestionId: 'sug-note',
      action: 'edit',
      editedValue: 'línea\nuno',
    });
  });

  it('refuses a blank suggestion, a missing id, another field, and prototype keys', () => {
    const form = { amount: TYPED, paidDate: '2026-10-21', note: 'nota' };
    expect(replaceField(form, confirmOcrSuggestion(suggestOcrField('amount', '   ', 1, { suggestionId: 's' })), 'amount').form).toBe(
      form,
    );
    expect(replaceField(form, confirmOcrSuggestion(suggestOcrField('amount', '10.00', 1)), 'amount').form).toBe(form);
    expect(replaceField(form, suggestion, 'note').form).toBe(form);
    expect(replaceField(form, suggestion, 'note').decision).toBeNull();
    expect(
      replaceField(form, confirmOcrSuggestion(suggestOcrField('__proto__', 'x', 1, { suggestionId: 's' })), '__proto__').form,
    ).toBe(form);
    expect(keepTypedField(form, suggestion, 'paidDate').decision).toBeNull();
    expect(rejectOcrField(form, suggestion, 'missing').form).toBe(form);
  });

  it('replaces one field at a time and still rejects accept-all', () => {
    const form = { amount: '1.00', paidDate: '2026-10-01', note: 'nota' };
    const suggestions = [
      confirmOcrSuggestion(suggestOcrField('amount', '2.00', 0.99, { suggestionId: 'a' })),
      confirmOcrSuggestion(suggestOcrField('paidDate', '2026-10-02', 0.99, { suggestionId: 'b' })),
      confirmOcrSuggestion(suggestOcrField('note', 'otra', 0.99, { suggestionId: 'c' })),
    ];
    expect(applyOcrSuggestions(form, suggestions, { acceptAll: true })).toBe(form);
    expect(applyOcrSuggestions(form, suggestions)).toBe(form);

    expect(replaceField(form, suggestions[0]!, 'amount').form).toBe(form);
    expect(replaceField(form, suggestions[0]!, 'amount').decision).toBeNull();
    const one = tapReemplazar(form, suggestions[0]!, 'amount');
    expect(one.form.amount).toBe('2.00');
    expect(one.decision?.ui).toBe('replaced');
    expect(one.form.paidDate).toBe('2026-10-01');
    expect(one.form.note).toBe('nota');
    expect(one.decision?.field).toBe('amount');
  });

  it('serializes a decision with no typed or previous value, including a record that is already saved', () => {
    const form = { amount: TYPED, paidDate: '', note: '' };
    const replaced = tapReemplazar(form, suggestion, 'amount');
    const decision = replaced.decision;
    expect(decision).not.toBeNull();
    if (!decision) {
      return;
    }

    expect(Object.keys(decision)).toEqual(['suggestionId', 'field', 'ui', 'suggestedValue']);
    expect(JSON.stringify(replaced)).toContain(TYPED);
    expect(serializeOcrDecision(decision)).not.toContain(TYPED);
    expect(serializeOcrDecision(decision)).not.toMatch(
      /previous|typed|clientPriorValue|suggestedValue|"decision"|"field"|"replaced"|"kept"|"rejected"/,
    );

    const poisoned = {
      ...decision,
      decision: 'replaced',
      field: 'amount',
      suggestedValue: '1250.00',
      previousTypedValue: TYPED,
      previousValue: TYPED,
      typedValue: TYPED,
      persistedPreviousValue: TYPED,
      clientPriorValue: TYPED,
      actual: TYPED,
    };
    const payload = ocrDecisionForServer(poisoned);
    const json = serializeOcrDecision(poisoned);
    expect(payload).toEqual({
      suggestionId: 'sug-9',
      action: 'replace',
    });
    expect(json).toBe(JSON.stringify(payload));
    expect(json).not.toContain(TYPED);
    expect(json).not.toContain('1250.00');
    for (const key of [
      'decision',
      'field',
      'suggestedValue',
      'previousValue',
      'previousTypedValue',
      'typedValue',
      'persistedPreviousValue',
      'clientPriorValue',
      'actual',
      'editedValue',
    ]) {
      expect(payload).not.toHaveProperty(key);
    }

    const saved: OcrClientDecision = {
      suggestionId: 'sug-saved',
      field: 'note',
      ui: 'kept',
      suggestedValue: 'folio',
    };
    expect(ocrDecisionForServer(saved)).toEqual({
      suggestionId: 'sug-saved',
      action: 'reject',
    });
    expect(Object.keys(ocrDecisionForServer(saved))).toEqual(['suggestionId', 'action']);
  });

  it('emits only accept, reject, edit, or replace', () => {
    const choices = [
      { ui: 'accepted' as const, action: 'accept' },
      { ui: 'replaced' as const, action: 'replace' },
      { ui: 'kept' as const, action: 'reject' },
      { ui: 'rejected' as const, action: 'reject' },
      { ui: 'edited' as const, action: 'edit' },
    ];
    const emitted = choices.map((choice) =>
      JSON.parse(
        serializeOcrDecision({
          suggestionId: 'sug-1',
          field: 'amount',
          ui: choice.ui,
          suggestedValue: '10.00',
          editedValue: choice.ui === 'edited' ? '10.50' : undefined,
        }),
      ) as { action: string; editedValue?: string },
    );
    expect(emitted.map((row) => row.action)).toEqual(['accept', 'replace', 'reject', 'reject', 'edit']);
    expect(emitted[4]?.editedValue).toBe('10.50');
    expect(emitted[0]).not.toHaveProperty('editedValue');
    const json = choices
      .map((choice) =>
        serializeOcrDecision({
          suggestionId: 'sug-1',
          field: 'amount',
          ui: choice.ui,
          suggestedValue: '10.00',
          editedValue: '10.50',
        }),
      )
      .join('\n');
    expect(json).not.toMatch(/"replaced"|"kept"|"rejected"|"decision"|"field"|"suggestedValue"|"clientPriorValue"/);
    for (const row of emitted) {
      expect(['accept', 'reject', 'edit', 'replace']).toContain(row.action);
    }
  });

  it('builds the suggestion row copy with Mantener as the default highlighted action', () => {
    expect(replaceSuggestionRow('   ', '1250.00')).toBeNull();
    expect(replaceSuggestionRow(TYPED, '1250.00')).toEqual({
      prompt: `Reemplazar «${TYPED}» por «1250.00»`,
      actions: [
        {
          decision: 'kept',
          label: 'Mantener lo que escribí',
          highlighted: true,
          isDefault: true,
        },
        {
          decision: 'replaced',
          label: 'Reemplazar',
          highlighted: false,
          isDefault: false,
        },
      ],
      toast: 'Valor reemplazado. Puedes editarlo antes de registrar.',
    });
  });

  it('discards unreviewed suggestions on save and never changes the form', () => {
    const form = { amount: '', paidDate: '', note: 'nota' };
    const unreviewed = [
      confirmOcrSuggestion(suggestOcrField('amount', '1250.00', 0.99, { suggestionId: 'sug-open', band: 'alta' })),
      suggestOcrField('paidDate', '2026-10-20', 1, { suggestionId: 'sug-quiet', band: 'media' }),
    ];
    const reviewed = keepTypedField(form, suggestion, 'amount').decision;
    expect(reviewed).not.toBeNull();

    const saved = discardUnreviewedSuggestions(form, [...unreviewed, suggestion, suggestion], reviewed ? [reviewed, reviewed] : []);
    expect(saved.form).toBe(form);
    expect(saved.form).toEqual({ amount: '', paidDate: '', note: 'nota' });
    expect(saved.discarded.map((item) => item.suggestionId)).toEqual(['sug-open', 'sug-quiet']);
    expect(saved.notice).toBe(OCR_UNREVIEWED_DISCARD_COPY);
    expect(saved.notice).toBe('Las sugerencias sin revisar se descartarán al registrar.');
    expect(saved.payload.map((row) => row.suggestionId)).toEqual(['sug-open', 'sug-quiet', 'sug-9']);
    expect(new Set(saved.payload.map((row) => row.suggestionId)).size).toBe(saved.payload.length);
    expect(saved.payload.map((row) => row.action)).toEqual(['reject', 'reject', 'reject']);
    expect(saved.request).toEqual({ decisions: saved.payload });
    const body = serializeConfirmPayload(saved.payload);
    expect(JSON.parse(body)).toEqual({
      decisions: [
        { suggestionId: 'sug-open', action: 'reject' },
        { suggestionId: 'sug-quiet', action: 'reject' },
        { suggestionId: 'sug-9', action: 'reject' },
      ],
    });
    expect(body).not.toContain(TYPED);
    expect(body).not.toMatch(/"decision"|"field"|"suggestedValue"|"replaced"|"kept"|"rejected"|"clientPriorValue"/);

    const allReviewed = discardUnreviewedSuggestions(form, [suggestion], reviewed ? [reviewed] : []);
    expect(allReviewed.form).toBe(form);
    expect(allReviewed.discarded).toEqual([]);
    expect(allReviewed.notice).toBeNull();
  });

  it('sends the latest choice when a suggestion is decided more than once', () => {
    const target = '11111111-1111-4111-8111-111111111111';
    const filled = { amount: '1.00', paidDate: '', note: '' };
    const suggestion = confirmOcrSuggestion(
      suggestOcrField('amount', '1250.00', 0.99, { suggestionId: 'sug-9', targetEntityId: target }),
    );
    const kept = keepTypedField(filled, suggestion, 'amount').decision;
    const replaced = tapReemplazar(filled, suggestion, 'amount').decision;
    const edited = editOcrField(filled, suggestion, 'amount', '10.50').decision;
    const rejected = rejectOcrField(filled, suggestion, 'amount').decision;
    expect(kept).not.toBeNull();
    expect(replaced).not.toBeNull();
    expect(edited).not.toBeNull();
    expect(rejected).not.toBeNull();
    if (!kept || !replaced || !edited || !rejected) {
      return;
    }

    expect(confirmOnRegistrar(filled, [suggestion, suggestion], [replaced, kept]).request?.decisions).toEqual([
      { suggestionId: 'sug-9', action: 'reject', targetEntityId: target },
    ]);
    expect(confirmOnRegistrar(filled, [suggestion], [kept, replaced]).request?.decisions).toEqual([
      { suggestionId: 'sug-9', action: 'replace', targetEntityId: target },
    ]);
    expect(confirmOnRegistrar(filled, [suggestion], [edited, rejected]).request?.decisions).toEqual([
      { suggestionId: 'sug-9', action: 'reject', targetEntityId: target },
    ]);

    const empty = { amount: '', paidDate: '', note: '' };
    const accepted = replaceField(empty, suggestion, 'amount').decision;
    const editedAfter = editOcrField(empty, suggestion, 'amount', '9.00').decision;
    expect(accepted?.ui).toBe('accepted');
    expect(editedAfter).not.toBeNull();
    if (!accepted || !editedAfter) {
      return;
    }
    expect(confirmOnRegistrar(empty, [suggestion], [accepted, editedAfter]).request?.decisions).toEqual([
      { suggestionId: 'sug-9', action: 'edit', editedValue: '9.00', targetEntityId: target },
    ]);
  });

  it('restores the form after Reemplazar then Mantener, and a later Reemplazar wins', () => {
    const target = '11111111-1111-4111-8111-111111111111';
    const filled = { amount: '1.00', paidDate: '', note: '' };
    const suggestion = confirmOcrSuggestion(
      suggestOcrField('amount', '1250.00', 0.99, { suggestionId: 'sug-9', targetEntityId: target }),
    );

    const replaced = tapReemplazar(filled, suggestion, 'amount');
    expect(replaced.form.amount).toBe('1250.00');
    expect(replaced.previousValue).toBe('1.00');
    expect(filled.amount).toBe('1.00');

    const kept = keepTypedField(replaced.form, suggestion, 'amount', { previousValue: replaced.previousValue });
    expect(kept.form.amount).toBe('1.00');
    expect(kept.form.paidDate).toBe('');
    expect(kept.form.note).toBe('');
    expect(kept.decision?.ui).toBe('kept');

    const afterKeep = confirmOnRegistrar(kept.form, [suggestion], [replaced.decision!, kept.decision!]);
    expect(afterKeep.form).toBe(kept.form);
    expect(afterKeep.form.amount).toBe('1.00');
    expect(afterKeep.request?.decisions).toEqual([
      { suggestionId: 'sug-9', action: 'reject', targetEntityId: target },
    ]);
    const keptBody = serializeConfirmPayload(afterKeep.request?.decisions ?? []);
    expect(keptBody).not.toContain('1.00');
    expect(keptBody).not.toContain('1250.00');
    expect(keptBody).not.toContain('clientPriorValue');
    expect(keptBody).not.toContain('previousValue');

    const replacedAgain = tapReemplazar(kept.form, suggestion, 'amount');
    expect(replacedAgain.form.amount).toBe('1250.00');
    expect(replacedAgain.previousValue).toBe('1.00');
    const latest = confirmOnRegistrar(replacedAgain.form, [suggestion], [
      replaced.decision!,
      kept.decision!,
      replacedAgain.decision!,
    ]);
    expect(latest.form.amount).toBe('1250.00');
    expect(latest.request?.decisions).toEqual([
      { suggestionId: 'sug-9', action: 'replace', targetEntityId: target },
    ]);
    const replaceBody = serializeConfirmPayload(latest.request?.decisions ?? []);
    expect(replaceBody).not.toContain('1.00');
    expect(replaceBody).not.toContain('1250.00');
    expect(replaceBody).not.toContain('clientPriorValue');
    expect(replaceBody).not.toContain('previousValue');

    const draft = { amount: '1.00', paidDate: '', note: '' };
    const savedSuggestion = confirmOcrSuggestion(
      suggestOcrField('amount', '1250.00', 0.99, {
        suggestionId: 'sug-saved',
        targetEntityId: target,
        savedValue: '9.00',
      }),
    );
    const savedReplace = tapReemplazar(draft, savedSuggestion, 'amount');
    expect(savedReplace.form.amount).toBe('1250.00');
    const savedKeep = keepTypedField(savedReplace.form, savedSuggestion, 'amount', {
      previousValue: savedReplace.previousValue,
    });
    expect(savedKeep.form.amount).toBe('9.00');
    const savedRequest = confirmOnRegistrar(savedKeep.form, [savedSuggestion], [
      savedReplace.decision!,
      savedKeep.decision!,
    ]);
    expect(savedRequest.form.amount).toBe('9.00');
    expect(savedRequest.request?.decisions).toEqual([
      { suggestionId: 'sug-saved', action: 'reject', targetEntityId: target },
    ]);
    const savedBody = serializeConfirmPayload(savedRequest.request?.decisions ?? []);
    expect(savedBody).not.toContain('1.00');
    expect(savedBody).not.toContain('9.00');
    expect(savedBody).not.toContain('1250.00');
    expect(savedBody).not.toContain('clientPriorValue');
  });

  it('names the suggestion row that blocks confirm when the target is missing', () => {
    const form = { amount: '' };
    const suggestion = confirmOcrSuggestion(suggestOcrField('amount', '10.00', 0.9, { suggestionId: 'sug-open' }));
    const accepted = replaceField(form, suggestion, 'amount').decision;
    expect(accepted?.ui).toBe('accepted');
    const saved = confirmOnRegistrar(form, [suggestion], accepted ? [accepted] : []);
    expect(saved.request).toBeNull();
    expect(saved.payload).toEqual([]);
    expect(saved.targetErrors).toEqual([
      {
        suggestionId: 'sug-open',
        field: 'amount',
        key: 'ocr.target.required',
        message: 'Elige a qué pago aplica esta sugerencia.',
        scrollIntoView: true,
        scrollTargetId: 'ocr-suggestion-sug-open',
      },
    ]);
  });

  it('omits typed keys and clientPriorValue from the confirm wire', () => {
    const decision: OcrClientDecision = {
      suggestionId: 'sug-9',
      field: 'amount',
      ui: 'replaced',
      suggestedValue: '1250.00',
    };
    expect(ocrDecisionForServer(decision)).toEqual({
      suggestionId: 'sug-9',
      action: 'replace',
    });
    expect(Object.keys(ocrDecisionForServer(decision))).toEqual(['suggestionId', 'action']);

    for (const extra of [
      { previousTypedValue: TYPED },
      { typedValue: TYPED },
      { previousValue: TYPED },
      { persistedPreviousValue: TYPED },
      { actual: TYPED },
      { clientPriorValue: TYPED },
    ]) {
      const wire = ocrDecisionForServer({ ...decision, ...extra });
      expect(wire).toEqual({ suggestionId: 'sug-9', action: 'replace' });
      expect(JSON.stringify(wire)).not.toContain(TYPED);
      expect(JSON.stringify(wire)).not.toContain('clientPriorValue');
      expect(serializeOcrDecision({ ...decision, ...extra })).not.toContain(TYPED);
    }

    const poisoned = {
      ...decision,
      field: TYPED,
      targetEntityId: '11111111-1111-4111-8111-111111111111',
      clientPriorValue: TYPED,
    };
    const withTarget = ocrDecisionForServer(poisoned);
    expect(withTarget).toEqual({
      suggestionId: 'sug-9',
      action: 'replace',
      targetEntityId: '11111111-1111-4111-8111-111111111111',
    });
    expect(JSON.stringify(withTarget)).not.toContain(TYPED);
    expect(JSON.stringify(withTarget)).not.toContain('clientPriorValue');

    const body = serializeConfirmPayload([
      {
        suggestionId: 'sug-9',
        action: 'replace',
        ...({ clientPriorValue: TYPED } as object),
      },
    ]);
    expect(body).not.toContain('clientPriorValue');
    expect(body).not.toContain(TYPED);
  });

  it('covers every suggestion id once and sends targetEntityId only for unbound rows', () => {
    const target = '11111111-1111-4111-8111-111111111111';
    const boundId = '22222222-2222-4222-8222-222222222222';
    const form = { amount: '', paidDate: TYPED, note: 'nota' };
    const unbound = confirmOcrSuggestion(
      suggestOcrField('amount', '10.00', 0.99, { suggestionId: 'sug-open', targetEntityId: target }),
    );
    const bound = confirmOcrSuggestion(
      suggestOcrField('paidDate', '2026-10-20', 0.99, {
        suggestionId: 'sug-bound',
        targetEntityId: boundId,
        bound: true,
      }),
    );
    const quiet = suggestOcrField('note', 'otra', 0.5, { suggestionId: 'sug-quiet' });
    const accepted = replaceField(form, unbound, 'amount').decision;
    const replaced = tapReemplazar(form, bound, 'paidDate', { targetEntityId: target }).decision;
    expect(accepted).not.toBeNull();
    expect(replaced).not.toBeNull();

    const saved = discardUnreviewedSuggestions(
      form,
      [unbound, bound, quiet, unbound],
      accepted && replaced ? [accepted, replaced, accepted] : [],
    );
    expect(saved.form).toBe(form);
    expect(saved.payload.map((row) => row.suggestionId)).toEqual(['sug-open', 'sug-bound', 'sug-quiet']);
    expect(new Set(saved.payload.map((row) => row.suggestionId)).size).toBe(3);
    expect(saved.payload).toEqual([
      { suggestionId: 'sug-open', action: 'accept', targetEntityId: target },
      { suggestionId: 'sug-bound', action: 'replace' },
      { suggestionId: 'sug-quiet', action: 'reject' },
    ]);
    expect(saved.discarded.map((item) => item.suggestionId)).toEqual(['sug-quiet']);
    const body = JSON.parse(serializeConfirmPayload(saved.payload)) as {
      decisions: Array<Record<string, unknown>>;
    };
    expect(Object.keys(body)).toEqual(['decisions']);
    for (const row of body.decisions) {
      expect(Object.keys(row).every((key) => ['suggestionId', 'action', 'editedValue', 'targetEntityId'].includes(key))).toBe(
        true,
      );
    }
    expect(JSON.stringify(body)).not.toContain(TYPED);
    expect(JSON.stringify(body)).not.toContain(boundId);
    expect(JSON.stringify(body)).not.toContain('clientPriorValue');
  });
});
