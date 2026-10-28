/** Expo URL scheme. The slug stays property-control. */
export const APP_SCHEME = 'duerecord';

/** 8-4-4-4-12 hex. Case-insensitive. Not a free-form slug. */
const NID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TAB_BY_SEGMENT = {
  propiedades: 'Propiedades',
  pagos: 'Pagos',
  mantenimiento: 'Mantenimiento',
  documentos: 'Documentos',
} as const;

export type TabScreen = 'Inicio' | (typeof TAB_BY_SEGMENT)[keyof typeof TAB_BY_SEGMENT];

export type DeepLinkParse =
  | { status: 'unhandled' }
  | { status: 'inicio' }
  | { status: 'tab'; screen: TabScreen }
  | { status: 'notification'; nid: string };

export type DeepLinkAction =
  | { action: 'ignore' }
  | { action: 'inicio' }
  | { action: 'tab'; screen: TabScreen }
  | { action: 'notification'; nid: string }
  | { action: 'sign-in'; pendingNid: string };

const EXPO_GO_MARK = '/--/';

function stripQueryAndFragment(input: string): string {
  const hash = input.indexOf('#');
  const withoutHash = hash === -1 ? input : input.slice(0, hash);
  const query = withoutHash.indexOf('?');
  return query === -1 ? withoutHash : withoutHash.slice(0, query);
}

function splitScheme(input: string): { scheme: string; rest: string } | null {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//.exec(input);
  if (!match?.[1]) {
    return null;
  }
  return { scheme: match[1].toLowerCase(), rest: input.slice(match[0].length) };
}

/**
 * Segments after the scheme, with empty pieces kept.
 * Expo Go links drop the host through `/--/` and then use the same segments.
 * `..`, a double slash, and a trailing slash stay in the list so they cannot collapse into a nid.
 */
function segmentsAfterScheme(scheme: string, rest: string): string[] | 'unhandled' {
  if (scheme === 'exp' || scheme === 'exps') {
    const marker = rest.indexOf(EXPO_GO_MARK);
    if (marker === -1) {
      return 'unhandled';
    }
    return rest.slice(marker + EXPO_GO_MARK.length).split('/');
  }
  if (scheme !== APP_SCHEME) {
    return 'unhandled';
  }
  return rest.split('/');
}

function isNotificationId(value: string): boolean {
  return NID.test(value);
}

/**
 * Reads one incoming URL.
 * A notification is exactly the segments ['notificaciones', <uuid>].
 * Any other duerecord or Expo Go path falls back to Inicio.
 * Any other scheme is ignored. Query and fragment are never part of the result.
 */
export function parseDeepLink(input: string): DeepLinkParse {
  const stripped = stripQueryAndFragment(input.trim());
  const parts = splitScheme(stripped);
  if (!parts) {
    return { status: 'inicio' };
  }
  const segments = segmentsAfterScheme(parts.scheme, parts.rest);
  if (segments === 'unhandled') {
    return { status: 'unhandled' };
  }
  if (segments.length === 2 && segments[0] === 'notificaciones' && isNotificationId(segments[1] ?? '')) {
    return { status: 'notification', nid: segments[1] ?? '' };
  }
  if (segments.length === 1 && segments[0] === '') {
    return { status: 'tab', screen: 'Inicio' };
  }
  if (segments.length === 1) {
    const screen = TAB_BY_SEGMENT[segments[0] as keyof typeof TAB_BY_SEGMENT];
    if (screen) {
      return { status: 'tab', screen };
    }
  }
  return { status: 'inicio' };
}

/** Where the shell should go. A missing session holds the nid until sign-in, and never the raw URL. */
export function resolveDeepLink(input: string, hasSession: boolean): DeepLinkAction {
  const parsed = parseDeepLink(input);
  if (parsed.status === 'unhandled') {
    return { action: 'ignore' };
  }
  if (parsed.status === 'notification') {
    if (!hasSession) {
      return { action: 'sign-in', pendingNid: parsed.nid };
    }
    return { action: 'notification', nid: parsed.nid };
  }
  if (parsed.status === 'tab') {
    return { action: 'tab', screen: parsed.screen };
  }
  return { action: 'inicio' };
}

/** A tab URL built from the screen name. No query, fragment, or caller-supplied text. */
export function tabDeepLink(screen: TabScreen): string {
  if (screen === 'Inicio') {
    return `${APP_SCHEME}://`;
  }
  const segment = Object.entries(TAB_BY_SEGMENT).find(([, name]) => name === screen)?.[0];
  return `${APP_SCHEME}://${segment ?? ''}`;
}

/** Builds a notification URL with no query, fragment, or userinfo. */
export function notificationDeepLink(nid: string): string | null {
  if (!isNotificationId(nid)) {
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
