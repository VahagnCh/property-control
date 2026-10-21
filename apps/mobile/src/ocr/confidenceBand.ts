export type ServerConfidenceBand = 'alta' | 'media' | 'revisa';

export type ConfidenceWord = 'Alta' | 'Media' | 'Revisa';

const SERVER_BAND: Record<ServerConfidenceBand, ConfidenceWord> = {
  alta: 'Alta',
  media: 'Media',
  revisa: 'Revisa',
};

export type ConfidenceInput = {
  band?: string | null;
  confidence?: number | null;
};

function isServerBand(band: string): band is ServerConfidenceBand {
  return band === 'alta' || band === 'media' || band === 'revisa';
}

/**
 * The server computes the band before the client sees it.
 * Use that band when it is exactly `alta`, `media`, or `revisa`.
 * Anything else — missing, unknown, or a score with no band — is Revisa.
 * The client does not derive Alta or Media from the score.
 * This does not write the field.
 */
export function confidenceWord(input: ConfidenceInput): ConfidenceWord {
  if (input.band != null && isServerBand(input.band)) {
    return SERVER_BAND[input.band];
  }
  return 'Revisa';
}
