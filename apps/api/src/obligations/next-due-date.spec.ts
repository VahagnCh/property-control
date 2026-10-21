import { UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { calendarDateInTimeZone } from '../common/property-calendar.js';
import {
  NEXT_DUE_DATE_ERROR,
  assertNextDueDateInRange,
  isNextDueDateSanity,
  nextDueDateWindow,
} from './next-due-date.js';

const MEXICO = 'America/Mexico_City';

function errorOf(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('nextDueDate range', () => {
  const now = new Date('2026-10-21T18:00:00.000Z');

  it('accepts exactly minus one year and plus five years, and rejects one day beyond each', () => {
    const window = nextDueDateWindow(now, MEXICO);
    expect(calendarDateInTimeZone(now, MEXICO)).toBe('2026-10-21');
    expect(window).toEqual({ min: '2025-10-21', max: '2031-10-21' });
    expect(() => assertNextDueDateInRange(window.min, now, MEXICO)).not.toThrow();
    expect(() => assertNextDueDateInRange(window.max, now, MEXICO)).not.toThrow();
    for (const iso of ['2025-10-20', '2031-10-22']) {
      const error = errorOf(() => assertNextDueDateInRange(iso, now, MEXICO));
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getStatus()).toBe(422);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
        error: NEXT_DUE_DATE_ERROR,
      });
    }
  });

  it('clamps 29 February when the target year is not a leap year', () => {
    const leap = new Date('2028-02-29T18:00:00.000Z');
    expect(calendarDateInTimeZone(leap, MEXICO)).toBe('2028-02-29');
    const window = nextDueDateWindow(leap, MEXICO);
    expect(window).toEqual({ min: '2027-02-28', max: '2033-02-28' });
    expect(() => assertNextDueDateInRange('2027-02-28', leap, MEXICO)).not.toThrow();
    expect(() => assertNextDueDateInRange('2027-02-27', leap, MEXICO)).toThrow(UnprocessableEntityException);
    expect(() => assertNextDueDateInRange('2033-02-28', leap, MEXICO)).not.toThrow();
    expect(() => assertNextDueDateInRange('2033-03-01', leap, MEXICO)).toThrow(UnprocessableEntityException);
  });

  it('moves the window at midnight in the property timezone', () => {
    const beforeMidnight = new Date('2026-10-21T05:30:00.000Z');
    const afterMidnight = new Date('2026-10-21T06:30:00.000Z');
    expect(calendarDateInTimeZone(beforeMidnight, MEXICO)).toBe('2026-10-20');
    expect(calendarDateInTimeZone(afterMidnight, MEXICO)).toBe('2026-10-21');
    expect(nextDueDateWindow(beforeMidnight, MEXICO)).toEqual({ min: '2025-10-20', max: '2031-10-20' });
    expect(nextDueDateWindow(afterMidnight, MEXICO)).toEqual({ min: '2025-10-21', max: '2031-10-21' });
    expect(() => assertNextDueDateInRange('2031-10-21', beforeMidnight, MEXICO)).toThrow(
      UnprocessableEntityException,
    );
    expect(() => assertNextDueDateInRange('2031-10-21', afterMidnight, MEXICO)).not.toThrow();
  });

  it('keeps 1990 through 2100 as the defensive sanity bound', () => {
    expect(isNextDueDateSanity('1990-01-01')).toBe(true);
    expect(isNextDueDateSanity('2100-12-31')).toBe(true);
    expect(isNextDueDateSanity('1989-12-31')).toBe(false);
    expect(isNextDueDateSanity('2101-01-01')).toBe(false);
    expect(isNextDueDateSanity('2026-02-30')).toBe(false);
    for (const iso of ['1989-12-31', '2101-01-01']) {
      const error = errorOf(() => assertNextDueDateInRange(iso, now, MEXICO));
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
        error: NEXT_DUE_DATE_ERROR,
      });
    }
  });
});
