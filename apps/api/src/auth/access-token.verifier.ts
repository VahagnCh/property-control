export const ACCESS_TOKEN_VERIFIER = Symbol('ACCESS_TOKEN_VERIFIER');

export type AccessTokenVerdict = { sub: string } | 'invalid' | 'expired';

export interface AccessTokenVerifier {
  verify(token: string): AccessTokenVerdict;
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
