import { codeExpiryLabel, codeExpiryParts, remainingSeconds } from './codeExpiry';

const MINUTE = 60 * 1000;

describe('code expiry in America/Mexico_City', () => {
  it('crosses midnight at 23:55 and 23:59 and stays on the new day at 00:00 and 00:01', () => {
    const cases = [
      { sent: '2026-10-31T05:55:00.000Z', time: '00:05', date: '2026-10-31' },
      { sent: '2026-10-31T05:59:00.000Z', time: '00:09', date: '2026-10-31' },
      { sent: '2026-10-31T06:00:00.000Z', time: '00:10', date: '2026-10-31' },
      { sent: '2026-10-31T06:01:00.000Z', time: '00:11', date: '2026-10-31' },
    ];
    for (const item of cases) {
      const sentAt = Date.parse(item.sent);
      expect(codeExpiryParts(sentAt)).toEqual({ time: item.time, date: item.date });
      const label = codeExpiryLabel(sentAt);
      expect(label).toContain(item.time);
      expect(label).toContain(item.date);
      expect(label).not.toContain('2026-10-30');
    }
  });

  it('counts the resend wait down to zero from a deadline', () => {
    const deadline = Date.parse('2026-10-31T06:00:00.000Z');
    expect(remainingSeconds(deadline, deadline - MINUTE)).toBe(60);
    expect(remainingSeconds(deadline, deadline - 25_000)).toBe(25);
    expect(remainingSeconds(deadline, deadline)).toBe(0);
    expect(remainingSeconds(deadline, deadline + 5_000)).toBe(0);
  });
});
