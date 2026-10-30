const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LITERAL_SEGMENTS = new Set([
  'v1',
  'health',
  'auth',
  'code',
  'verify',
  'refresh',
  'logout',
  'session',
  'me',
  'home',
  'action-items',
  'properties',
  'memberships',
  'invites',
  'accept',
  'resend',
  'obligations',
  'resume',
  'unarchive',
  'period-outcomes',
  'payments',
  'void',
  'evidence',
  'upload-url',
  'complete',
  'maintenance-tasks',
  'documents',
  'content-url',
  'ocr-jobs',
  'confirm',
  'reminders',
  'audit-events',
]);

const SLASH_LOOKALIKES = /[\u2215\u2044\uFF0F\u29F8\u29F9]/g;
const BACKSLASH_LOOKALIKES = /[\u2216\u29F5\uFF3C]/g;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function pathOnly(url: string): string {
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}

export function isOcrPath(urlPath: string): boolean {
  return /\/ocr-jobs(?:\/|$)/.test(urlPath);
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/**
 * Live property, obligation, and payment reads and writes, including void.
 * Resume and delete stay 501 before the token is read.
 */
export function isLiveRecordPath(method: string, urlPath: string): boolean {
  const verb = method.toUpperCase();
  const path = stripOneTrailingSlash(pathOnly(urlPath));
  if (path === '/v1/properties' && (verb === 'GET' || verb === 'POST')) {
    return true;
  }
  if (new RegExp(`^/v1/properties/${UUID}$`, 'i').test(path) && (verb === 'GET' || verb === 'PATCH')) {
    return true;
  }
  if (
    new RegExp(`^/v1/properties/${UUID}/obligations$`, 'i').test(path) &&
    (verb === 'GET' || verb === 'POST')
  ) {
    return true;
  }
  if (
    new RegExp(`^/v1/properties/${UUID}/obligations/${UUID}$`, 'i').test(path) &&
    (verb === 'GET' || verb === 'PATCH')
  ) {
    return true;
  }
  if (new RegExp(`^/v1/properties/${UUID}/payments$`, 'i').test(path) && (verb === 'GET' || verb === 'POST')) {
    return true;
  }
  if (
    new RegExp(`^/v1/properties/${UUID}/payments/${UUID}$`, 'i').test(path) &&
    (verb === 'GET' || verb === 'PATCH')
  ) {
    return true;
  }
  if (new RegExp(`^/v1/properties/${UUID}/payments/${UUID}/void$`, 'i').test(path) && verb === 'POST') {
    return true;
  }
  return false;
}

/**
 * True when the raw URL contains a traversal sequence, including encodings
 * that only become `..`, a slash, or a NUL after one or more decodes.
 */
export function isTraversal(value: string): boolean {
  if (value.includes('\0') || /%00/i.test(value)) {
    return true;
  }
  let current = normalizeLookalikes(value);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!/%[0-9a-fA-F]{2}/.test(current)) {
      break;
    }
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) {
        break;
      }
      current = normalizeLookalikes(decoded);
    } catch {
      return true;
    }
  }
  return current.includes('\0') || current.includes('..') || current.includes('\\');
}

export function hasNonUuidIdSegment(urlPath: string): boolean {
  const segments = urlPath.split('/').filter((segment) => segment.length > 0);
  return segments.some((segment) => {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return true;
    }
    if (LITERAL_SEGMENTS.has(decoded)) {
      return false;
    }
    return !isUuid(decoded);
  });
}

export function earlyRequestStatus(url: string, ocrEnabled: boolean): 400 | 501 | null {
  const path = pathOnly(url);
  if (isOcrPath(path) && !ocrEnabled) {
    return 501;
  }
  if (isTraversal(path) || hasNonUuidIdSegment(path)) {
    return 400;
  }
  return null;
}

export function stripOneTrailingSlash(path: string): string {
  if (path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1);
  }
  return path;
}

function normalizeLookalikes(value: string): string {
  return value
    .normalize('NFKC')
    .replace(SLASH_LOOKALIKES, '/')
    .replace(BACKSLASH_LOOKALIKES, '\\');
}
