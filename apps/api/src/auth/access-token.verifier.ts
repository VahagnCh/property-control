export const ACCESS_TOKEN_VERIFIER = Symbol('ACCESS_TOKEN_VERIFIER');

export type AccessTokenVerdict = { sub: string } | 'invalid' | 'expired';

export interface AccessTokenVerifier {
  verify(token: string): AccessTokenVerdict;
}

export type BearerCheck = { ok: true; sub: string } | { ok: false; message: string };

/** Shared by the guard and the OCR middleware so a bad token is 401 before path or JSON parsing. */
export function verifyBearer(
  verifier: AccessTokenVerifier,
  header: string | string[] | undefined,
): BearerCheck {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !value.startsWith('Bearer ')) {
    return { ok: false, message: 'Missing access token.' };
  }
  const token = value.slice('Bearer '.length).trim();
  if (!token) {
    return { ok: false, message: 'Missing access token.' };
  }
  const verdict = verifier.verify(token);
  if (verdict === 'expired') {
    return { ok: false, message: 'Expired access token.' };
  }
  if (!verdict || verdict === 'invalid' || typeof verdict.sub !== 'string' || verdict.sub.length === 0) {
    return { ok: false, message: 'Invalid access token.' };
  }
  return { ok: true, sub: verdict.sub };
}

/**
 * Fail closed. This API does not mint tokens and does not accept a JWT
 * until a verifier is supplied by the host (tests stub one).
 */
export class FailClosedAccessTokenVerifier implements AccessTokenVerifier {
  verify(): 'invalid' {
    return 'invalid';
  }
}
