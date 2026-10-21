import {
  applyOcrSuggestion,
  applyOcrSuggestions,
  confirmOcrSuggestion,
  suggestOcrField,
} from './applyOcrSuggestion';

const emptyForm = { amount: '', paidDate: '', note: '' };

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
