import fs from 'fs';
import path from 'path';
import {
  classifyInviteAccept,
  INVITE_TTL_MS,
  InviteAcceptInput,
  inviteStatus,
  isInviteExpired,
  mapAcceptRouteStatus,
  mapInviteProblem,
} from './inviteErrors';

const UNAVAILABLE = {
  key: 'invite.unavailable' as const,
  message: 'Esta invitación no está disponible. Pide a quien te invitó que te envíe una nueva.',
};

const EXPIRED = {
  key: 'invite.expired' as const,
  message: 'Esta invitación ya no se puede usar. Pide una nueva.',
};

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
  it('maps token outcomes to the agreed status codes and copy keys', () => {
    expect(inviteStatus({ reason: 'unknown_token' })).toBe(404);
    expect(mapInviteProblem({ reason: 'unknown_token' })).toEqual(UNAVAILABLE);

    for (const reason of ['used', 'revoked', 'superseded', 'expired'] as const) {
      expect(inviteStatus({ reason })).toBe(410);
      expect(mapInviteProblem({ reason })).toEqual(EXPIRED);
    }

    expect(inviteStatus({ reason: 'already_member' })).toBe(409);
    expect(mapInviteProblem({ reason: 'already_member' })).toEqual({
      key: 'invite.alreadyMember',
      message: 'Ya perteneces a esta propiedad.',
    });

    expect(inviteStatus({ reason: 'non_owner' })).toBe(403);
    expect(mapInviteProblem({ reason: 'non_owner' })).toEqual({
      key: 'invite.nonOwner',
      message: 'No tienes permiso para invitar a esta propiedad.',
    });
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
      expect(mapInviteProblem(problem)).toEqual(UNAVAILABLE);
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
    expect(mapInviteProblem(unknown)).toEqual(UNAVAILABLE);
  });

  it('gives every 404 on the accept route the same invite.unavailable copy', () => {
    const variants = [
      mapAcceptRouteStatus(404),
      mapAcceptRouteStatus(404, 'unknown_token'),
      mapAcceptRouteStatus(404, 'wrong_account'),
      mapInviteProblem({ reason: 'unknown_token' }),
      mapInviteProblem({ reason: 'wrong_account' }),
    ];
    expect(variants.every((copy) => copy?.key === 'invite.unavailable')).toBe(true);
    expect(new Set(variants.map((copy) => copy?.message)).size).toBe(1);
    expect(variants[0]).toEqual(UNAVAILABLE);

    expect(mapAcceptRouteStatus(403)).toEqual(UNAVAILABLE);
    expect(mapAcceptRouteStatus(403, 'unknown_token')).toEqual(UNAVAILABLE);
    expect(mapAcceptRouteStatus(403, 'wrong_account')).toEqual(UNAVAILABLE);
    expect(mapAcceptRouteStatus(403)?.message).not.toBe(mapInviteProblem({ reason: 'non_owner' }).message);

    expect(mapAcceptRouteStatus(410)).toEqual(EXPIRED);
    expect(mapAcceptRouteStatus(409)).toBeNull();
    expect(mapAcceptRouteStatus(400)).toBeNull();
  });

  it('drops the retired 404 sentences from the invite copy', () => {
    const source = [
      fs.readFileSync(path.join(__dirname, 'inviteErrors.ts'), 'utf8'),
      fs.readFileSync(path.join(__dirname, '../copy/userFacing.ts'), 'utf8'),
    ].join('\n');
    expect(source).not.toContain('No encontramos esta invitación.');
    expect(source).not.toContain('Esta invitación no es válida para tu cuenta.');
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
