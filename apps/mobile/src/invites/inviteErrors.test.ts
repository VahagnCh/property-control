import {
  classifyInviteAccept,
  INVITE_TTL_MS,
  INVITE_WRONG_ACCOUNT_MESSAGE,
  InviteAcceptInput,
  inviteStatus,
  isInviteExpired,
  mapAcceptRouteStatus,
  mapInviteProblem,
} from './inviteErrors';

const openInvite: InviteAcceptInput = {
  tokenKnown: true,
  accountMatches: true,
  used: false,
  revoked: false,
  superseded: false,
  expired: false,
  alreadyMember: false,
};

describe('invite errors', () => {
  it('maps token outcomes to the agreed status codes', () => {
    expect(inviteStatus({ reason: 'unknown_token' })).toBe(404);
    expect(mapInviteProblem({ reason: 'unknown_token' })).toBe('No encontramos esta invitación.');

    for (const reason of ['used', 'revoked', 'superseded', 'expired'] as const) {
      expect(inviteStatus({ reason })).toBe(410);
      expect(mapInviteProblem({ reason })).toBe('Esta invitación ya no está disponible.');
    }

    expect(inviteStatus({ reason: 'already_member' })).toBe(409);
    expect(mapInviteProblem({ reason: 'already_member' })).toBe('Ya perteneces a esta propiedad.');

    expect(inviteStatus({ reason: 'non_owner' })).toBe(403);
    expect(mapInviteProblem({ reason: 'non_owner' })).toBe(
      'No tienes permiso para invitar a esta propiedad.',
    );
  });

  it('classifies a wrong account as 404 before used, revoked, superseded, expired, or already-member', () => {
    for (const flag of ['used', 'revoked', 'superseded', 'expired', 'alreadyMember'] as const) {
      const problem = classifyInviteAccept({
        ...openInvite,
        accountMatches: false,
        [flag]: true,
      });
      expect(problem).toEqual({ reason: 'wrong_account' });
      if (!('reason' in problem)) {
        throw new Error('expected a problem');
      }
      expect(inviteStatus(problem)).toBe(404);
      expect(mapInviteProblem(problem)).toBe(INVITE_WRONG_ACCOUNT_MESSAGE);
      expect(mapInviteProblem(problem)).toBe('Esta invitación no es válida para tu cuenta.');
    }

    const unknown = classifyInviteAccept({
      ...openInvite,
      tokenKnown: false,
      accountMatches: false,
      used: true,
    });
    expect(unknown).toEqual({ reason: 'unknown_token' });
    if (!('reason' in unknown)) {
      throw new Error('expected a problem');
    }
    expect(inviteStatus(unknown)).toBe(404);
    expect(mapInviteProblem(unknown)).toBe('No encontramos esta invitación.');
    expect(mapInviteProblem(unknown)).not.toBe(INVITE_WRONG_ACCOUNT_MESSAGE);
  });

  it('classifies used, revoked, superseded, expired, and an existing member after the account check', () => {
    expect(classifyInviteAccept({ ...openInvite, used: true })).toEqual({ reason: 'used' });
    expect(classifyInviteAccept({ ...openInvite, revoked: true })).toEqual({ reason: 'revoked' });
    expect(classifyInviteAccept({ ...openInvite, superseded: true })).toEqual({
      reason: 'superseded',
    });
    expect(classifyInviteAccept({ ...openInvite, expired: true })).toEqual({ reason: 'expired' });
    expect(classifyInviteAccept({ ...openInvite, alreadyMember: true })).toEqual({
      reason: 'already_member',
    });
    expect(classifyInviteAccept(openInvite)).toEqual({ ok: true });
  });

  it('keeps a 403 on the accept route on the same neutral message', () => {
    expect(mapAcceptRouteStatus(403)).toBe(INVITE_WRONG_ACCOUNT_MESSAGE);
    expect(mapAcceptRouteStatus(403, 'unknown_token')).toBe(INVITE_WRONG_ACCOUNT_MESSAGE);
    expect(mapAcceptRouteStatus(403, 'wrong_account')).toBe('Esta invitación no es válida para tu cuenta.');
    expect(mapAcceptRouteStatus(404, 'wrong_account')).toBe(INVITE_WRONG_ACCOUNT_MESSAGE);
    expect(mapAcceptRouteStatus(404, 'unknown_token')).toBe('No encontramos esta invitación.');
    expect(mapAcceptRouteStatus(404)).toBeNull();
    expect(mapAcceptRouteStatus(403)).not.toBe(mapInviteProblem({ reason: 'non_owner' }));
    expect(mapAcceptRouteStatus(410)).toBeNull();
  });

  it('expires at sentAt plus 7 days, including the exact boundary', () => {
    const sentAt = new Date('2026-10-01T06:00:00.000Z');
    const expiresAt = new Date(sentAt.getTime() + INVITE_TTL_MS);
    expect(expiresAt.toISOString()).toBe('2026-10-08T06:00:00.000Z');
    expect(isInviteExpired(sentAt, new Date(expiresAt.getTime() - 1))).toBe(false);
    expect(isInviteExpired(sentAt, expiresAt)).toBe(true);
    expect(isInviteExpired(sentAt, new Date(expiresAt.getTime() + 1))).toBe(true);
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
