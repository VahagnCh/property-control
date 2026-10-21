import { confidenceWord } from './confidenceBand';

describe('confidence words', () => {
  it('uses the server band when it is alta, media, or revisa', () => {
    expect(confidenceWord({ band: 'alta', confidence: 0.1 })).toBe('Alta');
    expect(confidenceWord({ band: 'media', confidence: 0.99 })).toBe('Media');
    expect(confidenceWord({ band: 'revisa', confidence: 1 })).toBe('Revisa');
    expect(confidenceWord({ band: 'alta', confidence: null })).toBe('Alta');
    expect(confidenceWord({ band: 'media' })).toBe('Media');
    expect(confidenceWord({ band: 'revisa', confidence: Number.NaN })).toBe('Revisa');
  });

  it('is Revisa when the band is missing, unknown, or the score is outside 0..1', () => {
    expect(confidenceWord({ band: 'ALTA', confidence: 0.99 })).toBe('Revisa');
    expect(confidenceWord({ band: 'high', confidence: 0.95 })).toBe('Revisa');
    expect(confidenceWord({ band: '', confidence: 0.91 })).toBe('Revisa');
    expect(confidenceWord({ confidence: 0.95 })).toBe('Revisa');
    expect(confidenceWord({ confidence: 0.9 })).toBe('Revisa');
    expect(confidenceWord({ confidence: 0.85 })).toBe('Revisa');
    expect(confidenceWord({ confidence: 0.8 })).toBe('Revisa');
    expect(confidenceWord({ confidence: 1 })).toBe('Revisa');
    expect(confidenceWord({ confidence: 1.1 })).toBe('Revisa');
    expect(confidenceWord({ confidence: -0.01 })).toBe('Revisa');
    expect(confidenceWord({ confidence: 0 })).toBe('Revisa');
    expect(confidenceWord({ confidence: null })).toBe('Revisa');
    expect(confidenceWord({})).toBe('Revisa');
    expect(confidenceWord({ confidence: undefined })).toBe('Revisa');
    expect(confidenceWord({ confidence: Number.NaN })).toBe('Revisa');
    expect(confidenceWord({ confidence: Number.POSITIVE_INFINITY })).toBe('Revisa');
    expect(confidenceWord({ band: null, confidence: 0.99 })).toBe('Revisa');
  });
});
