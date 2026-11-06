export const ACCESS_TOKEN_VERIFIER = Symbol('ACCESS_TOKEN_VERIFIER');

export type AccessTokenVerdict = { sub: string; sid?: string } | 'invalid' | 'expired';

export interface AccessTokenVerifier {
  verify(token: string): AccessTokenVerdict | Promise<AccessTokenVerdict>;
}

export type TokenErrorCode = 'token_missing' | 'token_invalid' | 'token_expired';

export type BearerCheck =
  | { ok: true; sub: string; sid?: string }
  | { ok: false; error: TokenErrorCode; message: string };

/** Shared by the guard and the OCR middleware so a bad token is 401 before path or JSON parsing. */
export async function verifyBearer(
  verifier: AccessTokenVerifier,
  header: string | string[] | undefined,
): Promise<BearerCheck> {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !value.startsWith('Bearer ')) {
    return { ok: false, error: 'token_missing', message: 'Missing access token.' };
  }
  const token = value.slice('Bearer '.length).trim();
  if (!token) {
    return { ok: false, error: 'token_missing', message: 'Missing access token.' };
  }
  let verdict: AccessTokenVerdict;
  try {
    verdict = await verifier.verify(token);
  } catch {
    return { ok: false, error: 'token_invalid', message: 'Invalid access token.' };
  }
  if (verdict === 'expired') {
    return { ok: false, error: 'token_expired', message: 'Expired access token.' };
  }
  if (!verdict || verdict === 'invalid' || typeof verdict.sub !== 'string' || verdict.sub.length === 0) {
    return { ok: false, error: 'token_invalid', message: 'Invalid access token.' };
  }
  return { ok: true, sub: verdict.sub, sid: verdict.sid };
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
