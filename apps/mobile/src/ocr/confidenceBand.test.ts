import { confidenceWord } from './confidenceBand';

describe('confidence words', () => {
  it('uses the bands from the job and maps null to Revisa', () => {
    const shifted = { alta: 0.85, media: 0.75 };
    expect(confidenceWord(0.86, shifted)).toBe('Alta');
    expect(confidenceWord(0.85, shifted)).toBe('Alta');
    expect(confidenceWord(0.849, shifted)).toBe('Media');
    expect(confidenceWord(0.75, shifted)).toBe('Media');
    expect(confidenceWord(0.749, shifted)).toBe('Revisa');
    expect(confidenceWord(null, shifted)).toBe('Revisa');

    const defaults = { alta: 0.9, media: 0.8 };
    expect(confidenceWord(0.95, defaults)).toBe('Alta');
    expect(confidenceWord(0.9, defaults)).toBe('Alta');
    expect(confidenceWord(0.85, defaults)).toBe('Media');
    expect(confidenceWord(0.8, defaults)).toBe('Media');
    expect(confidenceWord(0.79, defaults)).toBe('Revisa');
    expect(confidenceWord(null, defaults)).toBe('Revisa');
    expect(confidenceWord(undefined, defaults)).toBe('Revisa');
    expect(confidenceWord(Number.NaN, defaults)).toBe('Revisa');
  });
});
