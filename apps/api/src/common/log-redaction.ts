const EMAIL = /[\p{L}\p{N}._%+\-]+@[\p{L}\p{N}.\-]+\.[\p{L}]{2,}/gu;
const BEARER = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const BASIC = /Basic\s+(?:[A-Za-z0-9+/]{4})+(?:={0,2})/g;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const SIGNED_URL = /https?:\/\/\S*(?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|[?&]sig=)\S*/gi;
const COOKIE = /\b(?:set-cookie|cookie)\s*:\s*[^\n\r]+/gi;
const SECRET_FIELD =
  /((?:refresh[_-]?token|idempotency[_-]?key|authorization)\b\s*[:=]\s*["']?)([^\s"',}]+)/gi;
const OTP =
  /((?:verification[_-]?code|one[_-]?time[_-]?code|otp|\bcode)\b["']?\s*[:=]?\s*["']?)(\d{4,8})\b/gi;

/**
 * Removes emails, bearer and basic credentials, JWTs, cookies, refresh
 * tokens, idempotency keys, signed URLs, and OTP-shaped codes.
 * A 6-digit number that is not in a code field is left alone so money amounts stay.
 */
export function redactForLog(value: string): string {
  return value
    .replace(SIGNED_URL, '[redacted-url]')
    .replace(BEARER, 'Bearer [redacted]')
    .replace(BASIC, 'Basic [redacted]')
    .replace(JWT, '[redacted-token]')
    .replace(COOKIE, '[redacted-cookie]')
    .replace(SECRET_FIELD, '$1[redacted]')
    .replace(EMAIL, '[redacted-email]')
    .replace(OTP, '$1[redacted-code]');
}

export function logError(message: string): void {
  console.error(redactForLog(message));
}
