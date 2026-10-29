import Constants, { ExecutionEnvironment } from 'expo-constants';

export type DevPrefixEnv = {
  dev: boolean;
  executionEnvironment: string | null | undefined;
};

/** Expo Go (`storeClient`) or a dev bundle. A store or TestFlight release is neither. */
export function allowsDevPrefix(env: Pick<DevPrefixEnv, 'dev' | 'executionEnvironment'>): boolean {
  return env.dev || env.executionEnvironment === ExecutionEnvironment.StoreClient;
}

/**
 * The same check registers an `exp://` prefix and decides whether an `exp://` link may be parsed.
 * A production build is neither Expo Go nor a dev bundle.
 */
export function currentDevPrefixEnv(): DevPrefixEnv {
  const dev = typeof __DEV__ !== 'undefined' && __DEV__;
  return {
    dev,
    executionEnvironment: Constants.executionEnvironment,
  };
}
