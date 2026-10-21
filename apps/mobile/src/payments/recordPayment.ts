import { parseMxnToCentavos } from './money';
import { validatePaidDate } from './paidDate';

export type RecordPaymentDraft = {
  obligationId: string;
  amount: string;
  paidDate: string;
  /** Absent, null, or blank means the person saved without a comprobante. */
  evidenceId?: string | null;
};

export type RecordPaymentIssue =
  | 'obligation'
  | 'amount_missing'
  | 'amount_invalid'
  | 'amount_not_positive'
  | 'paid_date_invalid'
  | 'paid_date_too_old'
  | 'paid_date_too_future';

export const RECORD_PAYMENT_MESSAGES: Record<RecordPaymentIssue, string> = {
  obligation: 'Elige una obligación.',
  amount_missing: 'Indica el monto.',
  amount_invalid: 'El monto no es válido.',
  amount_not_positive: 'El monto tiene que ser mayor que cero.',
  paid_date_invalid: 'La fecha no es válida.',
  paid_date_too_old: 'La fecha es demasiado anterior.',
  paid_date_too_future: 'La fecha es demasiado posterior.',
};

export type RecordPaymentResult =
  | { ok: true; centavos: number; paidDate: string }
  | { ok: false; issues: RecordPaymentIssue[] };

/**
 * A missing comprobante is not an issue. evidenceId is ignored for blocking.
 */
export function validateRecordPayment(
  draft: RecordPaymentDraft,
  now: Date,
  timeZone: string,
): RecordPaymentResult {
  const issues: RecordPaymentIssue[] = [];
  let centavos = 0;

  if (draft.obligationId.trim() === '') {
    issues.push('obligation');
  }

  if (draft.amount.trim() === '') {
    issues.push('amount_missing');
  } else {
    try {
      centavos = parseMxnToCentavos(draft.amount);
      if (centavos <= 0) {
        issues.push('amount_not_positive');
      }
    } catch {
      issues.push('amount_invalid');
    }
  }

  const paid = validatePaidDate(draft.paidDate, now, timeZone);
  if (!paid.ok) {
    if (paid.reason === 'invalid_date') {
      issues.push('paid_date_invalid');
    } else if (paid.reason === 'too_old') {
      issues.push('paid_date_too_old');
    } else {
      issues.push('paid_date_too_future');
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, centavos, paidDate: draft.paidDate };
}
