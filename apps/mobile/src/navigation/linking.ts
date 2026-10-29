import {
  getStateFromPath as getStateFromPathDefault,
  type LinkingOptions,
} from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { APP_SCHEME, isNotificationId } from './deepLink';
import { allowsDevPrefix, currentDevPrefixEnv, type DevPrefixEnv } from './devPrefix';

export type LinkingRuntime = DevPrefixEnv & {
  /** `Linking.createURL('/')` when it is an Expo Go `exp://` prefix. Otherwise null. */
  expoGoPrefix: string | null;
};

export { allowsDevPrefix };

export function linkingPrefixes(env: LinkingRuntime): string[] {
  const prefixes = [`${APP_SCHEME}://`];
  if (!allowsDevPrefix(env)) {
    return prefixes;
  }
  const prefix = env.expoGoPrefix;
  if (!prefix || !(prefix.startsWith('exp://') || prefix.startsWith('exps://')) || prefixes.includes(prefix)) {
    return prefixes;
  }
  return [...prefixes, prefix];
}

type ParsedRoute = {
  name?: string;
  params?: object;
  state?: { routes?: ParsedRoute[] };
};

function barePath(path: string): string {
  return path.startsWith('/') ? path.slice(1) : path;
}

/**
 * `notificaciones/<nid>` is only safe when nid is exactly a uuid.
 * A slug, an extra segment, or a percent-encoded query (`%3Ftoken%3Dabc`) is not a route.
 */
function isInvalidNotificationPath(path: string): boolean {
  const parts = barePath(path).split('/');
  if (parts[0] !== 'notificaciones') {
    return false;
  }
  if (parts.length !== 2) {
    return true;
  }
  return !isNotificationId(parts[1] ?? '');
}

function routeHasInvalidNid(routes: ParsedRoute[] | undefined): boolean {
  if (!routes) {
    return false;
  }
  for (const route of routes) {
    const params = route.params;
    const hasNid = !!params && Object.prototype.hasOwnProperty.call(params, 'nid');
    const nid = hasNid ? (params as { nid?: unknown }).nid : undefined;
    if (route.name === 'Notificacion' || hasNid) {
      const keys = params ? Object.keys(params) : [];
      if (typeof nid !== 'string' || !isNotificationId(nid) || keys.some((key) => key !== 'nid')) {
        return true;
      }
    }
    if (routeHasInvalidNid(route.state?.routes)) {
      return true;
    }
  }
  return false;
}

/** Drops the query string and the fragment, then parses. Route params never come from the query. */
export const getStateFromPath: typeof getStateFromPathDefault = (path, options) => {
  const withoutFragment = path.split('#')[0] ?? '';
  const withoutQuery = withoutFragment.split('?')[0] ?? '';
  if (isInvalidNotificationPath(withoutQuery)) {
    return undefined;
  }
  const state = getStateFromPathDefault(withoutQuery, options);
  if (routeHasInvalidNid(state?.routes as ParsedRoute[] | undefined)) {
    return undefined;
  }
  return state;
};

/**
 * Tab paths only. Notification links are parsed by AppShell, not by this screen map,
 * so `expo start --web` cannot route `notificaciones/:nid`.
 */
const screens = {
  Inicio: '',
  Propiedades: 'propiedades',
  Pagos: 'pagos',
  Mantenimiento: 'mantenimiento',
  Documentos: 'documentos',
} as const;

export function createLinkingOptions(
  env: LinkingRuntime,
): LinkingOptions<Record<string, object | undefined>> {
  return {
    prefixes: linkingPrefixes(env),
    config: { screens: { ...screens } },
    getStateFromPath,
  };
}

function expoGoPrefix(): string | null {
  try {
    const created = Linking.createURL('/');
    if (created.startsWith('exp://') || created.startsWith('exps://')) {
      return created;
    }
  } catch {
    return null;
  }
  return null;
}

function currentRuntime(): LinkingRuntime {
  const env = currentDevPrefixEnv();
  return {
    ...env,
    expoGoPrefix: allowsDevPrefix(env) ? expoGoPrefix() : null,
  };
}

export const linking = createLinkingOptions(currentRuntime());
