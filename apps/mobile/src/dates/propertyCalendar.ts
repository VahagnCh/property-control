/** Property.timezone default. Not the device time zone. */
export const DEFAULT_PROPERTY_TIMEZONE = 'America/Mexico_City';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function assertIanaTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
  } catch {
    throw new Error(`Invalid IANA time zone: ${timeZone}`);
  }
}

export function calendarDateInTimeZone(instant: Date, timeZone: string): string {
  assertIanaTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const year = datePart(parts, 'year');
  const month = datePart(parts, 'month');
  const day = datePart(parts, 'day');
  return `${year}-${month}-${day}`;
}

function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const found = parts.find((part) => part.type === type);
  if (!found) {
    throw new Error(`Missing date part: ${type}`);
  }
  return found.value;
}

export function parseIsoDate(iso: string): { year: number; month: number; day: number } {
  const match = ISO_DATE.exec(iso);
  if (!match) {
    throw new Error(`Invalid calendar date: ${iso}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > lastDayOfMonth(year, month)) {
    throw new Error(`Invalid calendar date: ${iso}`);
  }
  return { year, month, day };
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

export function addCalendarDays(iso: string, days: number): string {
  const { year, month, day } = parseIsoDate(iso);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return formatIsoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** Same month and day, or the last valid day when the target year has no such day. */
export function addCalendarYears(iso: string, years: number): string {
  const { year, month, day } = parseIsoDate(iso);
  const targetYear = year + years;
  const dayInMonth = Math.min(day, lastDayOfMonth(targetYear, month));
  return formatIsoDate(targetYear, month, dayInMonth);
}

export function calendarDaysBetween(earlier: string, later: string): number {
  const start = parseIsoDate(earlier);
  const end = parseIsoDate(later);
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  return Math.round((endMs - startMs) / 86_400_000);
}
