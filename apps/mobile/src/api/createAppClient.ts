import Constants from 'expo-constants';
import { secureTokenStore, type TokenStore } from '../auth/tokenStore';
import { createApiClient, type ApiClient } from './client';
import { currentApiRuntime, readApiBaseUrl, type ApiRuntime } from './config';

/** Reads `expo.extra.apiBaseUrl`. Does not consult environment variables. */
export function apiBaseUrlFromConfig(env: ApiRuntime): string {
  const extra = Constants.expoConfig?.extra;
  const value =
    extra && typeof extra === 'object' && 'apiBaseUrl' in extra
      ? (extra as { apiBaseUrl?: unknown }).apiBaseUrl
      : undefined;
  return readApiBaseUrl(value, env);
}

export function createAppApiClient(tokenStore: TokenStore = secureTokenStore): ApiClient {
  const env = currentApiRuntime();
  return createApiClient({
    baseUrl: apiBaseUrlFromConfig(env),
    env,
    tokenStore,
  });
}
