import { UnprocessableEntityException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { calendarDateInTimeZone } from '../common/property-calendar.js';
import { assertPaidAt, paidAtBounds } from './paid-at.js';

const MEXICO = 'America/Mexico_City';

describe('paidAt bounds', () => {
  const now = new Date('2026-10-21T18:00:00.000Z');

  it('accepts the one-year back-date and one day of clock skew, and rejects one millisecond beyond each', () => {
    const bounds = paidAtBounds(now, MEXICO);
    expect(calendarDateInTimeZone(now, MEXICO)).toBe('2026-10-21');
    expect(bounds.min.toISOString()).toBe('2025-10-21T18:00:00.000Z');
    expect(bounds.max.toISOString()).toBe('2026-10-22T18:00:00.000Z');
    expect(() => assertPaidAt(bounds.min, now, MEXICO)).not.toThrow();
    expect(() => assertPaidAt(bounds.max, now, MEXICO)).not.toThrow();
    expect(() => assertPaidAt(new Date(bounds.min.getTime() - 1), now, MEXICO)).toThrow(
      UnprocessableEntityException,
    );
    expect(() => assertPaidAt(new Date(bounds.max.getTime() + 1), now, MEXICO)).toThrow(
      UnprocessableEntityException,
    );
  });

  it('clamps 29 February on the one-year back-date', () => {
    const leap = new Date('2028-02-29T18:00:00.000Z');
    const bounds = paidAtBounds(leap, MEXICO);
    expect(calendarDateInTimeZone(leap, MEXICO)).toBe('2028-02-29');
    expect(bounds.min.toISOString()).toBe('2027-02-28T18:00:00.000Z');
    expect(bounds.max.toISOString()).toBe('2028-03-01T18:00:00.000Z');
    expect(() => assertPaidAt(bounds.min, leap, MEXICO)).not.toThrow();
    expect(() => assertPaidAt(new Date(bounds.min.getTime() - 1), leap, MEXICO)).toThrow(
      UnprocessableEntityException,
    );
  });

  it('shifts the one-day ceiling at midnight in the property timezone', () => {
    const beforeMidnight = new Date('2026-10-21T05:30:00.000Z');
    const afterMidnight = new Date('2026-10-21T06:30:00.000Z');
    expect(calendarDateInTimeZone(beforeMidnight, MEXICO)).toBe('2026-10-20');
    expect(calendarDateInTimeZone(afterMidnight, MEXICO)).toBe('2026-10-21');
    const before = paidAtBounds(beforeMidnight, MEXICO);
    const after = paidAtBounds(afterMidnight, MEXICO);
    expect(before.max.toISOString()).toBe('2026-10-22T05:30:00.000Z');
    expect(after.max.toISOString()).toBe('2026-10-22T06:30:00.000Z');
    const probe = new Date('2026-10-22T06:00:00.000Z');
    expect(() => assertPaidAt(probe, beforeMidnight, MEXICO)).toThrow(UnprocessableEntityException);
    expect(() => assertPaidAt(probe, afterMidnight, MEXICO)).not.toThrow();
  });
});
