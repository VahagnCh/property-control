export type ServerConfidenceBand = 'alta' | 'media' | 'revisa';

export type ConfidenceWord = 'Alta' | 'Media' | 'Revisa';

const SERVER_BAND: Record<ServerConfidenceBand, ConfidenceWord> = {
  alta: 'Alta',
  media: 'Media',
  revisa: 'Revisa',
};

/** Score fallback when the server omits `band`. Below this, or no score, is Revisa. */
const REVISA_BELOW = 0.8;

/** Score fallback only. A server band always wins, including when it disagrees with the score. */
const ALTA_AT = 0.9;

export type ConfidenceInput = {
  band?: string | null;
  confidence?: number | null;
};

function isServerBand(band: string): band is ServerConfidenceBand {
  return band === 'alta' || band === 'media' || band === 'revisa';
}

function wordFromScore(confidence: number | null | undefined): ConfidenceWord {
  if (confidence == null || !Number.isFinite(confidence) || confidence < REVISA_BELOW) {
    return 'Revisa';
  }
  if (confidence >= ALTA_AT) {
    return 'Alta';
  }
  return 'Media';
}

/**
 * Prefer the server band (alta / media / revisa).
 * When it is missing, fall back to the score: below 0.80 or no score is Revisa.
 * This does not write the field.
 */
export function confidenceWord(input: ConfidenceInput): ConfidenceWord {
  if (input.band != null && isServerBand(input.band)) {
    return SERVER_BAND[input.band];
  }
  return wordFromScore(input.confidence);
}
