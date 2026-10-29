import { describe, expect, it } from 'vitest';
import { assertNotes, assertSingleLine } from './text.js';

describe('write text', () => {
  it('keeps Spanish accents and rejects controls, bidi, and zero-width characters', () => {
    expect(assertSingleLine('Comisión Federal de Electricidad', 300)).toBe(
      'Comisión Federal de Electricidad',
    );
    expect(assertNotes('Pago de luz en México.\r\nSegunda línea')).toBe('Pago de luz en México.\nSegunda línea');
    for (const value of ['CFE\n', 'CFE\u0000', 'CFE\u0090', 'CFE\u200F', 'CFE\u200B', 'CFE\u202E']) {
      expect(() => assertSingleLine(value, 300), value).toThrow(/not allowed/);
    }
    expect(() => assertNotes('nota\u200B')).toThrow(/not allowed/);
  });

  it('caps a title at 300 and notes at 2000 UTF-16 code units', () => {
    expect(assertSingleLine('a'.repeat(300), 300)).toHaveLength(300);
    expect(() => assertSingleLine('a'.repeat(301), 300)).toThrow(/not allowed/);
    expect(assertNotes('a'.repeat(2000))).toHaveLength(2000);
    expect(() => assertNotes('a'.repeat(2001))).toThrow(/not allowed/);
    expect(() => assertNotes('   ')).toThrow(/not allowed/);
  });
});
