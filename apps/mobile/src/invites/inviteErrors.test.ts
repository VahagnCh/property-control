import {
  INVITE_TTL_MS,
  INVITE_WRONG_ACCOUNT_MESSAGE,
  inviteStatus,
  isInviteExpired,
  mapInviteProblem,
} from './inviteErrors';

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

  it('shows the same neutral message for a wrong account whether the status is 403 or 404', () => {
    const from403 = mapInviteProblem({ reason: 'wrong_account', status: 403 });
    const from404 = mapInviteProblem({ reason: 'wrong_account', status: 404 });
    expect(from403).toBe(INVITE_WRONG_ACCOUNT_MESSAGE);
    expect(from404).toBe(from403);
    expect(from403).toBe('Esta invitación no es válida para tu cuenta.');
    expect(inviteStatus({ reason: 'wrong_account', status: 403 })).toBe(403);
    expect(inviteStatus({ reason: 'wrong_account', status: 404 })).toBe(404);
    expect(from403).not.toBe(mapInviteProblem({ reason: 'unknown_token' }));
    expect(from403).not.toBe(mapInviteProblem({ reason: 'non_owner' }));
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
