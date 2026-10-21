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

export type InviteManageDecision = { status: 403; error: 'forbidden' } | { status: 200; error: null };

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

/** Only an owner invites, resends, or revokes. A non-owner is 403. */
export function decideInviteManage(actorRole: MembershipRoleName | null): InviteManageDecision {
  if (actorRole !== 'owner') {
    return { status: 403, error: 'forbidden' };
  }
  return { status: 200, error: null };
}

export function inviteEmailHmac(email: string, secret: string): string {
  return keyedHmac(email, secret, 'invite-email');
}
