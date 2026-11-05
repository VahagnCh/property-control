import {
  addCalendarYears,
  calendarDateInTimeZone,
  DEFAULT_PROPERTY_TIMEZONE,
  parseIsoDate,
} from './propertyCalendar';
import { copyText, fillCopy } from '../copy/userFacing';

export type NextDueDateRejection = 'invalid_date' | 'too_old' | 'too_future';

export type NextDueDateWindow = {
  today: string;
  min: string;
  max: string;
};

/**
 * Client input window for an obligation nextDueDate, in the property IANA
 * time zone. Default zone is America/Mexico_City.
 *
 * Minimum is today minus one calendar year. Maximum is today plus five
 * calendar years. 29 Feb clamps when the target year has no such day.
 * The database bound of 1990–2100 is the server's concern, not this window.
 */
export function nextDueDateWindow(
  now: Date,
  timeZone: string = DEFAULT_PROPERTY_TIMEZONE,
): NextDueDateWindow {
  const today = calendarDateInTimeZone(now, timeZone);
  return {
    today,
    min: addCalendarYears(today, -1),
    max: addCalendarYears(today, 5),
  };
}

export function validateNextDueDate(
  nextDueDate: string,
  now: Date,
  timeZone: string = DEFAULT_PROPERTY_TIMEZONE,
): { ok: true; nextDueDate: string } | { ok: false; reason: NextDueDateRejection } {
  try {
    parseIsoDate(nextDueDate);
  } catch {
    return { ok: false, reason: 'invalid_date' };
  }
  const window = nextDueDateWindow(now, timeZone);
  if (nextDueDate < window.min) {
    return { ok: false, reason: 'too_old' };
  }
  if (nextDueDate > window.max) {
    return { ok: false, reason: 'too_future' };
  }
  return { ok: true, nextDueDate };
}

export type NextDueDateFieldError = {
  field: 'nextDueDate';
  key: 'obligation.nextDueDate.outOfRange';
  message: string;
};

const ES_MX_MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const;

/** Short es-MX calendar date, for example "20 oct 2025". The ISO value stays the wire value. */
export function formatEsMxDate(iso: string): string {
  const { year, month, day } = parseIsoDate(iso);
  return `${day} ${ES_MX_MONTHS[month - 1]} ${year}`;
}

export function nextDueDateRangeMessage(
  now: Date = new Date(),
  timeZone: string = DEFAULT_PROPERTY_TIMEZONE,
): string {
  const window = nextDueDateWindow(now, timeZone);
  return fillCopy(copyText('obligation.nextDueDate.outOfRange'), {
    min: formatEsMxDate(window.min),
    max: formatEsMxDate(window.max),
  });
}

/** AC-OBL-03. A 422 from the server is a field error. Other statuses are not. */
export function mapNextDueDateServerError(
  status: number,
  now: Date = new Date(),
  timeZone: string = DEFAULT_PROPERTY_TIMEZONE,
): NextDueDateFieldError | null {
  if (status !== 422) {
    return null;
  }
  return {
    field: 'nextDueDate',
    key: 'obligation.nextDueDate.outOfRange',
    message: nextDueDateRangeMessage(now, timeZone),
  };
}
