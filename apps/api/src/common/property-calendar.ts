/** Property.timezone default. Not the device time zone. */
export const DEFAULT_PROPERTY_TIMEZONE = 'America/Mexico_City';

const ISO_DATE = /^(\d{4})-\d{2}-\d{2}$/;

export interface CalendarParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

export function assertIanaTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
  } catch {
    throw new Error(`Invalid IANA time zone: ${timeZone}`);
  }
}

export function isIanaTimeZone(timeZone: string): boolean {
  try {
    assertIanaTimeZone(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function calendarDateInTimeZone(instant: Date, timeZone: string): string {
  const parts = zonedParts(instant, timeZone);
  return formatIsoDate(parts.year, parts.month, parts.day);
}

/** True once the property-local calendar date is after `dueIso`. The due date itself is not overdue. */
export function isPastDueDate(dueIso: string, now: Date, timeZone: string): boolean {
  return calendarDateInTimeZone(now, timeZone) > dueIso;
}

export function formatIsoDate(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseIsoDate(iso: string): { year: number; month: number; day: number } | null {
  if (!ISO_DATE.test(iso)) {
    return null;
  }
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > lastDayOfMonth(year, month)) {
    return null;
  }
  return { year, month, day };
}

export function addCalendarDays(iso: string, days: number): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) {
    throw new Error(`Invalid calendar date: ${iso}`);
  }
  const shifted = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  return formatIsoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** Same month and day, or the last valid day when the target year has no such day. */
export function addCalendarYears(iso: string, years: number): string {
  const parsed = parseIsoDate(iso);
  if (!parsed) {
    throw new Error(`Invalid calendar date: ${iso}`);
  }
  const targetYear = parsed.year + years;
  const day = Math.min(parsed.day, lastDayOfMonth(targetYear, parsed.month));
  return formatIsoDate(targetYear, parsed.month, day);
}

export function zonedParts(instant: Date, timeZone: string): CalendarParts {
  assertIanaTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const map = new Map(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  const hour = Number(map.get('hour'));
  return {
    year: Number(map.get('year')),
    month: Number(map.get('month')),
    day: Number(map.get('day')),
    hour: hour === 24 ? 0 : hour,
    minute: Number(map.get('minute')),
    second: Number(map.get('second')),
    millisecond: instant.getUTCMilliseconds(),
  };
}

/** UTC instant for a civil time in an IANA zone. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  timeZone: string,
): Date {
  const desired = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  let utc = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const shown = zonedParts(new Date(utc), timeZone);
    const shownUtc = Date.UTC(
      shown.year,
      shown.month - 1,
      shown.day,
      shown.hour,
      shown.minute,
      shown.second,
      shown.millisecond,
    );
    const next = utc + (desired - shownUtc);
    if (next === utc) {
      break;
    }
    utc = next;
  }
  return new Date(utc);
}

/** Shift the civil calendar date, keeping the local time of day. */
export function addZonedCalendarDays(instant: Date, days: number, timeZone: string): Date {
  const parts = zonedParts(instant, timeZone);
  const shifted = addCalendarDays(formatIsoDate(parts.year, parts.month, parts.day), days);
  const date = parseIsoDate(shifted);
  if (!date) {
    throw new Error(`Invalid calendar date: ${shifted}`);
  }
  return zonedTimeToUtc(date.year, date.month, date.day, parts.hour, parts.minute, parts.second, parts.millisecond, timeZone);
}

export function addZonedCalendarYears(instant: Date, years: number, timeZone: string): Date {
  const parts = zonedParts(instant, timeZone);
  const shifted = addCalendarYears(formatIsoDate(parts.year, parts.month, parts.day), years);
  const date = parseIsoDate(shifted);
  if (!date) {
    throw new Error(`Invalid calendar date: ${shifted}`);
  }
  return zonedTimeToUtc(date.year, date.month, date.day, parts.hour, parts.minute, parts.second, parts.millisecond, timeZone);
}
