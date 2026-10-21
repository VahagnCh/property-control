export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const INVITE_WRONG_ACCOUNT_MESSAGE = 'Esta invitación no es válida para tu cuenta.';

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

const MESSAGES: Record<InviteProblem['reason'], string> = {
  wrong_account: INVITE_WRONG_ACCOUNT_MESSAGE,
  unknown_token: 'No encontramos esta invitación.',
  used: 'Esta invitación ya no está disponible.',
  revoked: 'Esta invitación ya no está disponible.',
  superseded: 'Esta invitación ya no está disponible.',
  expired: 'Esta invitación ya no está disponible.',
  already_member: 'Ya perteneces a esta propiedad.',
  non_owner: 'No tienes permiso para invitar a esta propiedad.',
};

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

export function mapInviteProblem(problem: InviteProblem): string {
  return MESSAGES[problem.reason];
}

/**
 * Accept route only. A 403 here still shows the neutral wrong-account message.
 * A 404 shows that message for a wrong account, and the unknown-token message
 * when the token itself is missing. A bare 404 does not pick one of those.
 */
export function mapAcceptRouteStatus(
  status: number,
  reason?: 'wrong_account' | 'unknown_token',
): string | null {
  if (status === 403) {
    return INVITE_WRONG_ACCOUNT_MESSAGE;
  }
  if (status === 404 && reason === 'wrong_account') {
    return INVITE_WRONG_ACCOUNT_MESSAGE;
  }
  if (status === 404 && reason === 'unknown_token') {
    return MESSAGES.unknown_token;
  }
  return null;
}

/** True when now is at or after sentAt + 7 periods of 24 hours. */
export function isInviteExpired(sentAt: Date, now: Date): boolean {
  return now.getTime() >= sentAt.getTime() + INVITE_TTL_MS;
}
