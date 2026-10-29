import { describe, expect, it } from 'vitest';
import { parsePositiveCentavos } from './money.js';
import { INT8_MAX_CENTAVOS } from '../payments/wire-money.js';

describe('positive peso strings', () => {
  it('accepts one or two fraction digits inside the int8 cap', () => {
    expect(parsePositiveCentavos('850.5')).toBe(85050n);
    expect(parsePositiveCentavos('850.00')).toBe(85000n);
    expect(parsePositiveCentavos('0.01')).toBe(1n);
    expect(parsePositiveCentavos('21474836.48')).toBe(2147483648n);
    expect(parsePositiveCentavos('999999999999.99')).toBe(99999999999999n);
    expect(99999999999999n < INT8_MAX_CENTAVOS).toBe(true);
  });

  it('rejects zero, negatives, a missing or extra fraction, too many integer digits, and a JSON number', () => {
    for (const amount of ['0', '0.00', '850', '-1.00', '1.234', '01.00', '1234567890123.00']) {
      expect(() => parsePositiveCentavos(amount), amount).toThrow(/amount_invalid|decimal peso/);
    }
    expect(() => parsePositiveCentavos(850)).toThrow(/amount_invalid|decimal peso/);
    expect(() => parsePositiveCentavos(850.5)).toThrow(/amount_invalid|decimal peso/);
  });
});
