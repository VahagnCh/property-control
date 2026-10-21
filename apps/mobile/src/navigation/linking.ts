import {
  getStateFromPath as getStateFromPathDefault,
  type LinkingOptions,
} from '@react-navigation/native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Linking from 'expo-linking';
import { APP_SCHEME } from './deepLink';

export type LinkingRuntime = {
  /** True for a debug bundle (`__DEV__`). False for a store or TestFlight release. */
  dev: boolean;
  executionEnvironment: string | null | undefined;
  /** `Linking.createURL('/')` when it is an Expo Go `exp://` prefix. Otherwise null. */
  expoGoPrefix: string | null;
};

/** Expo Go (`storeClient`) or a dev bundle. A store or TestFlight release is neither. */
export function allowsDevPrefix(env: Pick<LinkingRuntime, 'dev' | 'executionEnvironment'>): boolean {
  return env.dev || env.executionEnvironment === ExecutionEnvironment.StoreClient;
}

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

/** Drops the query string and the fragment, then parses. Route params never come from the query. */
export const getStateFromPath: typeof getStateFromPathDefault = (path, options) => {
  const withoutFragment = path.split('#')[0] ?? '';
  const withoutQuery = withoutFragment.split('?')[0] ?? '';
  return getStateFromPathDefault(withoutQuery, options);
};

const screens = {
  Inicio: '',
  Propiedades: 'propiedades',
  Pagos: 'pagos',
  Mantenimiento: 'mantenimiento',
  Documentos: 'documentos',
  Notificacion: 'notificaciones/:nid',
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
  const dev = typeof __DEV__ !== 'undefined' && __DEV__;
  const executionEnvironment = Constants.executionEnvironment;
  return {
    dev,
    executionEnvironment,
    expoGoPrefix: allowsDevPrefix({ dev, executionEnvironment }) ? expoGoPrefix() : null,
  };
}

export const linking = createLinkingOptions(currentRuntime());
