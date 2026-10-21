import { describe, expect, it } from 'vitest';
import { decideAccess, type AccessInput } from './access-order.js';

function decide(overrides: Partial<AccessInput> & Pick<AccessInput, 'kind'>): ReturnType<typeof decideAccess> {
  return decideAccess({
    stubbed: false,
    token: 'ok',
    request: 'ok',
    member: true,
    role: 'owner',
    consent: true,
    ...overrides,
  });
}

describe('decideAccess', () => {
  it('returns 501 for a stubbed route before token or body checks', () => {
    expect(decide({ kind: 'write', stubbed: true, token: 'token_missing' })).toEqual({
      status: 501,
      error: 'not_implemented',
    });
    expect(decide({ kind: 'write', stubbed: true, request: 'bad_request' })).toEqual({
      status: 501,
      error: 'not_implemented',
    });
    expect(decide({ kind: 'create_property', stubbed: true, token: 'token_missing', consent: false })).toEqual({
      status: 501,
      error: 'not_implemented',
    });
  });

  it('gates POST /v1/properties as 401, then 400 or 413, then consent', () => {
    expect(decide({ kind: 'create_property', token: 'token_missing', consent: false })).toEqual({
      status: 401,
      error: 'token_missing',
    });
    expect(decide({ kind: 'create_property', request: 'bad_request', consent: false })).toEqual({
      status: 400,
      error: 'bad_request',
    });
    expect(decide({ kind: 'create_property', request: 'payload_too_large', consent: false })).toEqual({
      status: 413,
      error: 'payload_too_large',
    });
    expect(decide({ kind: 'create_property', consent: false })).toEqual({
      status: 403,
      error: 'consent_required',
    });
    expect(decide({ kind: 'create_property', consent: true })).toEqual({ status: 200 });
  });

  it('checks the token before membership, validation before 404, and viewer before consent', () => {
    expect(decide({ kind: 'write', token: 'token_expired', member: false, consent: false })).toEqual({
      status: 401,
      error: 'token_expired',
    });
    expect(decide({ kind: 'write', token: 'token_invalid' })).toEqual({
      status: 401,
      error: 'token_invalid',
    });
    expect(decide({ kind: 'write', request: 'bad_request', member: false, consent: false })).toEqual({
      status: 400,
      error: 'bad_request',
    });
    expect(decide({ kind: 'write', member: false, consent: false })).toEqual({
      status: 404,
      error: 'not_found',
    });
    expect(decide({ kind: 'write', role: 'viewer', consent: false })).toEqual({
      status: 403,
      error: 'viewer',
    });
    expect(decide({ kind: 'write', role: 'owner', consent: false })).toEqual({
      status: 403,
      error: 'consent_required',
    });
    expect(decide({ kind: 'write', role: 'member', consent: true })).toEqual({ status: 200 });
  });

  it('allows owner and viewer reads without consent and hides a non-member read', () => {
    expect(decide({ kind: 'read', role: 'owner', consent: false })).toEqual({ status: 200 });
    expect(decide({ kind: 'read', role: 'viewer', consent: false })).toEqual({ status: 200 });
    expect(decide({ kind: 'read', member: false, consent: false })).toEqual({
      status: 404,
      error: 'not_found',
    });
  });
});
