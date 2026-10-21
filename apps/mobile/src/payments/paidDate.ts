import { addCalendarDays, addCalendarYears, calendarDateInTimeZone, parseIsoDate } from '../dates/propertyCalendar';

export type PaidDateRejection = 'invalid_date' | 'too_old' | 'too_future';

export type PaidDateWindow = {
  today: string;
  min: string;
  max: string;
};

/**
 * Paid calendar date in the property time zone.
 * Minimum is one calendar year back (365 or 366 days, Feb 29 clamped).
 * Maximum is tomorrow in that time zone (+1 day). The day after that is refused.
 */
export function paidDateWindow(now: Date, timeZone: string): PaidDateWindow {
  const today = calendarDateInTimeZone(now, timeZone);
  return {
    today,
    min: addCalendarYears(today, -1),
    max: addCalendarDays(today, 1),
  };
}

export function validatePaidDate(
  paidDate: string,
  now: Date,
  timeZone: string,
): { ok: true; paidDate: string } | { ok: false; reason: PaidDateRejection } {
  try {
    parseIsoDate(paidDate);
  } catch {
    return { ok: false, reason: 'invalid_date' };
  }
  const window = paidDateWindow(now, timeZone);
  if (paidDate < window.min) {
    return { ok: false, reason: 'too_old' };
  }
  if (paidDate > window.max) {
    return { ok: false, reason: 'too_future' };
  }
  return { ok: true, paidDate };
}
