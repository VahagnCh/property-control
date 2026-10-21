import { UnprocessableEntityException } from '@nestjs/common';
import {
  DEFAULT_PROPERTY_TIMEZONE,
  addCalendarDays,
  addCalendarYears,
  calendarDateInTimeZone,
  parseIsoDate,
} from '../common/property-calendar.js';

export const NEXT_DUE_DATE_ERROR = 'next_due_date_out_of_range';
export const NEXT_DUE_DATE_MIN_YEAR = 1990;
export const NEXT_DUE_DATE_MAX_YEAR = 2100;

export interface NextDueDateWindow {
  min: string;
  max: string;
}

/** Today minus 1 calendar year through today plus 5 calendar years, in the property timezone. */
export function nextDueDateWindow(now: Date, timeZone: string = DEFAULT_PROPERTY_TIMEZONE): NextDueDateWindow {
  const today = calendarDateInTimeZone(now, timeZone);
  return {
    min: addCalendarYears(today, -1),
    max: addCalendarYears(today, 5),
  };
}

export function isNextDueDateSanity(iso: string): boolean {
  const parsed = parseIsoDate(iso);
  if (!parsed) {
    return false;
  }
  return parsed.year >= NEXT_DUE_DATE_MIN_YEAR && parsed.year <= NEXT_DUE_DATE_MAX_YEAR;
}

/**
 * API window first in the message clients see. The 1990–2100 sanity bound is
 * checked as well, including dates the rolling window would already refuse.
 */
export function assertNextDueDateInRange(
  iso: string,
  now: Date,
  timeZone: string = DEFAULT_PROPERTY_TIMEZONE,
): void {
  if (!isNextDueDateSanity(iso)) {
    throw outOfRange();
  }
  const window = nextDueDateWindow(now, timeZone);
  if (iso < window.min || iso > window.max) {
    throw outOfRange();
  }
}

export function dayBeyond(iso: string, direction: -1 | 1): string {
  return addCalendarDays(iso, direction);
}

function outOfRange(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    statusCode: 422,
    message: 'nextDueDate is outside the allowed range.',
    error: NEXT_DUE_DATE_ERROR,
  });
}
