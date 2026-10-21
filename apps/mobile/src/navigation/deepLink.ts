/** Expo URL scheme. The slug stays property-control. */
export const APP_SCHEME = 'duerecord';

const NID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export type DeepLinkParse =
  | { status: 'unhandled' }
  | { status: 'inicio' }
  | { status: 'notification'; nid: string };

export type DeepLinkAction =
  | { action: 'ignore' }
  | { action: 'inicio' }
  | { action: 'notification'; nid: string }
  | { action: 'sign-in'; pendingNid: string };

function notificationId(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!NID.test(decoded)) {
    return null;
  }
  return decoded;
}

/**
 * Reads one incoming URL. Any scheme other than duerecord is ignored.
 * A duerecord URL with a bad path, a bad nid, or userinfo falls back to Inicio.
 * Query and fragment are never part of the result, so a token on the URL is dropped.
 */
export function parseDeepLink(input: string): DeepLinkParse {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { status: 'inicio' };
  }
  if (url.protocol !== `${APP_SCHEME}:`) {
    return { status: 'unhandled' };
  }
  if (url.username !== '' || url.password !== '') {
    return { status: 'inicio' };
  }
  const fromHost = url.hostname === 'notificaciones' ? url.pathname.split('/').filter(Boolean) : null;
  const fromPath = url.hostname === '' ? url.pathname.split('/').filter(Boolean) : null;
  const segments = fromHost ?? (fromPath?.[0] === 'notificaciones' ? fromPath.slice(1) : null);
  if (!segments || segments.length !== 1) {
    return { status: 'inicio' };
  }
  const nid = notificationId(segments[0] ?? '');
  if (!nid) {
    return { status: 'inicio' };
  }
  return { status: 'notification', nid };
}

/** Where the shell should go. A missing session holds the nid until sign-in, and never the raw URL. */
export function resolveDeepLink(input: string, hasSession: boolean): DeepLinkAction {
  const parsed = parseDeepLink(input);
  if (parsed.status === 'unhandled') {
    return { action: 'ignore' };
  }
  if (parsed.status === 'inicio') {
    return { action: 'inicio' };
  }
  if (!hasSession) {
    return { action: 'sign-in', pendingNid: parsed.nid };
  }
  return { action: 'notification', nid: parsed.nid };
}

/** Builds a notification URL with no query, fragment, or userinfo. */
export function notificationDeepLink(nid: string): string | null {
  if (notificationId(nid) !== nid) {
    return null;
  }
  return `${APP_SCHEME}://notificaciones/${nid}`;
}

/** The URL this app keeps after handling. Secrets on the incoming URL are not copied. */
export function handledDeepLinkUrl(input: string): string | null {
  const parsed = parseDeepLink(input);
  if (parsed.status !== 'notification') {
    return null;
  }
  return notificationDeepLink(parsed.nid);
}
