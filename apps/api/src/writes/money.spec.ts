import { describe, expect, it } from 'vitest';
import { parsePositiveCentavos } from './money.js';

describe('positive peso strings', () => {
  it('accepts a peso string and zero fraction digits as centavos', () => {
    expect(parsePositiveCentavos('850')).toBe(85000n);
    expect(parsePositiveCentavos('850.00')).toBe(85000n);
    expect(parsePositiveCentavos('0.01')).toBe(1n);
    expect(parsePositiveCentavos('21474836.47')).toBe(2147483647n);
  });

  it('rejects zero, negatives, extra fraction digits, numbers, and very large amounts', () => {
    for (const amount of ['0', '0.00', '-1', '-1.00', '1.2', '1.234', '01.00', '21474836.48', '999999999999.99']) {
      expect(() => parsePositiveCentavos(amount), amount).toThrow(/amount_invalid|decimal peso/);
    }
    expect(() => parsePositiveCentavos(850)).toThrow(/amount_invalid|decimal peso/);
    expect(() => parsePositiveCentavos(850.5)).toThrow(/amount_invalid|decimal peso/);
  });
});
