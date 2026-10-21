const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const SIGNED_URL = /https?:\/\/\S*(?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|[?&]sig=)\S*/gi;
const AUTH_CODE = /\b\d{6}\b/g;

/** Removes emails, bearer tokens, JWTs, signed URLs, and 6-digit codes from a log line. */
export function redactForLog(value: string): string {
  return value
    .replace(SIGNED_URL, '[redacted-url]')
    .replace(BEARER, 'Bearer [redacted]')
    .replace(JWT, '[redacted-token]')
    .replace(EMAIL, '[redacted-email]')
    .replace(AUTH_CODE, '[redacted-code]');
}

export function logError(message: string): void {
  console.error(redactForLog(message));
}
