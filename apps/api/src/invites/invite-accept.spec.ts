import { describe, expect, it } from 'vitest';
import { TEST_SERVER_SECRET } from '../auth/server-secret.js';
import { decideInviteAccept, decideInviteManage, inviteEmailHmac, type InviteSnapshot } from './invite-accept.js';

const NOW = new Date('2026-10-21T18:00:00.000Z');
const HMAC = inviteEmailHmac('person@example.com', TEST_SERVER_SECRET);

function invite(overrides: Partial<InviteSnapshot> = {}): InviteSnapshot {
  return {
    emailHmac: HMAC,
    usedAt: null,
    revokedAt: null,
    supersededAt: null,
    expiresAt: new Date('2026-10-28T18:00:00.000Z'),
    ...overrides,
  };
}

describe('invite accept and manage', () => {
  it('returns 404 for an unknown token or the wrong account before revealing state', () => {
    expect(
      decideInviteAccept({ invite: null, accountEmailHmac: HMAC, now: NOW, alreadyMember: false }),
    ).toEqual({ status: 404, error: 'not_found' });
    expect(
      decideInviteAccept({
        invite: invite({ emailHmac: 'other', expiresAt: new Date(0), usedAt: NOW }),
        accountEmailHmac: HMAC,
        now: NOW,
        alreadyMember: true,
      }),
    ).toEqual({ status: 404, error: 'not_found' });
  });

  it('returns 410 for used, revoked, superseded, and expired invites', () => {
    for (const closed of [
      invite({ usedAt: NOW }),
      invite({ revokedAt: NOW }),
      invite({ supersededAt: NOW }),
      invite({ expiresAt: NOW }),
    ]) {
      expect(
        decideInviteAccept({ invite: closed, accountEmailHmac: HMAC, now: NOW, alreadyMember: false }),
      ).toEqual({ status: 410, error: 'invite_closed' });
    }
  });

  it('returns 409 when the invitee is already a member, and 200 otherwise', () => {
    expect(
      decideInviteAccept({ invite: invite(), accountEmailHmac: HMAC, now: NOW, alreadyMember: true }),
    ).toEqual({ status: 409, error: 'already_member' });
    expect(
      decideInviteAccept({ invite: invite(), accountEmailHmac: HMAC, now: NOW, alreadyMember: false }),
    ).toEqual({ status: 200, error: null });
  });

  it('returns 403 unless the actor is an owner', () => {
    expect(decideInviteManage('member')).toEqual({ status: 403, error: 'forbidden' });
    expect(decideInviteManage('viewer')).toEqual({ status: 403, error: 'forbidden' });
    expect(decideInviteManage(null)).toEqual({ status: 403, error: 'forbidden' });
    expect(decideInviteManage('owner')).toEqual({ status: 200, error: null });
  });

  it('stores an HMAC of the email, not the address', () => {
    const hmac = inviteEmailHmac('Person@Example.com', TEST_SERVER_SECRET);
    expect(hmac).toBe(inviteEmailHmac(' person@example.com ', TEST_SERVER_SECRET));
    expect(hmac).not.toContain('example.com');
    expect(hmac).toMatch(/^[0-9a-f]{64}$/);
  });
});
