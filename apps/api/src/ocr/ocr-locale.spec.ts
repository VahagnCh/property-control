import { describe, expect, it } from 'vitest';
import { mxTextsEquivalent, parseMxAmount, parseMxDate } from './ocr-locale.js';
import { isOcrStubEnabled } from './ocr-runtime.js';
import { earlyRequestStatus, isTraversal } from '../common/path-safety.js';

describe('OCR flag', () => {
  it('is on only for an explicit truthy token', () => {
    expect(isOcrStubEnabled(undefined)).toBe(false);
    expect(isOcrStubEnabled('')).toBe(false);
    expect(isOcrStubEnabled('   ')).toBe(false);
    expect(isOcrStubEnabled('false')).toBe(false);
    expect(isOcrStubEnabled('0')).toBe(false);
    expect(isOcrStubEnabled('no')).toBe(false);
    expect(isOcrStubEnabled('off')).toBe(false);
    expect(isOcrStubEnabled('maybe')).toBe(false);
    expect(isOcrStubEnabled('2')).toBe(false);
    expect(isOcrStubEnabled('true')).toBe(true);
    expect(isOcrStubEnabled('TRUE')).toBe(true);
    expect(isOcrStubEnabled(' yes ')).toBe(true);
    expect(isOcrStubEnabled('on')).toBe(true);
    expect(isOcrStubEnabled('1')).toBe(true);
  });
});

describe('es-MX OCR parsing', () => {
  it('normalizes amounts and refuses to assume an ambiguous value', () => {
    expect(parseMxAmount('$1,234.56')).toEqual({ canonical: '1234.56', lowConfidence: false });
    expect(parseMxAmount('1.234,56')).toEqual({ canonical: '1234.56', lowConfidence: false });
    expect(parseMxAmount('MXN 1 234,56')).toEqual({ canonical: '1234.56', lowConfidence: false });
    expect(parseMxAmount('1234')).toEqual({ canonical: '1234', lowConfidence: false });
    expect(parseMxAmount('1.234')).toEqual({ canonical: null, lowConfidence: true });
  });

  it('parses dates as dd/mm and month-year', () => {
    expect(parseMxDate('05/10/2026')).toEqual({
      canonical: '2026-10-05',
      lowConfidence: false,
      precision: 'day',
    });
    expect(parseMxDate('oct 2026')).toEqual({
      canonical: '2026-10-01',
      lowConfidence: true,
      precision: 'month',
    });
    expect(parseMxDate('5 de octubre de 2026')?.canonical).toBe('2026-10-05');
    expect(parseMxDate('31/02/2026')).toBeNull();
  });

  it('treats NFC and NFD Spanish text as the same string', () => {
    const nfc = 'Servicio de Agua Potable – Muñoz';
    const nfd = nfc.normalize('NFD');
    expect(nfd).not.toBe(nfc);
    expect(mxTextsEquivalent(nfc, nfd)).toBe(true);
    expect(mxTextsEquivalent('Predial Coyoacán', 'Predial Coyoacán'.normalize('NFD'))).toBe(true);
  });
});

describe('path safety', () => {
  const samples = [
    '../',
    '..%2F',
    '%2e%2e%2f',
    '%252e%252e%252f',
    '..%5C',
    '%2e%2e%5c',
    '．．／',
    '..∕',
    '%00',
    'a\u0000b',
  ];

  it('flags traversal payloads', () => {
    for (const sample of samples) {
      expect(isTraversal(sample), sample).toBe(true);
      expect(earlyRequestStatus(`/v1/properties/${encodeURIComponent(sample)}/payments`, true)).toBe(400);
    }
  });

  it('returns 501 for an OCR path when the flag is off, before the path is judged', () => {
    expect(earlyRequestStatus('/v1/properties/property-1/documents/document-1/ocr-jobs', false)).toBe(501);
    expect(earlyRequestStatus('/v1/properties/%2e%2e%2f/documents/x/ocr-jobs', false)).toBe(501);
    expect(earlyRequestStatus('/v1/properties/property-1/payments', false)).toBe(400);
    expect(
      earlyRequestStatus(
        '/v1/properties/11111111-1111-4111-8111-111111111111/payments',
        false,
      ),
    ).toBeNull();
  });
});
