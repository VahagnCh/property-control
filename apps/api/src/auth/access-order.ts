export type TokenFailure = 'token_missing' | 'token_invalid' | 'token_expired';

export type AccessKind = 'create_property' | 'read' | 'write';

/**
 * Pure gate for route order. Property, obligation, and payment create/list/get/update
 * follow it, and OCR writes return consent_required when the current aviso is missing.
 * Stubbed routes still answer 501 before the token is read.
 * POST /v1/properties has no membership check.
 * Reads skip the viewer and consent gates.
 */
export interface AccessInput {
  stubbed: boolean;
  token: 'ok' | TokenFailure;
  request?: 'ok' | 'bad_request' | 'payload_too_large';
  kind: AccessKind;
  /** Ignored for `create_property`. */
  member?: boolean;
  role?: 'owner' | 'member' | 'viewer';
  /** Ignored for reads. */
  consent?: boolean;
}

export type AccessDecision =
  | { status: 501; error: 'not_implemented' }
  | { status: 401; error: TokenFailure }
  | { status: 400; error: 'bad_request' }
  | { status: 413; error: 'payload_too_large' }
  | { status: 404; error: 'not_found' }
  | { status: 403; error: 'viewer' | 'consent_required' }
  | { status: 200 };

export function decideAccess(input: AccessInput): AccessDecision {
  if (input.stubbed) {
    return { status: 501, error: 'not_implemented' };
  }
  if (input.token !== 'ok') {
    return { status: 401, error: input.token };
  }
  if (input.request === 'bad_request') {
    return { status: 400, error: 'bad_request' };
  }
  if (input.request === 'payload_too_large') {
    return { status: 413, error: 'payload_too_large' };
  }
  if (input.kind === 'create_property') {
    if (!input.consent) {
      return { status: 403, error: 'consent_required' };
    }
    return { status: 200 };
  }
  if (!input.member) {
    return { status: 404, error: 'not_found' };
  }
  if (input.kind === 'read') {
    return { status: 200 };
  }
  if (input.role === 'viewer') {
    return { status: 403, error: 'viewer' };
  }
  if (!input.consent) {
    return { status: 403, error: 'consent_required' };
  }
  return { status: 200 };
}
