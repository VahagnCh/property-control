import * as SecureStore from 'expo-secure-store';

/**
 * Auth tokens live in the platform secure store (Keychain on iOS, Keystore on Android).
 * They are not written to AsyncStorage, the JS bundle, or a URL.
 * Accessibility is this-device-only so a backup restore does not copy them.
 * Biometrics stay off so Expo Go can read the store without a Face ID prompt.
 */
const ACCESS_KEY = 'duerecord.auth.access';
const REFRESH_KEY = 'duerecord.auth.refresh';

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export async function saveAuthTokens(tokens: AuthTokens): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_KEY, tokens.accessToken, options);
  await SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken, options);
}

export async function readAuthTokens(): Promise<AuthTokens | null> {
  const accessToken = await SecureStore.getItemAsync(ACCESS_KEY, options);
  const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY, options);
  if (!accessToken || !refreshToken) {
    return null;
  }
  return { accessToken, refreshToken };
}

export async function clearAuthTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS_KEY, options);
  await SecureStore.deleteItemAsync(REFRESH_KEY, options);
}
