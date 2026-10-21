import { confidenceWord } from './confidenceBand';

describe('confidence words', () => {
  it('prefers the server band over the score', () => {
    expect(confidenceWord({ band: 'alta', confidence: 0.1 })).toBe('Alta');
    expect(confidenceWord({ band: 'media', confidence: 0.99 })).toBe('Media');
    expect(confidenceWord({ band: 'revisa', confidence: 1 })).toBe('Revisa');
    expect(confidenceWord({ band: 'alta', confidence: null })).toBe('Alta');
    expect(confidenceWord({ band: 'media' })).toBe('Media');
    expect(confidenceWord({ band: 'revisa', confidence: Number.NaN })).toBe('Revisa');
    expect(confidenceWord({ band: 'ALTA', confidence: 0.1 })).toBe('Revisa');
    expect(confidenceWord({ band: 'high', confidence: 0.95 })).toBe('Alta');
  });

  it('falls back to the score when the band is missing: below 0.80 or no score is Revisa', () => {
    expect(confidenceWord({ confidence: 0.95 })).toBe('Alta');
    expect(confidenceWord({ confidence: 0.9 })).toBe('Alta');
    expect(confidenceWord({ confidence: 0.8999 })).toBe('Media');
    expect(confidenceWord({ confidence: 0.85 })).toBe('Media');
    expect(confidenceWord({ confidence: 0.8 })).toBe('Media');
    expect(confidenceWord({ confidence: 0.7999 })).toBe('Revisa');
    expect(confidenceWord({ confidence: 0 })).toBe('Revisa');
    expect(confidenceWord({ confidence: null })).toBe('Revisa');
    expect(confidenceWord({})).toBe('Revisa');
    expect(confidenceWord({ confidence: undefined })).toBe('Revisa');
    expect(confidenceWord({ confidence: Number.NaN })).toBe('Revisa');
    expect(confidenceWord({ confidence: Number.POSITIVE_INFINITY })).toBe('Revisa');
    expect(confidenceWord({ band: null, confidence: 0.5 })).toBe('Revisa');
    expect(confidenceWord({ band: '', confidence: 0.91 })).toBe('Alta');
  });
});
