import { describe, expect, it } from 'vitest';
import { isPastDueDate, zonedTimeToUtc } from './property-calendar.js';

describe('America/Mexico_City clock', () => {
  it('stays UTC-6 in summer and winter', () => {
    expect(zonedTimeToUtc(2026, 6, 15, 9, 0, 0, 0, 'America/Mexico_City').toISOString()).toBe(
      '2026-06-15T15:00:00.000Z',
    );
    expect(zonedTimeToUtc(2026, 1, 15, 9, 0, 0, 0, 'America/Mexico_City').toISOString()).toBe(
      '2026-01-15T15:00:00.000Z',
    );
  });

  it('is not overdue at 23:59:59 local on the due date', () => {
    const due = '2026-10-21';
    const zone = 'America/Mexico_City';
    expect(isPastDueDate(due, new Date('2026-10-22T05:59:59.000Z'), zone)).toBe(false);
    expect(isPastDueDate(due, new Date('2026-10-22T06:00:00.000Z'), zone)).toBe(true);
  });
});
