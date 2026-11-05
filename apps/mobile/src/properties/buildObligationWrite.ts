import { canonicalPesoAmount } from '../api/money';
import type { ObligationCategory, ObligationRecurrence, ObligationWriteBody } from '../api/contract';
import type { CopyKey } from '../copy/userFacing';
import { calendarDateInTimeZone, DEFAULT_PROPERTY_TIMEZONE } from '../dates/propertyCalendar';
import { validateNextDueDate } from '../dates/nextDueDate';
import { validateTextInput } from '../forms/textInput';
import { FIELD_LIMITS } from './fieldLimits';

const NEEDS_SCHEDULE = new Set<ObligationRecurrence>([
  'monthly',
  'bimonthly',
  'quarterly',
  'semiannual',
  'annual',
]);

export type ObligationDraft = {
  category: ObligationCategory | null;
  title: string;
  providerName: string;
  recurrence: ObligationRecurrence;
  nextDueDate: string;
  expectedAmount: string;
  notes: string;
};

/** Calendar date in the property zone. 23:59 in America/Mexico_City stays that day. */
export function suggestedNextDueDate(now: Date, timeZone: string = DEFAULT_PROPERTY_TIMEZONE): string {
  return calendarDateInTimeZone(now, timeZone);
}

export function buildObligationWrite(
  draft: ObligationDraft,
  now: Date,
  timeZone: string = DEFAULT_PROPERTY_TIMEZONE,
): { ok: true; body: ObligationWriteBody } | { ok: false; key: CopyKey } {
  if (!draft.category) {
    return { ok: false, key: 'form.text.required' };
  }
  if (draft.title.trim().length > FIELD_LIMITS.obligationTitle) {
    return { ok: false, key: 'form.title.tooLong' };
  }
  const title = validateTextInput(draft.title, 'title');
  if (!title.ok) {
    return { ok: false, key: title.key };
  }
  const due = validateNextDueDate(draft.nextDueDate, now, timeZone);
  if (!due.ok) {
    return { ok: false, key: 'obligation.nextDueDate.outOfRange' };
  }
  const body: ObligationWriteBody = {
    category: draft.category,
    title: title.value,
    recurrence: draft.recurrence,
    nextDueDate: due.nextDueDate,
    reminderOffsets: [7, 1],
    isActive: true,
  };
  const provider = draft.providerName.trim();
  if (provider.length > FIELD_LIMITS.providerName) {
    return { ok: false, key: 'form.title.tooLong' };
  }
  if (provider) {
    const checked = validateTextInput(provider, 'title');
    if (!checked.ok) {
      return { ok: false, key: checked.key };
    }
    body.providerName = checked.value;
  }
  if (NEEDS_SCHEDULE.has(draft.recurrence)) {
    body.dueDay = Number(due.nextDueDate.slice(8, 10));
    body.scheduleAnchor = due.nextDueDate;
  }
  const amount = draft.expectedAmount.trim();
  if (amount) {
    try {
      body.expectedAmount = canonicalPesoAmount(amount);
    } catch {
      return { ok: false, key: 'form.amount.invalid' };
    }
  }
  const notes = draft.notes.trim();
  if (notes) {
    const checked = validateTextInput(notes, 'notes');
    if (!checked.ok) {
      return { ok: false, key: checked.key };
    }
    body.notes = checked.value;
  }
  return { ok: true, body };
}
