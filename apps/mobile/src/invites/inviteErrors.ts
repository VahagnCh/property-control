import { copyText } from '../copy/userFacing';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InviteProblem =
  | { reason: 'unknown_token' }
  | { reason: 'wrong_account' }
  | { reason: 'used' }
  | { reason: 'revoked' }
  | { reason: 'superseded' }
  | { reason: 'expired' }
  | { reason: 'already_member' }
  | { reason: 'non_owner' };

export type InviteAcceptInput = {
  tokenKnown: boolean;
  accountMatches: boolean;
  used: boolean;
  revoked: boolean;
  superseded: boolean;
  expired: boolean;
  alreadyMember: boolean;
};

export type InviteCopyKey =
  | 'invite.unavailable'
  | 'invite.expired'
  | 'invite.alreadyMember'
  | 'invite.nonOwner';

export type InviteCopy = {
  key: InviteCopyKey;
  message: string;
};

const ALREADY_MEMBER = 'Ya perteneces a esta propiedad.';
const NON_OWNER = 'No tienes permiso para invitar a esta propiedad.';

/**
 * Wrong account is 404, the same code as an unknown token. An unknown token
 * has no account to compare. When the token is known, the account check runs
 * before used, revoked, superseded, expired (410) and already-member (409).
 * A non-owner invite action is a separate 403 and is not classified here.
 */
export function classifyInviteAccept(input: InviteAcceptInput): InviteProblem | { ok: true } {
  if (!input.tokenKnown) {
    return { reason: 'unknown_token' };
  }
  if (!input.accountMatches) {
    return { reason: 'wrong_account' };
  }
  if (input.used) {
    return { reason: 'used' };
  }
  if (input.revoked) {
    return { reason: 'revoked' };
  }
  if (input.superseded) {
    return { reason: 'superseded' };
  }
  if (input.expired) {
    return { reason: 'expired' };
  }
  if (input.alreadyMember) {
    return { reason: 'already_member' };
  }
  return { ok: true };
}

export function inviteStatus(problem: InviteProblem): 404 | 410 | 409 | 403 {
  switch (problem.reason) {
    case 'unknown_token':
    case 'wrong_account':
      return 404;
    case 'used':
    case 'revoked':
    case 'superseded':
    case 'expired':
      return 410;
    case 'already_member':
      return 409;
    case 'non_owner':
      return 403;
  }
}

export function mapInviteProblem(problem: InviteProblem): InviteCopy {
  switch (problem.reason) {
    case 'unknown_token':
    case 'wrong_account':
      return { key: 'invite.unavailable', message: copyText('invite.unavailable') };
    case 'used':
    case 'revoked':
    case 'superseded':
    case 'expired':
      return { key: 'invite.expired', message: copyText('invite.expired') };
    case 'already_member':
      return { key: 'invite.alreadyMember', message: ALREADY_MEMBER };
    case 'non_owner':
      return { key: 'invite.nonOwner', message: NON_OWNER };
  }
}

/**
 * Accept route. Every 404 (unknown token or wrong account) and a defensive
 * 403 use invite.unavailable. A 410 uses invite.expired. The reason does not
 * change the 404 copy.
 */
export function mapAcceptRouteStatus(
  status: number,
  _reason?: 'wrong_account' | 'unknown_token',
): InviteCopy | null {
  if (status === 403 || status === 404) {
    return { key: 'invite.unavailable', message: copyText('invite.unavailable') };
  }
  if (status === 410) {
    return { key: 'invite.expired', message: copyText('invite.expired') };
  }
  return null;
}

/** True when now is at or after sentAt + 7 periods of 24 hours. */
export function isInviteExpired(sentAt: Date, now: Date): boolean {
  return now.getTime() >= sentAt.getTime() + INVITE_TTL_MS;
}
