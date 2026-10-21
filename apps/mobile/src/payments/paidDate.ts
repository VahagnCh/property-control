import {
  addCalendarYears,
  calendarDateInTimeZone,
  DEFAULT_PROPERTY_TIMEZONE,
  parseIsoDate,
} from '../dates/propertyCalendar';

export type PaidDateRejection = 'invalid_date' | 'too_old' | 'too_future';

export type PaidDateWindow = {
  today: string;
  min: string;
  max: string;
};

/**
 * Paid calendar date in the property IANA time zone.
 * The default zone is America/Mexico_City.
 *
 * Minimum is one calendar year back (365 or 366 days; 29 Feb clamps).
 * Maximum is today in that zone. AC-DATE-01 / EC-7.1: the server accepts
 * paidAt up to one day ahead only as clock-skew tolerance. The picker and
 * this validator never offer that extra day. Today is allowed. Today+1 is rejected.
 */
export function paidDateWindow(
  now: Date,
  timeZone: string = DEFAULT_PROPERTY_TIMEZONE,
): PaidDateWindow {
  const today = calendarDateInTimeZone(now, timeZone);
  return {
    today,
    min: addCalendarYears(today, -1),
    max: today,
  };
}

export function validatePaidDate(
  paidDate: string,
  now: Date,
  timeZone: string = DEFAULT_PROPERTY_TIMEZONE,
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
