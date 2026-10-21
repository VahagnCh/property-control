import { UnprocessableEntityException } from '@nestjs/common';
import {
  DEFAULT_PROPERTY_TIMEZONE,
  addZonedCalendarDays,
  addZonedCalendarYears,
} from '../common/property-calendar.js';

export interface PaidAtBounds {
  min: Date;
  max: Date;
}

/**
 * Server window in the property timezone.
 * min is the existing one-year back-date (same local time, Feb 29 clamped).
 * max is one calendar day of clock skew after the server instant.
 * The client picker caps at today; that extra day is server-only.
 */
export function paidAtBounds(now: Date, timeZone: string = DEFAULT_PROPERTY_TIMEZONE): PaidAtBounds {
  return {
    min: addZonedCalendarYears(now, -1, timeZone),
    max: addZonedCalendarDays(now, 1, timeZone),
  };
}

export function assertPaidAt(paidAt: Date, now: Date, timeZone: string = DEFAULT_PROPERTY_TIMEZONE): void {
  if (Number.isNaN(paidAt.getTime())) {
    throw rejected();
  }
  const bounds = paidAtBounds(now, timeZone);
  if (paidAt.getTime() < bounds.min.getTime() || paidAt.getTime() > bounds.max.getTime()) {
    throw rejected();
  }
}

function rejected(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    statusCode: 422,
    message: 'paidAt is outside the allowed range.',
    error: 'paid_at_out_of_range',
  });
}
