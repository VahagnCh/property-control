/** Same normalization as the API: NFC, trim, lower case. */
export function normalizeAuthEmail(value: string): string {
  return value.normalize('NFC').trim().toLowerCase();
}

/**
 * The API rejects a missing `@` or a length outside 3–320 before it looks
 * up an account. This check does not say whether the account exists.
 */
export function isPlausibleAuthEmail(value: string): boolean {
  const email = normalizeAuthEmail(value);
  return email.length >= 3 && email.length <= 320 && email.includes('@');
}
