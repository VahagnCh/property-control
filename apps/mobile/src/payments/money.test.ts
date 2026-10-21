import { formatMxnDisplay, formatWireAmount, MoneyParseError, parseMxnToCentavos } from './money';

describe('MXN centavos', () => {
  it('converts wire strings to integer centavos and back without floats', () => {
    expect(parseMxnToCentavos('0.00')).toBe(0);
    expect(formatWireAmount(0)).toBe('0.00');
    expect(formatMxnDisplay(0)).toBe('$0.00');

    expect(parseMxnToCentavos('1234.5')).toBe(123450);
    expect(formatWireAmount(123450)).toBe('1234.50');
    expect(formatWireAmount(parseMxnToCentavos('1234.5'))).toBe('1234.50');
    expect(formatMxnDisplay(123450)).toBe('$1,234.50');
    expect(formatMxnDisplay(123450)).not.toBe(formatWireAmount(123450));

    expect(parseMxnToCentavos('1234.50')).toBe(123450);
    expect(parseMxnToCentavos('0.10')).toBe(10);
    expect(parseMxnToCentavos('0.1')).toBe(10);
    expect(parseMxnToCentavos('0.20')).toBe(20);
    expect(parseMxnToCentavos('0.10') + parseMxnToCentavos('0.20')).toBe(30);
    expect(formatWireAmount(30)).toBe('0.30');
    expect(parseMxnToCentavos('1.10')).toBe(110);
    expect(formatMxnDisplay(100000050)).toBe('$1,000,000.50');
  });

  it('rejects more than two decimals, negatives, and empty input', () => {
    expect(() => parseMxnToCentavos('1234.500')).toThrow(MoneyParseError);
    expect(() => parseMxnToCentavos('1234.501')).toThrow(MoneyParseError);
    try {
      parseMxnToCentavos('1234.500');
    } catch (error) {
      expect(error).toMatchObject({ code: 'too_many_decimals' });
    }

    expect(() => parseMxnToCentavos('-1.00')).toThrow(MoneyParseError);
    expect(() => parseMxnToCentavos('-0.01')).toThrow(MoneyParseError);
    try {
      parseMxnToCentavos('-0.01');
    } catch (error) {
      expect(error).toMatchObject({ code: 'negative' });
    }

    expect(() => parseMxnToCentavos('')).toThrow(MoneyParseError);
    expect(() => parseMxnToCentavos('   ')).toThrow(MoneyParseError);
    try {
      parseMxnToCentavos('');
    } catch (error) {
      expect(error).toMatchObject({ code: 'empty' });
    }
  });

  it('rejects display formatting, extra punctuation, and amounts above the int32 centavo cap', () => {
    for (const value of ['1,234.50', '$1,234.50', '1.2.3', '+1.00', 'MXN 1.00', '.50', '12.', '1e2']) {
      expect(() => parseMxnToCentavos(value)).toThrow(MoneyParseError);
    }
    expect(parseMxnToCentavos('21474836.47')).toBe(2147483647);
    expect(() => parseMxnToCentavos('21474836.48')).toThrow(MoneyParseError);
    expect(() => formatWireAmount(1.5)).toThrow(MoneyParseError);
    expect(() => formatMxnDisplay(-1)).toThrow(MoneyParseError);
  });
});
