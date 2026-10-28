import { withDeviceLocalBlocked } from '../test/withDeviceLocalBlocked';
import { mapNextDueDateServerError, nextDueDateWindow, validateNextDueDate } from './nextDueDate';

const MEXICO_CITY = 'America/Mexico_City';
const TIJUANA = 'America/Tijuana';
const CANCUN = 'America/Cancun';

describe('nextDueDate input window', () => {
  it('AC-OBL-01 accepts today-1y and today+5y and rejects the days outside', () => {
    const afternoon = new Date('2026-10-21T18:00:00.000Z');
    const window = nextDueDateWindow(afternoon, MEXICO_CITY);
    expect(window).toEqual({
      today: '2026-10-21',
      min: '2025-10-21',
      max: '2031-10-21',
    });
    expect(nextDueDateWindow(afternoon)).toEqual(window);

    expect(validateNextDueDate('2025-10-21', afternoon, MEXICO_CITY).ok).toBe(true);
    expect(validateNextDueDate('2025-10-20', afternoon, MEXICO_CITY)).toEqual({
      ok: false,
      reason: 'too_old',
    });
    expect(validateNextDueDate('2031-10-21', afternoon, MEXICO_CITY).ok).toBe(true);
    expect(validateNextDueDate('2031-10-22', afternoon, MEXICO_CITY)).toEqual({
      ok: false,
      reason: 'too_future',
    });
    expect(validateNextDueDate('2026-10-21', afternoon).ok).toBe(true);
    expect(validateNextDueDate('2026-02-31', afternoon, MEXICO_CITY)).toEqual({
      ok: false,
      reason: 'invalid_date',
    });
    expect(validateNextDueDate('05/10/2026', afternoon, MEXICO_CITY)).toEqual({
      ok: false,
      reason: 'invalid_date',
    });
  });

  it('AC-OBL-02 covers leap day, midnight, and a non-default zone', () => {
    withDeviceLocalBlocked(() => {
    const leapDay = new Date('2024-02-29T18:00:00.000Z');
    expect(nextDueDateWindow(leapDay, MEXICO_CITY)).toEqual({
      today: '2024-02-29',
      min: '2023-02-28',
      max: '2029-02-28',
    });
    expect(validateNextDueDate('2024-02-29', leapDay, MEXICO_CITY).ok).toBe(true);
    expect(validateNextDueDate('2023-02-28', leapDay, MEXICO_CITY).ok).toBe(true);
    expect(validateNextDueDate('2023-02-27', leapDay, MEXICO_CITY)).toEqual({
      ok: false,
      reason: 'too_old',
    });
    expect(validateNextDueDate('2029-02-28', leapDay, MEXICO_CITY).ok).toBe(true);
    expect(validateNextDueDate('2029-03-01', leapDay, MEXICO_CITY)).toEqual({
      ok: false,
      reason: 'too_future',
    });
    expect(validateNextDueDate('2023-02-29', leapDay, MEXICO_CITY)).toEqual({
      ok: false,
      reason: 'invalid_date',
    });
    expect(validateNextDueDate('2028-02-29', leapDay, MEXICO_CITY).ok).toBe(true);

    const march = new Date('2023-03-01T18:00:00.000Z');
    expect(nextDueDateWindow(march, MEXICO_CITY).max).toBe('2028-03-01');
    expect(validateNextDueDate('2024-02-29', march, MEXICO_CITY).ok).toBe(true);
    expect(validateNextDueDate('2028-02-29', march, MEXICO_CITY).ok).toBe(true);
    expect(validateNextDueDate('2028-03-01', march, MEXICO_CITY).ok).toBe(true);
    expect(validateNextDueDate('2028-03-02', march, MEXICO_CITY)).toEqual({
      ok: false,
      reason: 'too_future',
    });

    const at2359 = new Date('2026-10-22T05:59:00.000Z');
    const at0000 = new Date('2026-10-22T06:00:00.000Z');
    const at0001 = new Date('2026-10-22T06:01:00.000Z');

    expect(nextDueDateWindow(at2359, MEXICO_CITY)).toEqual({
      today: '2026-10-21',
      min: '2025-10-21',
      max: '2031-10-21',
    });
    expect(validateNextDueDate('2025-10-21', at2359, MEXICO_CITY).ok).toBe(true);
    expect(validateNextDueDate('2025-10-20', at2359, MEXICO_CITY)).toEqual({
      ok: false,
      reason: 'too_old',
    });
    expect(validateNextDueDate('2031-10-21', at2359, MEXICO_CITY).ok).toBe(true);
    expect(validateNextDueDate('2031-10-22', at2359, MEXICO_CITY)).toEqual({
      ok: false,
      reason: 'too_future',
    });

    expect(nextDueDateWindow(at0000, MEXICO_CITY).today).toBe('2026-10-22');
    expect(validateNextDueDate('2025-10-22', at0000, MEXICO_CITY).ok).toBe(true);
    expect(validateNextDueDate('2025-10-21', at0000, MEXICO_CITY)).toEqual({
      ok: false,
      reason: 'too_old',
    });
    expect(validateNextDueDate('2031-10-22', at0000, MEXICO_CITY).ok).toBe(true);
    expect(validateNextDueDate('2031-10-23', at0000, MEXICO_CITY)).toEqual({
      ok: false,
      reason: 'too_future',
    });

    expect(nextDueDateWindow(at0001, MEXICO_CITY).today).toBe('2026-10-22');
    expect(validateNextDueDate('2031-10-22', at0001, MEXICO_CITY).ok).toBe(true);
    expect(validateNextDueDate('2031-10-23', at0001, MEXICO_CITY)).toEqual({
      ok: false,
      reason: 'too_future',
    });

    const instant = new Date('2026-10-22T06:30:00.000Z');
    expect(nextDueDateWindow(instant, MEXICO_CITY).today).toBe('2026-10-22');
    expect(nextDueDateWindow(instant, TIJUANA).today).toBe('2026-10-21');
    expect(validateNextDueDate('2031-10-22', instant, MEXICO_CITY).ok).toBe(true);
    expect(validateNextDueDate('2031-10-22', instant, TIJUANA)).toEqual({
      ok: false,
      reason: 'too_future',
    });
    expect(validateNextDueDate('2031-10-21', instant, TIJUANA).ok).toBe(true);
    expect(validateNextDueDate('2025-10-21', instant, TIJUANA).ok).toBe(true);
    expect(validateNextDueDate('2025-10-20', instant, TIJUANA)).toEqual({
      ok: false,
      reason: 'too_old',
    });

    const cancunMidnight = new Date('2026-10-22T05:30:00.000Z');
    expect(nextDueDateWindow(cancunMidnight, CANCUN).today).toBe('2026-10-22');
    expect(nextDueDateWindow(cancunMidnight, MEXICO_CITY).today).toBe('2026-10-21');
    expect(validateNextDueDate('2031-10-22', cancunMidnight, CANCUN).ok).toBe(true);
    expect(validateNextDueDate('2031-10-22', cancunMidnight, MEXICO_CITY)).toEqual({
      ok: false,
      reason: 'too_future',
    });

    const early = new Date('1985-06-15T18:00:00.000Z');
    expect(validateNextDueDate('1984-06-15', early, MEXICO_CITY).ok).toBe(true);
    expect(validateNextDueDate('1984-06-14', early, MEXICO_CITY)).toEqual({
      ok: false,
      reason: 'too_old',
    });
    const late = new Date('2099-06-15T18:00:00.000Z');
    expect(nextDueDateWindow(late, MEXICO_CITY).max).toBe('2104-06-15');
    expect(validateNextDueDate('2104-06-15', late, MEXICO_CITY).ok).toBe(true);
    expect(validateNextDueDate('2104-06-16', late, MEXICO_CITY)).toEqual({
      ok: false,
      reason: 'too_future',
    });
    });
  });

  it('AC-OBL-03 maps a 422 to the Spanish field error and ignores other statuses', () => {
    expect(mapNextDueDateServerError(422)).toEqual({
      field: 'nextDueDate',
      key: 'obligation.nextDueDate.invalid',
      message: 'La próxima fecha no es válida. Revisa el valor e inténtalo de nuevo.',
    });
    expect(mapNextDueDateServerError(400)).toBeNull();
    expect(mapNextDueDateServerError(409)).toBeNull();
    expect(mapNextDueDateServerError(201)).toBeNull();
    expect(mapNextDueDateServerError(500)).toBeNull();
  });
});
