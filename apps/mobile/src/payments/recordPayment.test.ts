import { validateRecordPayment } from './recordPayment';

const now = new Date('2026-10-21T18:00:00.000Z');
const timeZone = 'America/Mexico_City';

const draft = {
  obligationId: 'ob-1',
  amount: '10.00',
  paidDate: '2026-10-21',
};

describe('record payment validation', () => {
  it('passes with no comprobante and does not add an evidence issue', () => {
    const omitted = validateRecordPayment(draft, now, timeZone);
    const explicitNull = validateRecordPayment({ ...draft, evidenceId: null }, now, timeZone);
    const blank = validateRecordPayment({ ...draft, evidenceId: '' }, now, timeZone);

    expect(omitted).toEqual({ ok: true, centavos: 1000, paidDate: '2026-10-21' });
    expect(explicitNull).toEqual(omitted);
    expect(blank).toEqual(omitted);

    const missingAmount = validateRecordPayment({ ...draft, amount: '', evidenceId: null }, now, timeZone);
    expect(missingAmount).toEqual({ ok: false, issues: ['amount_missing'] });
  });

  it('still refuses a paid date outside the property window when evidence is absent', () => {
    expect(
      validateRecordPayment({ ...draft, paidDate: '2026-10-22', evidenceId: null }, now, timeZone),
    ).toEqual({ ok: false, issues: ['paid_date_too_future'] });
    expect(
      validateRecordPayment({ ...draft, paidDate: '2026-10-23', evidenceId: null }, now, timeZone),
    ).toEqual({ ok: false, issues: ['paid_date_too_future'] });
    expect(
      validateRecordPayment({ ...draft, paidDate: '2025-10-20' }, now, timeZone),
    ).toEqual({ ok: false, issues: ['paid_date_too_old'] });
    expect(validateRecordPayment({ ...draft, paidDate: '2026-10-21' }, now, timeZone).ok).toBe(true);
    expect(validateRecordPayment({ ...draft, paidDate: '2025-10-21' }, now, timeZone).ok).toBe(true);
  });

  it('requires an obligation and a positive amount without mentioning a comprobante', () => {
    const result = validateRecordPayment(
      { obligationId: '  ', amount: '0.00', paidDate: '2026-10-21', evidenceId: null },
      now,
      timeZone,
    );
    expect(result).toEqual({ ok: false, issues: ['obligation', 'amount_not_positive'] });
    expect(JSON.stringify(result)).not.toMatch(/comprobante|evidence/i);
  });
});
