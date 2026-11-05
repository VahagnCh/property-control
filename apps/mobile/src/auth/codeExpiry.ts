import { AUTH_CODE_TTL_MS } from '../api/contract';
import { copyText, fillCopy } from '../copy/userFacing';

/**
 * Device-zone clock time in es-MX 12-hour form, such as "11:55 p. m.".
 * No date. The zone is the device zone unless a test passes one.
 */
export function formatDeviceExpiryTime(instantMs: number, timeZone?: string): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  };
  if (timeZone) {
    options.timeZone = timeZone;
  }
  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(new Date(instantMs));
  let hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  if (!Number.isInteger(hour)) {
    hour = 0;
  }
  if (hour === 24) {
    hour = 0;
  }
  const period = hour >= 12 ? 'p. m.' : 'a. m.';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute.padStart(2, '0')} ${period}`;
}

export function codeExpiresAt(sentAtMs: number): number {
  return sentAtMs + AUTH_CODE_TTL_MS;
}

/**
 * Spanish expiry line while {time} is still ahead. Null once the device
 * clock reaches that instant, so a past time is never left on screen.
 * There is no separate expired-code copy. auth.code.expired stays unused.
 */
export function codeExpiryLabel(sentAtMs: number, nowMs: number, timeZone?: string): string | null {
  if (nowMs >= codeExpiresAt(sentAtMs)) {
    return null;
  }
  const time = formatDeviceExpiryTime(codeExpiresAt(sentAtMs), timeZone);
  return finishExpirySentence(copyText('auth.code.expiresAt'), time);
}

export function codeExpiryLabelEn(sentAtMs: number, nowMs: number, timeZone?: string): string | null {
  if (nowMs >= codeExpiresAt(sentAtMs)) {
    return null;
  }
  const time = formatDeviceExpiryTime(codeExpiresAt(sentAtMs), timeZone);
  return finishExpirySentence(copyText('auth.code.expiresAt', 'en'), time);
}

/** The template already ends with a period, and "p. m." does too. Keep one. */
function finishExpirySentence(template: string, time: string): string {
  const filled = fillCopy(template, { time });
  return filled.endsWith('..') ? filled.slice(0, -1) : filled;
}

export function remainingSeconds(deadlineMs: number, nowMs: number): number {
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(nowMs)) {
    return 0;
  }
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}
