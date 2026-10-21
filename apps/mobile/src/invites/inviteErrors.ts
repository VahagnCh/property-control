export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const INVITE_WRONG_ACCOUNT_MESSAGE = 'Esta invitación no es válida para tu cuenta.';

export type InviteProblem =
  | { reason: 'unknown_token' }
  | { reason: 'used' }
  | { reason: 'revoked' }
  | { reason: 'superseded' }
  | { reason: 'expired' }
  | { reason: 'already_member' }
  | { reason: 'non_owner' }
  | { reason: 'wrong_account'; status: 403 | 404 };

const MESSAGES: Record<Exclude<InviteProblem['reason'], 'wrong_account'>, string> = {
  unknown_token: 'No encontramos esta invitación.',
  used: 'Esta invitación ya no está disponible.',
  revoked: 'Esta invitación ya no está disponible.',
  superseded: 'Esta invitación ya no está disponible.',
  expired: 'Esta invitación ya no está disponible.',
  already_member: 'Ya perteneces a esta propiedad.',
  non_owner: 'No tienes permiso para invitar a esta propiedad.',
};

export function inviteStatus(problem: InviteProblem): number {
  switch (problem.reason) {
    case 'unknown_token':
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
    case 'wrong_account':
      return problem.status;
  }
}

export function mapInviteProblem(problem: InviteProblem): string {
  if (problem.reason === 'wrong_account') {
    return INVITE_WRONG_ACCOUNT_MESSAGE;
  }
  return MESSAGES[problem.reason];
}

/** True when now is at or after sentAt + 7 periods of 24 hours. */
export function isInviteExpired(sentAt: Date, now: Date): boolean {
  return now.getTime() >= sentAt.getTime() + INVITE_TTL_MS;
}
