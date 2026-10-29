import { decideAccess, type TokenFailure } from '../auth/access-order.js';
import { keyedHmac } from '../auth/server-secret.js';

export type MembershipRoleName = 'owner' | 'member' | 'viewer';

export interface InviteSnapshot {
  emailHmac: string;
  usedAt: Date | null;
  revokedAt: Date | null;
  supersededAt: Date | null;
  expiresAt: Date;
}

export type InviteAcceptDecision =
  | { status: 404; error: 'not_found' }
  | { status: 410; error: 'invite_closed' }
  | { status: 409; error: 'already_member' }
  | { status: 200; error: null };

export type InviteManageDecision =
  | { status: 501; error: 'not_implemented' }
  | { status: 401; error: TokenFailure }
  | { status: 400; error: 'bad_request' }
  | { status: 413; error: 'payload_too_large' }
  | { status: 404; error: 'not_found' }
  | { status: 403; error: 'forbidden' | 'consent_required' }
  | { status: 200; error: null };

export interface InviteManageGate {
  stubbed?: boolean;
  token?: 'ok' | TokenFailure;
  request?: 'ok' | 'bad_request' | 'payload_too_large';
  /** Writes only. Omitted means the current aviso is accepted. */
  consent?: boolean;
}

/**
 * Accept order from Trust rev d: unknown token or the wrong account is 404
 * before any token state is revealed. Used, revoked, superseded, and expired
 * are 410. An invitee who is already a member is 409.
 */
export function decideInviteAccept(input: {
  invite: InviteSnapshot | null;
  accountEmailHmac: string;
  now: Date;
  alreadyMember: boolean;
}): InviteAcceptDecision {
  if (!input.invite || input.invite.emailHmac !== input.accountEmailHmac) {
    return { status: 404, error: 'not_found' };
  }
  if (
    input.invite.usedAt ||
    input.invite.revokedAt ||
    input.invite.supersededAt ||
    input.invite.expiresAt <= input.now
  ) {
    return { status: 410, error: 'invite_closed' };
  }
  if (input.alreadyMember) {
    return { status: 409, error: 'already_member' };
  }
  return { status: 200, error: null };
}

/**
 * Create, resend, and revoke. Trust rev f.5 §5.1 order:
 * 501, then 401, then 400/413, then 404 for a non-member or an unknown
 * property, then 403 for a member who is not the owner, then 403
 * `consent_required`. `actorRole` null is either of those 404 cases.
 */
export function decideInviteManage(
  actorRole: MembershipRoleName | null,
  gate: InviteManageGate = {},
): InviteManageDecision {
  const access = decideAccess({
    stubbed: gate.stubbed ?? false,
    token: gate.token ?? 'ok',
    request: gate.request ?? 'ok',
    kind: 'write',
    member: actorRole !== null,
    role: actorRole === 'viewer' ? 'viewer' : 'owner',
    consent: gate.consent ?? true,
  });
  if (
    access.status === 501 ||
    access.status === 401 ||
    access.status === 400 ||
    access.status === 413 ||
    access.status === 404
  ) {
    return access;
  }
  if (actorRole !== 'owner') {
    return { status: 403, error: 'forbidden' };
  }
  if (access.status === 403) {
    return { status: 403, error: 'consent_required' };
  }
  return { status: 200, error: null };
}

export function inviteEmailHmac(email: string, secret: string): string {
  return keyedHmac(email, secret, 'invite-email');
}
