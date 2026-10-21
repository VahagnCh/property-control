import { describe, expect, it } from 'vitest';
import { centavosToWireAmount, wireAmountToCentavos } from './wire-money.js';

describe('wire money', () => {
  it('round-trips a peso string above the int32 centavo limit without a float', () => {
    const wire = '21474836.48';
    const cents = wireAmountToCentavos(wire);
    expect(cents).toBe(2147483648n);
    expect(cents > 2147483647n).toBe(true);
    expect(centavosToWireAmount(cents)).toBe(wire);
    expect(centavosToWireAmount(wireAmountToCentavos('1234.50'))).toBe('1234.50');
  });
});
