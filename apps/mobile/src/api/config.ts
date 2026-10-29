/**
 * Public API origin from Expo app config (`expo.extra.apiBaseUrl`).
 * This module does not read environment variables. A secret does not belong
 * in the client bundle, and the base URL is not a credential.
 */

export type ApiRuntime = 'production' | 'dev' | 'test';

export function currentApiRuntime(): ApiRuntime {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    return 'dev';
  }
  return 'production';
}

/**
 * https is required in production. http is allowed only in dev and tests.
 * Userinfo is rejected in every runtime so a secret cannot ride in the URL.
 * The thrown text never echoes the candidate URL.
 */
export function readApiBaseUrl(value: unknown, env: ApiRuntime): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('API base URL is missing from app config.');
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('API base URL is not a valid URL.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('API base URL must not include credentials.');
  }
  if (url.protocol === 'https:') {
    return stripSlash(value.trim());
  }
  if (url.protocol === 'http:' && env !== 'production') {
    return stripSlash(value.trim());
  }
  throw new Error('API base URL must use https.');
}

function stripSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
