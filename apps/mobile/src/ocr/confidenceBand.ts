export type ConfidenceBands = {
  alta: number;
  media: number;
};

export type ConfidenceWord = 'Alta' | 'Media' | 'Revisa';

/**
 * Word for a suggestion. Bands come from the job, not from a hardcoded cutoff.
 * Null and non-finite values are Revisa. This does not write the field.
 */
export function confidenceWord(
  confidence: number | null | undefined,
  bands: ConfidenceBands,
): ConfidenceWord {
  if (confidence == null || !Number.isFinite(confidence)) {
    return 'Revisa';
  }
  if (confidence >= bands.alta) {
    return 'Alta';
  }
  if (confidence >= bands.media) {
    return 'Media';
  }
  return 'Revisa';
}
