import { dueLabel } from './dueLabel';
import {
  DEFAULT_PROPERTY_TIMEZONE,
  addCalendarDays,
  calendarDateInTimeZone,
  calendarDaysBetween,
} from './propertyCalendar';

const MEXICO_CITY = 'America/Mexico_City';
const TIJUANA = 'America/Tijuana';
const CANCUN = 'America/Cancun';

const AT_2359_MEXICO_CITY = new Date('2026-10-22T05:59:00.000Z');
const AT_0000_MEXICO_CITY = new Date('2026-10-22T06:00:00.000Z');
const AT_0001_MEXICO_CITY = new Date('2026-10-22T06:01:00.000Z');
const AT_0030_SPLIT = new Date('2026-10-22T06:30:00.000Z');
const AT_CANCUN_MIDNIGHT = new Date('2026-10-22T05:30:00.000Z');

function withDeviceLocalBlocked<T>(run: () => T): T {
  const proto = Date.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const names = [
    'getFullYear',
    'getMonth',
    'getDate',
    'getHours',
    'getMinutes',
    'getSeconds',
    'getDay',
    'getTimezoneOffset',
  ];
  const originals = new Map<string, (...args: unknown[]) => unknown>();
  for (const name of names) {
    originals.set(name, proto[name]);
    proto[name] = () => {
      throw new Error(`device local ${name}`);
    };
  }
  try {
    return run();
  } finally {
    for (const name of names) {
      proto[name] = originals.get(name) as (...args: unknown[]) => unknown;
    }
  }
}

describe('due labels in the property time zone', () => {
  it('defaults the property zone to America/Mexico_City and ignores the device zone', () => {
    expect(DEFAULT_PROPERTY_TIMEZONE).toBe('America/Mexico_City');
    expect(new Date().getTimezoneOffset()).toBe(0);

    withDeviceLocalBlocked(() => {
      expect(calendarDateInTimeZone(AT_2359_MEXICO_CITY, DEFAULT_PROPERTY_TIMEZONE)).toBe('2026-10-21');
      expect(dueLabel('2026-10-21', AT_2359_MEXICO_CITY, DEFAULT_PROPERTY_TIMEZONE)).toBe('Vence hoy');
      expect(dueLabel('2026-10-22', AT_2359_MEXICO_CITY, DEFAULT_PROPERTY_TIMEZONE)).toBe('Vence mañana');
    });
  });

  it('keeps 23:59 as today and 00:00 through 00:01 as the next local day', () => {
    expect(dueLabel('2026-10-21', AT_2359_MEXICO_CITY, MEXICO_CITY)).toBe('Vence hoy');
    expect(dueLabel('2026-10-22', AT_2359_MEXICO_CITY, MEXICO_CITY)).toBe('Vence mañana');

    expect(dueLabel('2026-10-22', AT_0000_MEXICO_CITY, MEXICO_CITY)).toBe('Vence hoy');
    expect(dueLabel('2026-10-23', AT_0000_MEXICO_CITY, MEXICO_CITY)).toBe('Vence mañana');
    expect(dueLabel('2026-10-21', AT_0000_MEXICO_CITY, MEXICO_CITY)).toBe('Venció hace 1 día');

    expect(dueLabel('2026-10-22', AT_0001_MEXICO_CITY, MEXICO_CITY)).toBe('Vence hoy');
    expect(dueLabel('2026-10-23', AT_0001_MEXICO_CITY, MEXICO_CITY)).toBe('Vence mañana');
    expect(dueLabel('2026-10-21', AT_0001_MEXICO_CITY, MEXICO_CITY)).toBe('Venció hace 1 día');

    expect(calendarDateInTimeZone(AT_0000_MEXICO_CITY, MEXICO_CITY)).toBe('2026-10-22');
    expect(calendarDateInTimeZone(AT_0001_MEXICO_CITY, MEXICO_CITY)).toBe('2026-10-22');
  });

  it('uses a non-default property time zone when the device is UTC', () => {
    expect(calendarDateInTimeZone(AT_0030_SPLIT, MEXICO_CITY)).toBe('2026-10-22');
    expect(calendarDateInTimeZone(AT_0030_SPLIT, TIJUANA)).toBe('2026-10-21');
    expect(dueLabel('2026-10-21', AT_0030_SPLIT, MEXICO_CITY)).toBe('Venció hace 1 día');
    expect(dueLabel('2026-10-21', AT_0030_SPLIT, TIJUANA)).toBe('Vence hoy');
    expect(dueLabel('2026-10-22', AT_0030_SPLIT, TIJUANA)).toBe('Vence mañana');

    expect(calendarDateInTimeZone(AT_CANCUN_MIDNIGHT, CANCUN)).toBe('2026-10-22');
    expect(calendarDateInTimeZone(AT_CANCUN_MIDNIGHT, MEXICO_CITY)).toBe('2026-10-21');
    expect(dueLabel('2026-10-22', AT_CANCUN_MIDNIGHT, CANCUN)).toBe('Vence hoy');
    expect(dueLabel('2026-10-22', AT_CANCUN_MIDNIGHT, MEXICO_CITY)).toBe('Vence mañana');
  });

  it('rejects an unknown time zone instead of falling back to the device', () => {
    expect(() => dueLabel('2026-10-21', AT_2359_MEXICO_CITY, 'Not/AZone')).toThrow(/IANA/);
    expect(() => dueLabel('2026-10-21', AT_2359_MEXICO_CITY, 'UTC-6')).toThrow(/IANA/);
  });

  it('counts a leap-day tomorrow without using the device calendar', () => {
    const afternoon = new Date('2028-02-28T21:00:00.000Z');
    expect(calendarDateInTimeZone(afternoon, MEXICO_CITY)).toBe('2028-02-28');
    expect(dueLabel('2028-02-29', afternoon, MEXICO_CITY)).toBe('Vence mañana');
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(calendarDaysBetween('2028-02-28', '2028-02-29')).toBe(1);
  });
});
