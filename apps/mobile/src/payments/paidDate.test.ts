import { calendarDaysBetween } from '../dates/propertyCalendar';
import { paidDateWindow, validatePaidDate } from './paidDate';

const MEXICO_CITY = 'America/Mexico_City';
const TIJUANA = 'America/Tijuana';
const CANCUN = 'America/Cancun';

function expectWindow(
  now: Date,
  timeZone: string,
  today: string,
  span: 365 | 366,
) {
  const window = paidDateWindow(now, timeZone);
  expect(window.today).toBe(today);
  expect(calendarDaysBetween(window.min, window.today)).toBe(span);
  expect(calendarDaysBetween(window.today, window.max)).toBe(1);
  expect(validatePaidDate(window.min, now, timeZone).ok).toBe(true);
  expect(validatePaidDate(addDaysIso(window.min, -1), now, timeZone)).toEqual({
    ok: false,
    reason: 'too_old',
  });
  expect(validatePaidDate(window.max, now, timeZone).ok).toBe(true);
  expect(validatePaidDate(addDaysIso(window.max, 1), now, timeZone)).toEqual({
    ok: false,
    reason: 'too_future',
  });
  expect(validatePaidDate(today, now, timeZone).ok).toBe(true);
}

function addDaysIso(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const y = String(shifted.getUTCFullYear()).padStart(4, '0');
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

describe('paid date limits', () => {
  it('accepts today-365 and rejects the day before, and accepts today+1 while rejecting today+2', () => {
    const afternoon = new Date('2026-10-21T18:00:00.000Z');
    expectWindow(afternoon, MEXICO_CITY, '2026-10-21', 365);
    expect(validatePaidDate('2025-10-21', afternoon, MEXICO_CITY).ok).toBe(true);
    expect(validatePaidDate('2025-10-20', afternoon, MEXICO_CITY)).toEqual({ ok: false, reason: 'too_old' });
    expect(validatePaidDate('2026-10-22', afternoon, MEXICO_CITY).ok).toBe(true);
    expect(validatePaidDate('2026-10-23', afternoon, MEXICO_CITY)).toEqual({ ok: false, reason: 'too_future' });
  });

  it('uses a 366-day minimum when the span includes 29 February', () => {
    const afternoon = new Date('2024-03-01T18:00:00.000Z');
    expectWindow(afternoon, MEXICO_CITY, '2024-03-01', 366);
    expect(validatePaidDate('2023-03-01', afternoon, MEXICO_CITY).ok).toBe(true);
    expect(validatePaidDate('2023-02-28', afternoon, MEXICO_CITY)).toEqual({ ok: false, reason: 'too_old' });
    expect(validatePaidDate('2024-03-02', afternoon, MEXICO_CITY).ok).toBe(true);
    expect(validatePaidDate('2024-03-03', afternoon, MEXICO_CITY)).toEqual({ ok: false, reason: 'too_future' });

    const leapDay = new Date('2024-02-29T18:00:00.000Z');
    expectWindow(leapDay, MEXICO_CITY, '2024-02-29', 366);
    expect(validatePaidDate('2023-02-28', leapDay, MEXICO_CITY).ok).toBe(true);
    expect(validatePaidDate('2023-02-27', leapDay, MEXICO_CITY)).toEqual({ ok: false, reason: 'too_old' });
    expect(validatePaidDate('2024-03-01', leapDay, MEXICO_CITY).ok).toBe(true);
    expect(validatePaidDate('2024-03-02', leapDay, MEXICO_CITY)).toEqual({ ok: false, reason: 'too_future' });
  });

  it('moves the window at 23:59, 00:00, and 00:01 in the property zone on a UTC device', () => {
    expect(new Date().getTimezoneOffset()).toBe(0);
    const at2359 = new Date('2026-10-22T05:59:00.000Z');
    const at0000 = new Date('2026-10-22T06:00:00.000Z');
    const at0001 = new Date('2026-10-22T06:01:00.000Z');

    expect(validatePaidDate('2026-10-22', at2359, MEXICO_CITY).ok).toBe(true);
    expect(validatePaidDate('2026-10-23', at2359, MEXICO_CITY)).toEqual({ ok: false, reason: 'too_future' });
    expect(validatePaidDate('2025-10-21', at2359, MEXICO_CITY).ok).toBe(true);
    expect(validatePaidDate('2025-10-20', at2359, MEXICO_CITY)).toEqual({ ok: false, reason: 'too_old' });

    expect(validatePaidDate('2026-10-23', at0000, MEXICO_CITY).ok).toBe(true);
    expect(validatePaidDate('2026-10-24', at0000, MEXICO_CITY)).toEqual({ ok: false, reason: 'too_future' });
    expect(validatePaidDate('2025-10-22', at0000, MEXICO_CITY).ok).toBe(true);
    expect(validatePaidDate('2025-10-21', at0000, MEXICO_CITY)).toEqual({ ok: false, reason: 'too_old' });

    expect(validatePaidDate('2026-10-23', at0001, MEXICO_CITY).ok).toBe(true);
    expect(validatePaidDate('2026-10-24', at0001, MEXICO_CITY)).toEqual({ ok: false, reason: 'too_future' });
  });

  it('does not use the device zone when the property zone is not Mexico City', () => {
    const instant = new Date('2026-10-22T06:30:00.000Z');
    expect(validatePaidDate('2026-10-23', instant, MEXICO_CITY).ok).toBe(true);
    expect(validatePaidDate('2026-10-23', instant, TIJUANA)).toEqual({ ok: false, reason: 'too_future' });
    expect(validatePaidDate('2026-10-22', instant, TIJUANA).ok).toBe(true);

    const cancunMidnight = new Date('2026-10-22T05:30:00.000Z');
    expect(paidDateWindow(cancunMidnight, CANCUN).today).toBe('2026-10-22');
    expect(paidDateWindow(cancunMidnight, MEXICO_CITY).today).toBe('2026-10-21');
    expect(validatePaidDate('2026-10-23', cancunMidnight, CANCUN).ok).toBe(true);
    expect(validatePaidDate('2026-10-23', cancunMidnight, MEXICO_CITY)).toEqual({
      ok: false,
      reason: 'too_future',
    });
  });

  it('rejects a calendar date that does not exist', () => {
    const now = new Date('2026-10-21T18:00:00.000Z');
    expect(validatePaidDate('2026-02-31', now, MEXICO_CITY)).toEqual({ ok: false, reason: 'invalid_date' });
    expect(validatePaidDate('2025-02-29', now, MEXICO_CITY)).toEqual({ ok: false, reason: 'invalid_date' });
    expect(validatePaidDate('', now, MEXICO_CITY)).toEqual({ ok: false, reason: 'invalid_date' });
  });
});
