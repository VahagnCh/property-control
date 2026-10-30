import { calendarDateInTimeZone, DEFAULT_PROPERTY_TIMEZONE, parseIsoDate } from '../dates/propertyCalendar';
import { formatWireAmount, parseMxnToCentavos, type WireMoney } from '../payments/money';
import { ApiClientError } from './errors';

const MONEY_KEYS = new Set(['amount', 'expectedAmount', 'overpaidAmount']);

/** Canonical two-decimal peso string. Digit arithmetic only, never a float. */
export function canonicalPesoAmount(amount: string): string {
  if (typeof amount !== 'string') {
    throw new ApiClientError('amount_invalid', 'common.error', null);
  }
  try {
    return formatWireAmount(parseMxnToCentavos(amount));
  } catch {
    throw new ApiClientError('amount_invalid', 'common.error', null);
  }
}

export function wireMoney(amount: string): WireMoney {
  return { amount: canonicalPesoAmount(amount), currency: 'MXN' };
}

/**
 * A numeric amount would be serialized as a JSON number. Reject it before
 * the request is sent so the wire value cannot become a float.
 */
export function assertDecimalMoney(value: unknown): void {
  if (value === null || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertDecimalMoney(item);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (MONEY_KEYS.has(key) && typeof child !== 'string') {
      throw new ApiClientError('amount_invalid', 'common.error', null);
    }
    assertDecimalMoney(child);
  }
}

/**
 * Calendar date in the property zone. `toISOString().slice(0, 10)` shifts
 * the date at 23:59 in America/Mexico_City, which is already the next UTC day.
 */
export function paidAtOnPropertyCalendar(
  instant: Date,
  timeZone: string = DEFAULT_PROPERTY_TIMEZONE,
): string {
  return calendarDateInTimeZone(instant, timeZone);
}

export function assertCalendarDate(iso: string): string {
  try {
    parseIsoDate(iso);
  } catch {
    throw new ApiClientError('paid_at_out_of_range', 'common.error', null);
  }
  return iso;
}
