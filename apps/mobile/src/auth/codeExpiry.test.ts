import { COPY, COPY_EN, pickCopy } from '../copy/userFacing';
import { codeExpiryLabel, codeExpiryLabelEn, formatDeviceExpiryTime, remainingSeconds } from './codeExpiry';

const MINUTE = 60 * 1000;
const ZONE = 'America/Mexico_City';

describe('code expiry in America/Mexico_City', () => {
  it('formats 23:55, 23:59, and 00:01 as es-MX 12-hour times with no date', () => {
    expect(formatDeviceExpiryTime(Date.parse('2026-10-31T05:55:00.000Z'), ZONE)).toBe('11:55 p. m.');
    const cases = [
      { sent: '2026-10-31T05:55:00.000Z', time: '12:05 a. m.' },
      { sent: '2026-10-31T05:59:00.000Z', time: '12:09 a. m.' },
      { sent: '2026-10-31T06:01:00.000Z', time: '12:11 a. m.' },
    ];
    for (const item of cases) {
      const sentAt = Date.parse(item.sent);
      const label = codeExpiryLabel(sentAt, sentAt, ZONE);
      expect(label).toBe(`El código vence a las ${item.time}`);
      expect(label).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(codeExpiryLabelEn(sentAt, sentAt, ZONE)).toBe(`The code expires at ${item.time}`);
    }
  });

  it('hides the line once the clock reaches the expiry instant', () => {
    const sentAt = Date.parse('2026-10-31T05:50:00.000Z');
    const at2359 = Date.parse('2026-10-31T05:59:00.000Z');
    const at0001 = Date.parse('2026-10-31T06:01:00.000Z');
    expect(codeExpiryLabel(sentAt, at2359, ZONE)).toBe('El código vence a las 12:00 a. m.');
    expect(codeExpiryLabel(sentAt, at0001, ZONE)).toBeNull();
  });

  it('counts the resend wait down to zero from a deadline', () => {
    const deadline = Date.parse('2026-10-31T06:00:00.000Z');
    expect(remainingSeconds(deadline, deadline - MINUTE)).toBe(60);
    expect(remainingSeconds(deadline, deadline - 25_000)).toBe(25);
    expect(remainingSeconds(deadline, deadline)).toBe(0);
    expect(remainingSeconds(deadline, deadline + 5_000)).toBe(0);
  });

  it('uses Spanish as the source and English as the fallback', () => {
    expect(pickCopy(COPY['auth.code.expiresAt'], COPY_EN['auth.code.expiresAt'])).toBe(
      'El código vence a las {time}.',
    );
    expect(pickCopy(COPY['auth.code.expiresAt'], COPY_EN['auth.code.expiresAt'], 'en')).toBe(
      'The code expires at {time}.',
    );
    expect(pickCopy('', COPY_EN['auth.email.webUnavailable'])).toBe(
      'For now, you can only sign in from the app on your phone.',
    );
    expect(COPY['auth.email.webUnavailable']).toBe('Por ahora, solo puedes entrar desde la app en tu teléfono.');
    expect(COPY_EN['auth.email.webUnavailable']).toBe(
      'For now, you can only sign in from the app on your phone.',
    );
    expect('auth.code.expired' in COPY).toBe(false);
  });
});