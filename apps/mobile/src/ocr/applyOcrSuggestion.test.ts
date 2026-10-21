import {
  applyOcrSuggestion,
  applyOcrSuggestions,
  confirmOcrSuggestion,
  keepTypedField,
  ocrDecisionForServer,
  rejectOcrField,
  replaceField,
  replaceSuggestionRow,
  serializeOcrDecision,
  suggestOcrField,
  type OcrClientDecision,
} from './applyOcrSuggestion';
import { OCR_REPLACE_TOAST } from '../copy/userFacing';

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

    const replaced = replaceField(form, suggestion, 'amount');
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
      decision: 'replaced',
      suggestedValue: '1250.00',
    });
  });

  it('fills an empty field only after confirm', () => {
    const unconfirmed = replaceField(emptyForm, { ...suggestion, confirmed: false }, 'amount');
    expect(unconfirmed.form).toBe(emptyForm);
    expect(unconfirmed.decision).toBeNull();

    const filled = replaceField(emptyForm, suggestion, 'amount');
    expect(filled.form.amount).toBe('1250.00');
    expect(filled.previousValue).toBe('');
    expect(filled.decision?.decision).toBe('replaced');
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
      decision: 'kept',
      suggestedValue: '1250.00',
    });

    const rejected = rejectOcrField(form, suggestion, 'amount');
    expect(rejected.form).toBe(form);
    expect(rejected.form.amount).toBe(TYPED);
    expect(rejected.decision).toEqual({
      suggestionId: 'sug-9',
      field: 'amount',
      decision: 'rejected',
      suggestedValue: '1250.00',
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

    const one = replaceField(form, suggestions[0]!, 'amount');
    expect(one.form.amount).toBe('2.00');
    expect(one.form.paidDate).toBe('2026-10-01');
    expect(one.form.note).toBe('nota');
    expect(one.decision?.field).toBe('amount');
  });

  it('serializes a decision with no typed or previous value, including a record that is already saved', () => {
    const form = { amount: TYPED, paidDate: '', note: '' };
    const replaced = replaceField(form, suggestion, 'amount');
    const decision = replaced.decision;
    expect(decision).not.toBeNull();
    if (!decision) {
      return;
    }

    expect(Object.keys(decision)).toEqual(['suggestionId', 'field', 'decision', 'suggestedValue']);
    expect(JSON.stringify(replaced)).toContain(TYPED);
    expect(serializeOcrDecision(decision)).not.toContain(TYPED);
    expect(serializeOcrDecision(decision)).not.toMatch(/previous|typed/i);

    const poisoned = {
      ...decision,
      previousTypedValue: TYPED,
      previousValue: TYPED,
      typedValue: TYPED,
      persistedPreviousValue: TYPED,
      actual: TYPED,
    };
    const payload = ocrDecisionForServer(poisoned);
    const json = serializeOcrDecision(poisoned);
    expect(payload).toEqual({
      suggestionId: 'sug-9',
      field: 'amount',
      decision: 'replaced',
      suggestedValue: '1250.00',
    });
    expect(json).toBe(JSON.stringify(payload));
    expect(json).not.toContain(TYPED);
    for (const key of [
      'previousValue',
      'previousTypedValue',
      'typedValue',
      'persistedPreviousValue',
      'actual',
    ]) {
      expect(payload).not.toHaveProperty(key);
    }

    const saved: OcrClientDecision = {
      suggestionId: 'sug-saved',
      field: 'note',
      decision: 'kept',
      suggestedValue: 'folio',
    };
    expect(ocrDecisionForServer(saved)).toEqual(saved);
    expect(Object.keys(ocrDecisionForServer(saved))).toEqual([
      'suggestionId',
      'field',
      'decision',
      'suggestedValue',
    ]);
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
});
