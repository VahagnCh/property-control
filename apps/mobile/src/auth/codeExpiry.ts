import { AUTH_CODE_TTL_MS } from '../api/contract';
import { fillCopy, COPY } from '../copy/userFacing';
import { calendarDateInTimeZone, DEFAULT_PROPERTY_TIMEZONE } from '../dates/propertyCalendar';

export type CodeExpiryParts = {
  time: string;
  date: string;
};

/**
 * Clock time of a code that expires 10 minutes after `sentAtMs`, in the
 * property zone. 23:55 and 23:59 cross midnight; 00:00 and 00:01 stay on
 * that calendar date. The zone is America/Mexico_City unless a caller
 * passes another IANA name. The device zone is not used.
 */
export function codeExpiryParts(
  sentAtMs: number,
  timeZone: string = DEFAULT_PROPERTY_TIMEZONE,
): CodeExpiryParts {
  const expiresAt = new Date(sentAtMs + AUTH_CODE_TTL_MS);
  const date = calendarDateInTimeZone(expiresAt, timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(expiresAt);
  const hour = numericPart(parts, 'hour');
  const minute = numericPart(parts, 'minute');
  const normalizedHour = hour === 24 ? 0 : hour;
  return {
    time: `${String(normalizedHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    date,
  };
}

export function codeExpiryLabel(sentAtMs: number, timeZone: string = DEFAULT_PROPERTY_TIMEZONE): string {
  const parts = codeExpiryParts(sentAtMs, timeZone);
  return fillCopy(COPY['auth.code.expiresAt'], { time: parts.time, date: parts.date });
}

export function remainingSeconds(deadlineMs: number, nowMs: number): number {
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(nowMs)) {
    return 0;
  }
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

function numericPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const found = parts.find((part) => part.type === type);
  const value = found ? Number(found.value) : Number.NaN;
  if (!Number.isInteger(value)) {
    return 0;
  }
  return value;
}
