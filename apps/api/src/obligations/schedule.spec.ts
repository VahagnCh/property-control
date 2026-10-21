import { describe, expect, it } from 'vitest';
import { dueDateAt, periodAfter } from './schedule.js';

describe('obligation schedule', () => {
  it('steps from the anchor month and does not drift off a clamped day', () => {
    expect(dueDateAt('2026-01-01', 31, 0)).toBe('2026-01-31');
    expect(dueDateAt('2026-01-01', 31, 1)).toBe('2026-02-28');
    expect(dueDateAt('2026-01-01', 31, 2)).toBe('2026-03-31');
    expect(periodAfter('2026-01-01', 31, 'monthly', '2026-02-28')).toBe('2026-03-31');
    expect(dueDateAt('2028-01-01', 31, 1)).toBe('2028-02-29');
    expect(dueDateAt('2026-12-01', 31, 1)).toBe('2027-01-31');
    expect(periodAfter('2026-01-15', 31, 'bimonthly', '2026-01-31')).toBe('2026-03-31');
    expect(periodAfter('2026-01-15', 31, 'quarterly', '2026-01-31')).toBe('2026-04-30');
    expect(periodAfter('2026-02-01', 29, 'annual', '2028-02-29')).toBe('2029-02-28');
    expect(periodAfter('2026-03-01', 15, 'custom', '2026-03-15')).toBeNull();
    expect(periodAfter('2026-03-01', 15, 'irregular', '2026-03-15')).toBeNull();
  });
});
