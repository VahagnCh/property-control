import { addCalendarDays, calendarDateInTimeZone, calendarDaysBetween } from './propertyCalendar';

/**
 * Due label for a calendar date (YYYY-MM-DD) compared with "today" in the
 * property IANA time zone. Never reads the device time zone.
 */
export function dueLabel(dueDate: string, now: Date, timeZone: string): string {
  const today = calendarDateInTimeZone(now, timeZone);
  if (dueDate === today) {
    return 'Vence hoy';
  }
  const tomorrow = addCalendarDays(today, 1);
  if (dueDate === tomorrow) {
    return 'Vence mañana';
  }
  if (dueDate < today) {
    const days = calendarDaysBetween(dueDate, today);
    return days === 1 ? 'Venció hace 1 día' : `Venció hace ${days} días`;
  }
  return `Vence el ${dueDate}`;
}
